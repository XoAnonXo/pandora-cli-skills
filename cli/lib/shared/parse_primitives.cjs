function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParsePrimitives requires deps.${name}()`);
  }
  return deps[name];
}

function requireListDep(deps, name) {
  if (!deps || !Array.isArray(deps[name])) {
    throw new Error(`createParsePrimitives requires array deps.${name}`);
  }
  return deps[name];
}

/**
 * Creates shared parser primitives used by command parser modules.
 * @param {object} deps
 * @returns {object}
 */
function createParsePrimitives(deps) {
  const CliError = requireDep(deps, 'CliError');
  const getMirrorSyncGateCodes = requireDep(deps, 'getMirrorSyncGateCodes');
  const positionsOrderByFields = requireListDep(deps, 'positionsOrderByFields');
  const positionsOrderByFieldSet =
    deps.positionsOrderByFieldSet instanceof Set
      ? deps.positionsOrderByFieldSet
      : new Set(positionsOrderByFields);

  function parseDateLikeFlag(value, flagName) {
    const text = String(value || '').trim();
    if (/^-?\d+(\.\d+)?$/.test(text)) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `${flagName} must be a date/time string (for example: "2026-03-15" or "2026-03-15T18:00:00Z"), not a bare number.`,
      );
    }
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
    const isDateTime =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(text);
    if (!isDateOnly && !isDateTime) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `${flagName} must be an ISO date/time string (for example: "2026-03-15" or "2026-03-15T18:00:00Z"). Received: "${text}"`,
      );
    }
    const normalized = isDateOnly ? `${text}T00:00:00Z` : text;
    const parsed = Date.parse(normalized);
    if (Number.isNaN(parsed)) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `${flagName} must be a valid date/time string (for example: "2026-03-15" or "2026-03-15T18:00:00Z"). Received: "${text}"`,
      );
    }
    if (isDateOnly && new Date(parsed).toISOString().slice(0, 10) !== text) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `${flagName} must be a real calendar date (YYYY-MM-DD). Received: "${text}"`,
      );
    }
    return text;
  }

  function parseDotEnv(content) {
    const env = {};
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;

      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      env[key] = value;
    }

    return env;
  }

  function parsePositiveInteger(value, flagName) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer. Received: "${value}"`);
    }
    return parsed;
  }

  function parseInteger(value, flagName) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be an integer. Received: "${value}"`);
    }
    return parsed;
  }

  function parseNonNegativeInteger(value, flagName) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a non-negative integer. Received: "${value}"`);
    }
    return parsed;
  }

  function parsePositiveNumber(value, flagName) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive number. Received: "${value}"`);
    }
    return parsed;
  }

  function parseNumber(value, flagName) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a numeric value. Received: "${value}"`);
    }
    return parsed;
  }

  function parseCsvList(value, flagName) {
    const list = String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!list.length) {
      throw new CliError('INVALID_FLAG_VALUE', `${flagName} must include at least one comma-separated value.`);
    }
    return list;
  }

  function parseMirrorSyncGateSkipList(value, flagName = '--skip-gate') {
    const allowedCodesRaw = getMirrorSyncGateCodes();
    const allowedCodes = Array.isArray(allowedCodesRaw) ? allowedCodesRaw : [];
    const allowedSet = new Set(allowedCodes);
    const checks = parseCsvList(value, flagName).map((item) => item.toUpperCase());
    const invalid = checks.filter((code) => !allowedSet.has(code));
    if (invalid.length) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `${flagName} includes unknown check code(s): ${invalid.join(', ')}. Allowed values: ${allowedCodes.join(', ')}.`,
      );
    }
    return Array.from(new Set(checks));
  }

  function mergeMirrorSyncGateSkipLists(current, incoming) {
    const left = Array.isArray(current) ? current : [];
    const right = Array.isArray(incoming) ? incoming : [];
    return Array.from(new Set([...left, ...right]));
  }

  function parseCsvNumberList(value, flagName, options = {}) {
    const allowZero = options.allowZero !== false;
    const list = String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => Number(item));

    if (!list.length) {
      throw new CliError('INVALID_FLAG_VALUE', `${flagName} must include at least one comma-separated number.`);
    }

    const invalid = list.find((item) => !Number.isFinite(item) || item < 0 || (!allowZero && item === 0));
    if (invalid !== undefined) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `${flagName} must contain ${allowZero ? 'non-negative' : 'positive'} numeric values.`,
      );
    }
    return list;
  }

  function parseProbabilityPercent(value, flagName) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be between 0 and 100. Received: "${value}"`);
    }
    return parsed;
  }

  function parseBigIntString(value, flagName) {
    try {
      const parsed = BigInt(value);
      if (parsed < 0n) {
        throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a non-negative integer. Received: "${value}"`);
      }
      return parsed;
    } catch (err) {
      if (err instanceof CliError) throw err;
      throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a non-negative integer. Received: "${value}"`);
    }
  }

  function parseOutcomeSide(value, flagName = '--side') {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (['yes', 'y', 'true', '1'].includes(normalized)) return 'yes';
    if (['no', 'n', 'false', '0'].includes(normalized)) return 'no';
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be yes or no. Received: "${value}"`);
  }

  function isValidAddress(value) {
    return /^0x[a-fA-F0-9]{40}$/.test(value);
  }

  function parseAddressFlag(value, flagName) {
    if (!isValidAddress(value)) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `${flagName} must be a valid 20-byte hex address (0x + 40 hex chars). Received: "${value}"`,
      );
    }
    return value.toLowerCase();
  }

  function redactSensitiveValue(value) {
    const text = String(value || '').trim();
    if (!text || text.length <= 10) return '[redacted]';
    return `${text.slice(0, 6)}...${text.slice(-4)}`;
  }

  function isValidPrivateKey(value) {
    return /^0x[a-fA-F0-9]{64}$/.test(value);
  }

  function parsePrivateKeyFlag(value, flagName = '--private-key') {
    if (!isValidPrivateKey(value)) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `${flagName} must be a valid private key (0x + 64 hex chars). Received: "${redactSensitiveValue(value)}"`,
      );
    }
    return value;
  }

  function parsePositionsOrderBy(value) {
    if (!positionsOrderByFieldSet.has(value)) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `--order-by must be one of ${positionsOrderByFields.join(', ')}. Received: "${value}"`,
      );
    }
    return value;
  }

  function requireFlagValue(args, index, flagName) {
    const next = args[index + 1];
    if (!next) {
      throw new CliError('MISSING_FLAG_VALUE', `Missing value for ${flagName}`);
    }
    return next;
  }

  function mergeWhere(where, jsonText, flagName) {
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new CliError('INVALID_JSON', `${flagName} must be valid JSON.`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new CliError('INVALID_JSON', `${flagName} must decode to a JSON object.`);
    }

    const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
    for (const key of Object.keys(parsed)) {
      if (forbiddenKeys.has(key)) {
        throw new CliError('INVALID_JSON', `${flagName} contains forbidden key: "${key}".`);
      }
    }

    return { ...where, ...parsed };
  }

  function normalizeDirection(raw) {
    const value = String(raw).trim().toLowerCase();
    if (value !== 'asc' && value !== 'desc') {
      throw new CliError('INVALID_FLAG_VALUE', `--order-direction must be asc or desc. Received: "${raw}"`);
    }
    return value;
  }

  return {
    parseDateLikeFlag,
    parseDotEnv,
    parsePositiveInteger,
    parseInteger,
    parseNonNegativeInteger,
    parsePositiveNumber,
    parseNumber,
    parseCsvList,
    parseMirrorSyncGateSkipList,
    mergeMirrorSyncGateSkipLists,
    parseCsvNumberList,
    parseProbabilityPercent,
    parseBigIntString,
    parseOutcomeSide,
    parseAddressFlag,
    parsePrivateKeyFlag,
    parsePositionsOrderBy,
    requireFlagValue,
    mergeWhere,
    normalizeDirection,
    isValidAddress,
    isValidPrivateKey,
  };
}

module.exports = {
  createParsePrimitives,
};
