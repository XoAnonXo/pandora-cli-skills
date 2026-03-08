'use strict';

const fs = require('fs');
const path = require('path');

const { buildCommandDescriptors } = require('./agent_contract_registry.cjs');
const {
  createPolicyStoreError,
  listStoredPolicyFiles,
  readPolicyFile,
  resolvePolicyDir,
  writeStoredPolicyPack,
} = require('./policy_store.cjs');
const { BUILTIN_POLICY_PACKS } = require('./shared/policy_builtin_packs.cjs');
const { BUILTIN_POLICY_PACK_IDS, POLICY_SCHEMA_VERSION } = require('./shared/policy_constants.cjs');
const {
  createPolicyError,
  serializePolicyPackDefinition,
  validatePolicyPackDefinition,
} = require('./shared/policy_schema.cjs');

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function compilePack(packId, bundle, stack = [], cache = new Map()) {
  if (cache.has(packId)) {
    return cache.get(packId);
  }
  if (stack.includes(packId)) {
    throw createPolicyError('POLICY_EXTENDS_CYCLE', `Policy inheritance cycle detected: ${[...stack, packId].join(' -> ')}`, {
      chain: [...stack, packId],
    });
  }

  const pack = bundle.byId.get(packId);
  if (!pack) {
    throw createPolicyError('POLICY_NOT_FOUND', `Policy pack not found: ${packId}`, { id: packId });
  }

  const inheritedPackIds = [];
  const compiledRules = [];
  const seenRuleIds = new Set();

  for (const parentId of pack.extends) {
    const parent = compilePack(parentId, bundle, [...stack, packId], cache);
    for (const ancestorId of parent.inheritedPackIds) {
      if (!inheritedPackIds.includes(ancestorId)) {
        inheritedPackIds.push(ancestorId);
      }
    }
    if (!inheritedPackIds.includes(parent.id)) {
      inheritedPackIds.push(parent.id);
    }
    for (const parentRule of parent.compiledRules) {
      if (seenRuleIds.has(parentRule.id)) {
        throw createPolicyError(
          'POLICY_RULE_ID_CONFLICT',
          `Policy inheritance introduces duplicate rule id: ${parentRule.id}`,
          { packId, ruleId: parentRule.id, sourcePackId: parentRule.sourcePackId },
        );
      }
      seenRuleIds.add(parentRule.id);
      compiledRules.push(cloneJson(parentRule));
    }
  }

  for (const rule of pack.rules) {
    if (seenRuleIds.has(rule.id)) {
      throw createPolicyError(
        'POLICY_RULE_ID_CONFLICT',
        `Policy pack overrides inherited rule id without explicit support: ${rule.id}`,
        { packId, ruleId: rule.id },
      );
    }
    seenRuleIds.add(rule.id);
    compiledRules.push({
      ...cloneJson(rule),
      sourcePackId: pack.id,
    });
  }

  const compiled = {
    ...cloneJson(pack),
    inheritedPackIds,
    compiledRules,
    compiledRuleCount: compiledRules.length,
  };
  cache.set(packId, compiled);
  return compiled;
}

function normalizeValidatedPack(validation, options = {}) {
  if (!validation || validation.valid !== true || !validation.normalizedPack) {
    throw createPolicyError('POLICY_VALIDATION_FAILED', 'Policy pack failed validation.', {
      errors: validation && Array.isArray(validation.errors) ? validation.errors : [],
      warnings: validation && Array.isArray(validation.warnings) ? validation.warnings : [],
      source: options.source || null,
    });
  }
  return {
    ...validation.normalizedPack,
    source: options.source || 'store',
    filePath: options.filePath || null,
    lintWarnings: Array.isArray(validation.warnings) ? validation.warnings : [],
  };
}

function isPathInsideDirectory(filePath, dirPath) {
  const relative = path.relative(path.resolve(dirPath), path.resolve(filePath));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function createPolicyRegistryService(options = {}) {
  const commandDescriptors = options.commandDescriptors || buildCommandDescriptors();
  const rootDir = options.rootDir || null;

  function validateBuiltins() {
    const items = BUILTIN_POLICY_PACKS.map((pack) => {
      const validation = validatePolicyPackDefinition(pack, {
        commandDescriptors,
        knownPackIds: BUILTIN_POLICY_PACK_IDS,
      });
      return normalizeValidatedPack(validation, { source: 'builtin' });
    });
    return items.sort((left, right) => left.id.localeCompare(right.id));
  }

  function loadRegistryBundle() {
    const builtins = validateBuiltins();
    const builtinById = new Map(builtins.map((item) => [item.id, item]));
    const { dir, files } = listStoredPolicyFiles(rootDir);
    const rawFiles = [];
    const loadErrors = [];
    const knownPackIds = new Set(BUILTIN_POLICY_PACK_IDS);

    for (const filePath of files) {
      try {
        const file = readPolicyFile(filePath);
        const rawId = file && file.data && file.data.id ? String(file.data.id).trim() : null;
        if (rawId) {
          knownPackIds.add(rawId);
        }
        rawFiles.push(file);
      } catch (error) {
        loadErrors.push({
          filePath,
          code: error && error.code ? error.code : 'POLICY_FILE_INVALID',
          message: error && error.message ? error.message : String(error),
          details: error && error.details ? error.details : null,
        });
      }
    }

    const stored = [];
    const seenStoredIds = new Set();
    for (const file of rawFiles) {
      const validation = validatePolicyPackDefinition(file.data, {
        commandDescriptors,
        knownPackIds,
      });
      if (!validation.valid || !validation.normalizedPack) {
        loadErrors.push({
          filePath: file.filePath,
          code: 'POLICY_VALIDATION_FAILED',
          message: 'Policy pack failed validation.',
          details: {
            errors: validation.errors,
            warnings: validation.warnings,
          },
        });
        continue;
      }

      const normalizedPack = validation.normalizedPack;
      if (builtinById.has(normalizedPack.id)) {
        loadErrors.push({
          filePath: file.filePath,
          code: 'POLICY_ID_CONFLICT',
          message: `Stored policy id conflicts with built-in pack: ${normalizedPack.id}`,
          details: { id: normalizedPack.id },
        });
        continue;
      }
      if (seenStoredIds.has(normalizedPack.id)) {
        loadErrors.push({
          filePath: file.filePath,
          code: 'POLICY_ID_DUPLICATE',
          message: `Duplicate stored policy id: ${normalizedPack.id}`,
          details: { id: normalizedPack.id },
        });
        continue;
      }
      seenStoredIds.add(normalizedPack.id);
      stored.push({
        ...normalizedPack,
        source: 'store',
        filePath: file.filePath,
        lintWarnings: validation.warnings,
      });
    }

    const byId = new Map();
    for (const item of [...builtins, ...stored].sort((left, right) => left.id.localeCompare(right.id))) {
      byId.set(item.id, item);
    }

    return {
      dir,
      builtins,
      stored,
      items: Array.from(byId.values()),
      byId,
      errors: loadErrors,
    };
  }

  function listPolicyPacks(filter = {}) {
    const bundle = loadRegistryBundle();
    const source = String(filter.source || 'all').trim().toLowerCase();
    const items = bundle.items.filter((item) => {
      if (source === 'builtin') return item.source === 'builtin';
      if (source === 'store') return item.source === 'store';
      return true;
    });

    return {
      dir: bundle.dir,
      schemaVersion: POLICY_SCHEMA_VERSION,
      source,
      count: items.length,
      builtinCount: bundle.builtins.length,
      storedCount: bundle.stored.length,
      errors: bundle.errors,
      items: items.map((item) => ({
        id: item.id,
        version: item.version,
        displayName: item.displayName,
        description: item.description,
        source: item.source,
        filePath: item.filePath,
        extends: item.extends,
        lintWarnings: item.lintWarnings,
      })),
    };
  }

  function getPolicyPack(policyId, options = {}) {
    const bundle = loadRegistryBundle();
    const id = String(policyId || '').trim();
    if (!id) return null;
    const pack = bundle.byId.get(id);
    if (!pack) return null;

    if (options.compiled !== true) {
      return cloneJson(pack);
    }

    const compiled = compilePack(id, bundle);
    return {
      ...cloneJson(compiled),
      registryErrors: cloneJson(bundle.errors),
    };
  }

  function lintPolicyPackFile(filePath) {
    const file = readPolicyFile(filePath);
    const bundle = loadRegistryBundle();
    const validation = validatePolicyPackDefinition(file.data, {
      commandDescriptors,
      knownPackIds: Array.from(bundle.byId.keys()),
    });

    return {
      ok: validation.valid,
      filePath: file.filePath,
      errors: validation.errors,
      warnings: validation.warnings,
      item: validation.normalizedPack,
    };
  }

  function lintPolicyPack(policyId) {
    const pack = getPolicyPack(policyId, { compiled: true });
    if (!pack) {
      throw createPolicyError('POLICY_NOT_FOUND', `Policy pack not found: ${policyId}`, { id: policyId });
    }
    return {
      ok: true,
      id: pack.id,
      source: pack.source,
      filePath: pack.filePath,
      errors: [],
      warnings: pack.lintWarnings || [],
      item: pack,
    };
  }

  function loadPolicyPackFile(filePath, options = {}) {
    const file = readPolicyFile(filePath);
    const bundle = loadRegistryBundle();
    const validation = validatePolicyPackDefinition(file.data, {
      commandDescriptors,
      knownPackIds: Array.from(bundle.byId.keys()),
    });
    const normalizedPack = normalizeValidatedPack(validation, { source: 'store', filePath: file.filePath });

    if (BUILTIN_POLICY_PACK_IDS.includes(normalizedPack.id)) {
      throw createPolicyError('POLICY_ID_CONFLICT', `Cannot overwrite built-in policy pack: ${normalizedPack.id}`, {
        id: normalizedPack.id,
      });
    }

    const writeResult = writeStoredPolicyPack(serializePolicyPackDefinition(normalizedPack), {
      rootDir,
      replace: options.replace === true,
    });
    if (
      file.filePath !== writeResult.filePath
      && isPathInsideDirectory(file.filePath, bundle.dir)
      && fs.existsSync(file.filePath)
    ) {
      fs.unlinkSync(file.filePath);
    }
    const storedPack = getPolicyPack(normalizedPack.id, { compiled: true });
    return {
      ok: true,
      replaced: writeResult.replaced,
      filePath: writeResult.filePath,
      warnings: normalizedPack.lintWarnings || [],
      item: storedPack,
    };
  }

  function resolvePolicyDirPath() {
    return resolvePolicyDir(rootDir);
  }

  return {
    listPolicyPacks,
    getPolicyPack,
    lintPolicyPack,
    lintPolicyPackFile,
    loadPolicyPackFile,
    resolvePolicyDir: resolvePolicyDirPath,
    readOnlyErrors: () => loadRegistryBundle().errors,
  };
}

module.exports = {
  POLICY_SCHEMA_VERSION,
  createPolicyRegistryService,
};
