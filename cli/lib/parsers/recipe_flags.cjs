'use strict';

const path = require('node:path');
const { assertMcpWorkspacePath } = require('../shared/mcp_path_guard.cjs');

function createParseRecipeFlags(deps = {}) {
  const CliError = deps.CliError;
  const requireFlagValue = deps.requireFlagValue;
  if (typeof CliError !== 'function' || typeof requireFlagValue !== 'function') {
    throw new Error('createParseRecipeFlags requires CliError and requireFlagValue.');
  }

  function resolveFile(next, flagName) {
    assertMcpWorkspacePath(next, {
      flagName,
      errorFactory: (code, message, details) => new CliError(code, message, details),
    });
    return path.resolve(process.cwd(), next);
  }

  function parseSetToken(rawToken) {
    const text = String(rawToken || '').trim();
    const separator = text.indexOf('=');
    if (separator <= 0) {
      throw new CliError('INVALID_FLAG_VALUE', '--set requires key=value.', { value: rawToken });
    }
    return {
      key: text.slice(0, separator).trim().toLowerCase(),
      value: text.slice(separator + 1).trim(),
    };
  }

  function loadEnvInputs() {
    const raw = process.env.PANDORA_RECIPE_INPUTS;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return {};
    }
    let parsed;
    try {
      parsed = JSON.parse(String(raw));
    } catch (error) {
      throw new CliError('INVALID_FLAG_VALUE', 'PANDORA_RECIPE_INPUTS must be valid JSON.', {
        env: 'PANDORA_RECIPE_INPUTS',
        cause: error.message,
      });
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new CliError('INVALID_FLAG_VALUE', 'PANDORA_RECIPE_INPUTS must decode to an object.', {
        env: 'PANDORA_RECIPE_INPUTS',
      });
    }
    const normalized = {};
    for (const [key, value] of Object.entries(parsed)) {
      const normalizedKey = String(key || '').trim().toLowerCase();
      if (!normalizedKey) continue;
      normalized[normalizedKey] = value;
    }
    return normalized;
  }

  return function parseRecipeFlags(args = []) {
    const action = String(args[0] || '').trim();
    const rest = args.slice(1);
    const options = {
      action,
      id: null,
      file: null,
      policyId: null,
      profileId: null,
      timeoutMs: null,
      source: 'all',
      approvalStatus: 'all',
      riskLevel: 'all',
      inputs: loadEnvInputs(),
    };

    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index];
      if (!token) continue;
      if (token === '--id') {
        options.id = String(requireFlagValue(rest, index, '--id')).trim();
        index += 1;
        continue;
      }
      if (token === '--file') {
        options.file = resolveFile(requireFlagValue(rest, index, '--file'), '--file');
        index += 1;
        continue;
      }
      if (token === '--policy-id') {
        options.policyId = String(requireFlagValue(rest, index, '--policy-id')).trim();
        index += 1;
        continue;
      }
      if (token === '--profile-id') {
        options.profileId = String(requireFlagValue(rest, index, '--profile-id')).trim();
        index += 1;
        continue;
      }
      if (token === '--timeout-ms') {
        const parsed = Number(requireFlagValue(rest, index, '--timeout-ms'));
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new CliError('INVALID_FLAG_VALUE', '--timeout-ms must be a positive integer.', { flag: '--timeout-ms' });
        }
        options.timeoutMs = Math.trunc(parsed);
        index += 1;
        continue;
      }
      if (token === '--source') {
        const value = String(requireFlagValue(rest, index, '--source')).trim().toLowerCase();
        if (!['first-party', 'user', 'all'].includes(value)) {
          throw new CliError('INVALID_FLAG_VALUE', '--source must be first-party, user, or all.', { flag: '--source', value });
        }
        options.source = value;
        index += 1;
        continue;
      }
      if (token === '--approval-status') {
        const value = String(requireFlagValue(rest, index, '--approval-status')).trim().toLowerCase();
        if (!['approved', 'unreviewed', 'experimental', 'deprecated', 'all'].includes(value)) {
          throw new CliError('INVALID_FLAG_VALUE', '--approval-status must be approved, unreviewed, experimental, deprecated, or all.', { flag: '--approval-status', value });
        }
        options.approvalStatus = value;
        index += 1;
        continue;
      }
      if (token === '--risk-level') {
        const value = String(requireFlagValue(rest, index, '--risk-level')).trim().toLowerCase();
        if (!['read-only', 'paper', 'dry-run', 'live', 'all'].includes(value)) {
          throw new CliError('INVALID_FLAG_VALUE', '--risk-level must be read-only, paper, dry-run, live, or all.', { flag: '--risk-level', value });
        }
        options.riskLevel = value;
        index += 1;
        continue;
      }
      if (token === '--set') {
        const parsed = parseSetToken(requireFlagValue(rest, index, '--set'));
        options.inputs[parsed.key] = parsed.value;
        index += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for recipe ${action || '<none>'}: ${token}`, {
        action,
        flag: token,
      });
    }

    if (!action) {
      throw new CliError('INVALID_ARGS', 'recipe requires subcommand: list|get|validate|run');
    }
    if (!['list', 'get', 'validate', 'run'].includes(action)) {
      throw new CliError('INVALID_ARGS', `recipe requires subcommand: list|get|validate|run. Received: ${action}`);
    }
    if (['get', 'validate', 'run'].includes(action) && !options.id && !options.file) {
      throw new CliError('MISSING_REQUIRED_FLAG', `${action} requires --id <recipe-id> or --file <path>.`);
    }
    if (options.id && options.file) {
      throw new CliError('INVALID_FLAG_COMBINATION', '--id and --file are mutually exclusive for recipe commands.');
    }
    if (action !== 'list' && (
      options.source !== 'all'
      || options.approvalStatus !== 'all'
      || options.riskLevel !== 'all'
    )) {
      throw new CliError('INVALID_FLAG_COMBINATION', '--source, --approval-status, and --risk-level are only supported for recipe list.');
    }
    return options;
  };
}

module.exports = {
  createParseRecipeFlags,
};
