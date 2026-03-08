'use strict';

const {
  POLICY_SCHEMA_VERSION,
  POLICY_PACK_KIND,
  POLICY_ID_PATTERN,
  POLICY_RULE_EFFECTS,
  POLICY_RULE_KINDS,
  POLICY_MATCH_FIELDS,
  POLICY_DESCRIPTOR_RISK_LEVELS,
  POLICY_CONTEXT_FIELDS,
  POLICY_EXTERNAL_DEPENDENCIES,
  POLICY_REMEDIATION_ACTION_TYPES,
} = require('./policy_constants.cjs');

function createPolicyError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeLowerText(value) {
  const text = normalizeText(value);
  return text ? text.toLowerCase() : null;
}

function pushIssue(bucket, issue) {
  bucket.push(issue);
}

function issue(code, path, message, details) {
  const payload = { code, path, message };
  if (details !== undefined) {
    payload.details = details;
  }
  return payload;
}

function toOrderedStringArray(value, options = {}) {
  const source = value === undefined || value === null
    ? []
    : Array.isArray(value)
      ? value
      : [value];
  const seen = new Set();
  const result = [];
  for (const entry of source) {
    const text = options.lowercase ? normalizeLowerText(entry) : normalizeText(entry);
    if (!text) continue;
    const key = options.caseSensitive === true ? text : text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function toNonNegativeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function splitFieldTokens(value) {
  const raw = String(value || '')
    .trim()
    .replace(/^--/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2');
  return raw
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function buildFieldVariants(fieldName) {
  const tokens = splitFieldTokens(fieldName);
  if (!tokens.length) return [];
  const kebab = tokens.join('-');
  const snake = tokens.join('_');
  const camel = tokens
    .map((token, index) => (index === 0 ? token : `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`))
    .join('');
  return Array.from(new Set([kebab, snake, camel]));
}

function getDescriptorInputFields(descriptor) {
  const fields = new Set();
  if (descriptor && descriptor.inputSchema && isPlainObject(descriptor.inputSchema.properties)) {
    for (const name of Object.keys(descriptor.inputSchema.properties)) {
      for (const variant of buildFieldVariants(name)) {
        fields.add(variant);
      }
    }
  }
  if (descriptor && Array.isArray(descriptor.controlInputNames)) {
    for (const name of descriptor.controlInputNames) {
      for (const variant of buildFieldVariants(name)) {
        fields.add(variant);
      }
    }
  }
  if (descriptor && Array.isArray(descriptor.safeFlags)) {
    for (const flagName of descriptor.safeFlags) {
      for (const variant of buildFieldVariants(flagName)) {
        fields.add(variant);
      }
    }
  }
  if (descriptor && Array.isArray(descriptor.executeFlags)) {
    for (const flagName of descriptor.executeFlags) {
      for (const variant of buildFieldVariants(flagName)) {
        fields.add(variant);
      }
    }
  }
  return fields;
}

function lookupCommandsByPrefix(commandDescriptors, prefix) {
  const normalizedPrefix = normalizeText(prefix);
  if (!normalizedPrefix || !commandDescriptors) return [];
  return Object.keys(commandDescriptors).filter(
    (commandName) => commandName === normalizedPrefix || commandName.startsWith(`${normalizedPrefix}.`),
  );
}

function validateCommandReferences(values, path, errors, commandDescriptors) {
  for (const commandName of values) {
    if (!commandDescriptors || commandDescriptors[commandName]) continue;
    pushIssue(
      errors,
      issue('POLICY_UNKNOWN_COMMAND', path, `Unknown command reference: ${commandName}`, { commandName }),
    );
  }
}

function validateCommandPrefixes(values, path, errors, commandDescriptors) {
  for (const prefix of values) {
    if (!commandDescriptors) continue;
    if (lookupCommandsByPrefix(commandDescriptors, prefix).length > 0) continue;
    pushIssue(
      errors,
      issue('POLICY_UNKNOWN_COMMAND_PREFIX', path, `Command prefix does not match any known command: ${prefix}`, { prefix }),
    );
  }
}

function normalizeResult(raw, path, errors) {
  if (!isPlainObject(raw)) {
    pushIssue(errors, issue('POLICY_RESULT_REQUIRED', path, 'Rule result must be an object.'));
    return null;
  }

  const code = normalizeText(raw.code);
  const message = normalizeText(raw.message);
  if (!code) {
    pushIssue(errors, issue('POLICY_RESULT_CODE_REQUIRED', `${path}.code`, 'Rule result code is required.'));
  }
  if (!message) {
    pushIssue(errors, issue('POLICY_RESULT_MESSAGE_REQUIRED', `${path}.message`, 'Rule result message is required.'));
  }

  let remediation = null;
  if (raw.remediation !== undefined && raw.remediation !== null) {
    if (!isPlainObject(raw.remediation)) {
      pushIssue(errors, issue('POLICY_REMEDIATION_INVALID', `${path}.remediation`, 'Rule remediation must be an object.'));
    } else {
      const actions = Array.isArray(raw.remediation.actions)
        ? raw.remediation.actions
            .map((action, index) => {
              if (!isPlainObject(action)) {
                pushIssue(
                  errors,
                  issue('POLICY_REMEDIATION_ACTION_INVALID', `${path}.remediation.actions[${index}]`, 'Remediation action must be an object.'),
                );
                return null;
              }
              const actionType = normalizeText(action.type);
              if (!actionType || !POLICY_REMEDIATION_ACTION_TYPES.includes(actionType)) {
                pushIssue(
                  errors,
                  issue(
                    'POLICY_REMEDIATION_ACTION_TYPE_INVALID',
                    `${path}.remediation.actions[${index}].type`,
                    `Unsupported remediation action type: ${action.type}`,
                  ),
                );
                return null;
              }
              return {
                type: actionType,
                ...cloneJson(action),
              };
            })
            .filter(Boolean)
        : [];
      remediation = {
        summary: normalizeText(raw.remediation.summary),
        actions,
      };
    }
  }

  return {
    code,
    message,
    remediation,
  };
}

function normalizeMatch(raw, path, errors, commandDescriptors) {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    pushIssue(errors, issue('POLICY_MATCH_INVALID', path, 'Rule match must be an object.'));
    return null;
  }

  for (const key of Object.keys(raw)) {
    if (!POLICY_MATCH_FIELDS.includes(key)) {
      pushIssue(errors, issue('POLICY_MATCH_FIELD_UNKNOWN', `${path}.${key}`, `Unknown match field: ${key}`));
    }
  }

  const commands = toOrderedStringArray(raw.commands);
  const commandPrefixes = toOrderedStringArray(raw.commandPrefixes);
  const policyScopesAny = toOrderedStringArray(raw.policyScopesAny);
  const riskLevels = toOrderedStringArray(raw.riskLevels, { lowercase: true });

  validateCommandReferences(commands, `${path}.commands`, errors, commandDescriptors);
  validateCommandPrefixes(commandPrefixes, `${path}.commandPrefixes`, errors, commandDescriptors);

  for (const riskLevel of riskLevels) {
    if (!POLICY_DESCRIPTOR_RISK_LEVELS.includes(riskLevel)) {
      pushIssue(
        errors,
        issue('POLICY_RISK_LEVEL_INVALID', `${path}.riskLevels`, `Unsupported risk level: ${riskLevel}`, { riskLevel }),
      );
    }
  }

  return {
    commandKnown: raw.commandKnown === undefined ? null : Boolean(raw.commandKnown),
    commands,
    commandPrefixes,
    jobCapable: raw.jobCapable === undefined ? null : Boolean(raw.jobCapable),
    liveRequested: raw.liveRequested === undefined ? null : Boolean(raw.liveRequested),
    longRunning: raw.longRunning === undefined ? null : Boolean(raw.longRunning),
    mutating: raw.mutating === undefined ? null : Boolean(raw.mutating),
    policyScopesAny,
    requiresSecrets: raw.requiresSecrets === undefined ? null : Boolean(raw.requiresSecrets),
    riskLevels,
    safeModeRequested: raw.safeModeRequested === undefined ? null : Boolean(raw.safeModeRequested),
    validationSupported: raw.validationSupported === undefined ? null : Boolean(raw.validationSupported),
  };
}

function normalizeNumericField(rawField, path, errors, commandDescriptors) {
  const field = normalizeText(rawField);
  if (!field) {
    pushIssue(errors, issue('POLICY_FIELD_REQUIRED', path, 'Rule field is required.'));
    return null;
  }
  const variants = buildFieldVariants(field);
  if (!variants.length) {
    pushIssue(errors, issue('POLICY_FIELD_INVALID', path, `Invalid field name: ${field}`, { field }));
    return null;
  }

  if (commandDescriptors) {
    const known = Object.values(commandDescriptors).some((descriptor) => {
      const fields = getDescriptorInputFields(descriptor);
      return variants.some((variant) => fields.has(variant));
    });
    if (!known) {
      pushIssue(
        errors,
        issue(
          'POLICY_FIELD_UNKNOWN',
          path,
          `Field does not appear in any known command input/control contract: ${field}`,
          { field },
        ),
      );
    }
  }

  return variants[0];
}

function normalizeRule(raw, path, errors, commandDescriptors) {
  if (!isPlainObject(raw)) {
    pushIssue(errors, issue('POLICY_RULE_INVALID', path, 'Each rule must be an object.'));
    return null;
  }

  const id = normalizeText(raw.id);
  if (!id || !POLICY_ID_PATTERN.test(id)) {
    pushIssue(errors, issue('POLICY_RULE_ID_INVALID', `${path}.id`, 'Rule id must be kebab-case.'));
  }

  const kind = normalizeText(raw.kind);
  if (!kind || !POLICY_RULE_KINDS.includes(kind)) {
    pushIssue(
      errors,
      issue('POLICY_RULE_KIND_INVALID', `${path}.kind`, `Unsupported policy rule kind: ${raw.kind}`),
    );
  }

  const effect = normalizeLowerText(raw.effect) || 'deny';
  if (!POLICY_RULE_EFFECTS.includes(effect)) {
    pushIssue(
      errors,
      issue('POLICY_RULE_EFFECT_INVALID', `${path}.effect`, `Unsupported rule effect: ${raw.effect}`),
    );
  }

  const match = normalizeMatch(raw.match, `${path}.match`, errors, commandDescriptors);
  const result = normalizeResult(raw.result, `${path}.result`, errors);

  const normalized = {
    id,
    kind,
    description: normalizeText(raw.description),
    effect,
    match,
    result,
  };

  if (kind === 'allow_commands_only' || kind === 'deny_commands') {
    normalized.commands = toOrderedStringArray(raw.commands);
    normalized.commandPrefixes = toOrderedStringArray(raw.commandPrefixes);
    if (!normalized.commands.length && !normalized.commandPrefixes.length) {
      pushIssue(
        errors,
        issue(
          'POLICY_RULE_COMMAND_SET_REQUIRED',
          path,
          `${kind} requires commands and/or commandPrefixes.`,
        ),
      );
    }
    validateCommandReferences(normalized.commands, `${path}.commands`, errors, commandDescriptors);
    validateCommandPrefixes(normalized.commandPrefixes, `${path}.commandPrefixes`, errors, commandDescriptors);
    return normalized;
  }

  if (kind === 'allow_external_dependencies') {
    normalized.dependencies = toOrderedStringArray(raw.dependencies, { lowercase: true });
    if (!normalized.dependencies.length) {
      pushIssue(errors, issue('POLICY_RULE_DEPENDENCIES_REQUIRED', path, 'dependencies is required.'));
    }
    for (const dependency of normalized.dependencies) {
      if (!POLICY_EXTERNAL_DEPENDENCIES.includes(dependency)) {
        pushIssue(
          errors,
          issue(
            'POLICY_RULE_DEPENDENCY_INVALID',
            `${path}.dependencies`,
            `Unsupported external dependency: ${dependency}`,
            { dependency },
          ),
        );
      }
    }
    return normalized;
  }

  if (kind === 'allow_input_enum') {
    normalized.field = normalizeNumericField(raw.field, `${path}.field`, errors, commandDescriptors);
    normalized.values = toOrderedStringArray(raw.values, { lowercase: true });
    if (!normalized.values.length) {
      pushIssue(errors, issue('POLICY_RULE_VALUES_REQUIRED', `${path}.values`, 'values is required.'));
    }
    return normalized;
  }

  if (kind === 'max_input_number') {
    normalized.field = normalizeNumericField(raw.field, `${path}.field`, errors, commandDescriptors);
    normalized.limit = toNonNegativeNumber(raw.limit);
    if (normalized.limit === null) {
      pushIssue(errors, issue('POLICY_RULE_LIMIT_INVALID', `${path}.limit`, 'limit must be a non-negative number.'));
    }
    return normalized;
  }

  if (kind === 'max_context_number') {
    normalized.field = normalizeText(raw.field);
    if (!normalized.field || !POLICY_CONTEXT_FIELDS.includes(normalized.field)) {
      pushIssue(
        errors,
        issue(
          'POLICY_RULE_CONTEXT_FIELD_INVALID',
          `${path}.field`,
          `field must be one of: ${POLICY_CONTEXT_FIELDS.join(', ')}`,
        ),
      );
    }
    normalized.limit = toNonNegativeNumber(raw.limit);
    if (normalized.limit === null) {
      pushIssue(errors, issue('POLICY_RULE_LIMIT_INVALID', `${path}.limit`, 'limit must be a non-negative number.'));
    }
    return normalized;
  }

  if (kind === 'require_validation') {
    normalized.acceptedDecisions = toOrderedStringArray(raw.acceptedDecisions, { lowercase: true });
    if (!normalized.acceptedDecisions.length) {
      normalized.acceptedDecisions = ['pass'];
    }
    return normalized;
  }

  return normalized;
}

function compactRecord(record) {
  const output = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (isPlainObject(value) && Object.keys(value).length === 0) continue;
    output[key] = value;
  }
  return output;
}

function serializeRuleMatch(match) {
  if (!isPlainObject(match)) return undefined;
  return compactRecord({
    commandKnown: match.commandKnown,
    commands: toOrderedStringArray(match.commands),
    commandPrefixes: toOrderedStringArray(match.commandPrefixes),
    jobCapable: match.jobCapable,
    liveRequested: match.liveRequested,
    longRunning: match.longRunning,
    mutating: match.mutating,
    policyScopesAny: toOrderedStringArray(match.policyScopesAny),
    requiresSecrets: match.requiresSecrets,
    riskLevels: toOrderedStringArray(match.riskLevels, { lowercase: true }),
    safeModeRequested: match.safeModeRequested,
    validationSupported: match.validationSupported,
  });
}

function serializeRuleResult(result) {
  const normalizedResult = isPlainObject(result) ? result : {};
  const remediation = isPlainObject(normalizedResult.remediation)
    ? compactRecord({
        summary: normalizeText(normalizedResult.remediation.summary),
        actions: Array.isArray(normalizedResult.remediation.actions)
          ? normalizedResult.remediation.actions
              .filter((action) => isPlainObject(action))
              .map((action) => cloneJson(action))
          : [],
      })
    : undefined;
  return compactRecord({
    code: normalizeText(normalizedResult.code),
    message: normalizeText(normalizedResult.message),
    remediation,
  });
}

function serializeRuleDefinition(rule) {
  const normalizedRule = isPlainObject(rule) ? rule : {};
  return compactRecord({
    id: normalizeText(normalizedRule.id),
    kind: normalizeText(normalizedRule.kind),
    description: normalizeText(normalizedRule.description),
    ...(normalizeLowerText(normalizedRule.effect) === 'warn' ? { effect: 'warn' } : {}),
    match: serializeRuleMatch(normalizedRule.match),
    result: serializeRuleResult(normalizedRule.result),
    commands: toOrderedStringArray(normalizedRule.commands),
    commandPrefixes: toOrderedStringArray(normalizedRule.commandPrefixes),
    dependencies: toOrderedStringArray(normalizedRule.dependencies, { lowercase: true }),
    field: normalizeText(normalizedRule.field),
    limit: toNonNegativeNumber(normalizedRule.limit),
    values: toOrderedStringArray(normalizedRule.values, { lowercase: true }),
    acceptedDecisions: toOrderedStringArray(normalizedRule.acceptedDecisions, { lowercase: true }),
  });
}

function serializePolicyPackDefinition(policyPack) {
  const normalizedPack = isPlainObject(policyPack) ? policyPack : {};
  return compactRecord({
    schemaVersion: normalizeText(normalizedPack.schemaVersion) || POLICY_SCHEMA_VERSION,
    kind: normalizeText(normalizedPack.kind) || POLICY_PACK_KIND,
    id: normalizeText(normalizedPack.id),
    version: normalizeText(normalizedPack.version) || POLICY_SCHEMA_VERSION,
    displayName: normalizeText(normalizedPack.displayName),
    description: normalizeText(normalizedPack.description),
    extends: toOrderedStringArray(normalizedPack.extends),
    notes: toOrderedStringArray(normalizedPack.notes),
    rules: Array.isArray(normalizedPack.rules)
      ? normalizedPack.rules.map((rule) => serializeRuleDefinition(rule))
      : [],
  });
}

function validatePolicyPackDefinition(rawPack, options = {}) {
  const commandDescriptors = isPlainObject(options.commandDescriptors) ? options.commandDescriptors : null;
  const knownPackIds = new Set(toOrderedStringArray(options.knownPackIds));
  const errors = [];
  const warnings = [];

  if (!isPlainObject(rawPack)) {
    return {
      valid: false,
      errors: [issue('POLICY_PACK_INVALID', '$', 'Policy pack must be a JSON object.')],
      warnings,
      normalizedPack: null,
    };
  }

  const schemaVersion = normalizeText(rawPack.schemaVersion) || POLICY_SCHEMA_VERSION;
  if (schemaVersion !== POLICY_SCHEMA_VERSION) {
    pushIssue(
      errors,
      issue(
        'POLICY_SCHEMA_VERSION_UNSUPPORTED',
        '$.schemaVersion',
        `Unsupported policy schema version: ${schemaVersion}`,
        { schemaVersion, supported: POLICY_SCHEMA_VERSION },
      ),
    );
  }

  const kind = normalizeText(rawPack.kind) || POLICY_PACK_KIND;
  if (kind !== POLICY_PACK_KIND) {
    pushIssue(errors, issue('POLICY_KIND_INVALID', '$.kind', `Policy kind must be "${POLICY_PACK_KIND}".`));
  }

  const id = normalizeText(rawPack.id);
  if (!id || !POLICY_ID_PATTERN.test(id)) {
    pushIssue(errors, issue('POLICY_ID_INVALID', '$.id', 'Policy id must be kebab-case.'));
  }

  const version = normalizeText(rawPack.version) || POLICY_SCHEMA_VERSION;
  const displayName = normalizeText(rawPack.displayName) || id;
  const description = normalizeText(rawPack.description);
  if (!description) {
    pushIssue(errors, issue('POLICY_DESCRIPTION_REQUIRED', '$.description', 'Policy description is required.'));
  }

  const extendsList = toOrderedStringArray(rawPack.extends);
  for (const parentId of extendsList) {
    if (!knownPackIds.has(parentId) && options.allowUnresolvedExtends !== true) {
      pushIssue(
        errors,
        issue(
          'POLICY_EXTENDS_UNKNOWN',
          '$.extends',
          `Policy pack extends unknown pack: ${parentId}`,
          { parentId },
        ),
      );
    }
  }

  const rulesRaw = Array.isArray(rawPack.rules) ? rawPack.rules : [];
  if (!rulesRaw.length && !extendsList.length) {
    pushIssue(
      errors,
      issue('POLICY_RULES_REQUIRED', '$.rules', 'Policy pack must define at least one rule or extend another pack.'),
    );
  }

  const seenRuleIds = new Set();
  const normalizedRules = rulesRaw
    .map((rule, index) => normalizeRule(rule, `$.rules[${index}]`, errors, commandDescriptors))
    .filter(Boolean)
    .filter((rule) => {
      if (!rule.id) return true;
      if (seenRuleIds.has(rule.id)) {
        pushIssue(
          errors,
          issue('POLICY_RULE_ID_DUPLICATE', '$.rules', `Duplicate rule id within pack: ${rule.id}`, { ruleId: rule.id }),
        );
        return false;
      }
      seenRuleIds.add(rule.id);
      return true;
    });

  const normalizedPack = errors.length
    ? null
    : {
        schemaVersion,
        kind,
        id,
        version,
        displayName,
        description,
        extends: extendsList,
        notes: toOrderedStringArray(rawPack.notes),
        rules: normalizedRules,
      };

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalizedPack,
  };
}

module.exports = {
  createPolicyError,
  isPlainObject,
  normalizeText,
  buildFieldVariants,
  getDescriptorInputFields,
  serializePolicyPackDefinition,
  validatePolicyPackDefinition,
};
