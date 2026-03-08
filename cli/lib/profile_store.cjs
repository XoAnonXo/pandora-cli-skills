'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  PROFILE_FILE_ENV_VAR,
  PROFILE_STORE_SCHEMA_VERSION,
  defaultProfileFile,
} = require('./shared/profile_constants.cjs');
const { createProfileError } = require('./shared/profile_errors.cjs');
const {
  normalizeProfileDocument,
  buildProfileSummary,
  getBuiltInProfiles,
} = require('./profile_registry_service.cjs');

function compareStableStrings(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function resolveProfileFile(filePath, options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const rawPath = filePath || env[PROFILE_FILE_ENV_VAR] || defaultProfileFile();
  return path.resolve(expandHome(String(rawPath)));
}

function parseProfileDocumentContent(content, filePath) {
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw createProfileError('PROFILE_FILE_INVALID_JSON', `Profile file is not valid JSON: ${filePath}`, {
      filePath,
      cause: error && error.message ? error.message : String(error),
    });
  }

  try {
    return normalizeProfileDocument(parsed, { source: filePath });
  } catch (error) {
    throw createProfileError('PROFILE_FILE_INVALID', error.message, {
      filePath,
      cause: error && error.details ? error.details : undefined,
    });
  }
}

function readProfileFile(filePath, options = {}) {
  const resolved = resolveProfileFile(filePath, options);
  const allowMissing = options.allowMissing === true;

  if (!fs.existsSync(resolved)) {
    if (allowMissing) {
      return {
        filePath: resolved,
        exists: false,
        document: {
          schemaVersion: PROFILE_STORE_SCHEMA_VERSION,
          profileCount: 0,
          profiles: [],
        },
      };
    }
    throw createProfileError('PROFILE_FILE_NOT_FOUND', `Profile file not found: ${resolved}`, {
      filePath: resolved,
    });
  }

  let content = '';
  try {
    content = fs.readFileSync(resolved, 'utf8');
  } catch (error) {
    throw createProfileError('PROFILE_FILE_READ_FAILED', `Unable to read profile file: ${resolved}`, {
      filePath: resolved,
      cause: error && error.message ? error.message : String(error),
    });
  }

  return {
    filePath: resolved,
    exists: true,
    document: parseProfileDocumentContent(content, resolved),
  };
}

function ensurePrivateDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // best-effort permission hardening
  }
}

function writeProfileFile(filePath, document, options = {}) {
  const resolved = resolveProfileFile(filePath, options);
  const normalized = normalizeProfileDocument(document, { source: resolved });
  const payload = `${JSON.stringify({
    schemaVersion: normalized.schemaVersion || PROFILE_STORE_SCHEMA_VERSION,
    profiles: normalized.profiles,
  }, null, 2)}\n`;

  try {
    ensurePrivateDirectory(path.dirname(resolved));
    const tmpPath = `${resolved}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmpPath, payload, { mode: 0o600 });
    fs.renameSync(tmpPath, resolved);
    try {
      fs.chmodSync(resolved, 0o600);
    } catch {
      // best-effort permission hardening
    }
  } catch (error) {
    throw createProfileError('PROFILE_FILE_WRITE_FAILED', `Unable to write profile file: ${resolved}`, {
      filePath: resolved,
      cause: error && error.message ? error.message : String(error),
    });
  }

  return {
    filePath: resolved,
    document: normalized,
  };
}

function buildProfileEntry(profile, metadata = {}) {
  return {
    id: profile.id,
    source: metadata.source || 'unknown',
    builtin: metadata.builtin === true,
    filePath: metadata.filePath || null,
    profile,
    summary: buildProfileSummary(profile, metadata),
  };
}

function mergeProfileEntries(builtinEntries, fileEntries) {
  const byId = new Map();
  for (const entry of builtinEntries) {
    byId.set(entry.id, entry);
  }
  for (const entry of fileEntries) {
    byId.set(entry.id, entry);
  }
  return Array.from(byId.values()).sort((left, right) => compareStableStrings(left.id, right.id));
}

function createProfileStore(options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;

  function loadProfileSet(loadOptions = {}) {
    const builtinOnly = loadOptions.builtinOnly === true;
    const includeBuiltIns = !builtinOnly && loadOptions.includeBuiltIns !== false
      ? true
      : builtinOnly;
    const targetFile = loadOptions.filePath || null;
    const fileRecord = builtinOnly
      ? {
          filePath: resolveProfileFile(targetFile, { env }),
          exists: false,
          document: {
            schemaVersion: PROFILE_STORE_SCHEMA_VERSION,
            profileCount: 0,
            profiles: [],
          },
        }
      : readProfileFile(targetFile, { env, allowMissing: true });

    const builtinEntries = includeBuiltIns
      ? getBuiltInProfiles().map((profile) => buildProfileEntry(profile, {
          source: 'builtin',
          builtin: true,
        }))
      : [];

    const fileEntries = builtinOnly
      ? []
      : fileRecord.document.profiles.map((profile) => buildProfileEntry(profile, {
          source: 'file',
          builtin: false,
          filePath: fileRecord.filePath,
        }));

    return {
      schemaVersion: PROFILE_STORE_SCHEMA_VERSION,
      filePath: fileRecord.filePath,
      exists: fileRecord.exists,
      builtInCount: builtinEntries.length,
      fileCount: fileEntries.length,
      items: mergeProfileEntries(builtinEntries, fileEntries),
    };
  }

  function listProfiles(loadOptions = {}) {
    return loadProfileSet(loadOptions).items;
  }

  function getProfile(id, loadOptions = {}) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return null;
    return loadProfileSet(loadOptions).items.find((entry) => entry.id === normalizedId) || null;
  }

  function validateProfileFile(filePath, validateOptions = {}) {
    const fileRecord = readProfileFile(filePath, { env, allowMissing: false });
    const items = fileRecord.document.profiles.map((profile) => buildProfileEntry(profile, {
      source: 'file',
      builtin: false,
      filePath: fileRecord.filePath,
    }));
    return {
      schemaVersion: PROFILE_STORE_SCHEMA_VERSION,
      filePath: fileRecord.filePath,
      profileCount: items.length,
      profiles: items.map((entry) => entry.profile),
      items: items.map((entry) => entry.summary),
      exists: true,
      requestedId:
        validateOptions && validateOptions.id ? String(validateOptions.id).trim() || null : null,
    };
  }

  return {
    loadProfileSet,
    listProfiles,
    getProfile,
    validateProfileFile,
    readProfileFile: (filePath, readOptions = {}) => readProfileFile(filePath, { env, ...readOptions }),
    writeProfileFile: (filePath, document, writeOptions = {}) => writeProfileFile(filePath, document, { env, ...writeOptions }),
  };
}

module.exports = {
  PROFILE_STORE_SCHEMA_VERSION,
  expandHome,
  resolveProfileFile,
  readProfileFile,
  writeProfileFile,
  createProfileStore,
};
