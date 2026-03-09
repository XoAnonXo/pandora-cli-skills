'use strict';

const path = require('path');
const { assertMcpWorkspacePath } = require('../shared/mcp_path_guard.cjs');

const POLICY_CONTEXT_MODES = new Set(['safe', 'dry-run', 'paper', 'fork', 'execute', 'execute-live']);
const NUMERIC_POLICY_FLAGS = Object.freeze({
  '--active-operation-count': 'activeOperationCount',
  '--notional-usd': 'notionalUsd',
  '--notional-usdc': 'notionalUsdc',
  '--projected-trades-today': 'projectedTradesToday',
  '--runtime-seconds': 'runtimeSeconds',
});

function createParsePolicyFlags(deps = {}) {
  const CliError = deps.CliError;
  const requireFlagValue = deps.requireFlagValue;
  if (typeof CliError !== 'function' || typeof requireFlagValue !== 'function') {
    throw new Error('createParsePolicyFlags requires CliError and requireFlagValue.');
  }

  function resolveFile(next, flagName) {
    const resolved = assertMcpWorkspacePath(next, {
      flagName,
      errorFactory: (code, message, details) => new CliError(code, message, details),
    });
    return path.resolve(resolved);
  }

  function normalizeOptionalString(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text || null;
  }

  function readNumericFlag(rest, index, token) {
    const rawValue = requireFlagValue(rest, index, token);
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      throw new CliError('INVALID_FLAG_VALUE', `${token} must be a number.`, {
        flag: token,
        received: rawValue,
      });
    }
    return value;
  }

  return function parsePolicyFlags(args = []) {
    const action = String(args[0] || '').trim();
    const rest = args.slice(1);
    const options = {
      action,
      id: null,
      file: null,
      command: null,
      mode: null,
      chainId: null,
      category: null,
      profileId: null,
      secretSource: null,
      validationTicket: null,
      validationDecision: null,
      agentPreflight: false,
      webhookUrl: null,
      externalDependencies: [],
      activeOperationCount: null,
      notionalUsd: null,
      notionalUsdc: null,
      projectedTradesToday: null,
      runtimeSeconds: null,
    };

    const allowedFlagsByAction = {
      list: new Set([]),
      get: new Set(['--id']),
      lint: new Set(['--file']),
      explain: new Set([
        '--id',
        '--command',
        '--mode',
        '--chain-id',
        '--category',
        '--profile-id',
        '--secret-source',
        '--validation-ticket',
        '--validation-decision',
        '--agent-preflight',
        '--webhook-url',
        '--external-dependency',
        '--active-operation-count',
        '--notional-usd',
        '--notional-usdc',
        '--projected-trades-today',
        '--runtime-seconds',
      ]),
      recommend: new Set([
        '--command',
        '--mode',
        '--chain-id',
        '--category',
        '--profile-id',
        '--secret-source',
        '--validation-ticket',
        '--validation-decision',
        '--agent-preflight',
        '--webhook-url',
        '--external-dependency',
        '--active-operation-count',
        '--notional-usd',
        '--notional-usdc',
        '--projected-trades-today',
        '--runtime-seconds',
      ]),
    };
    const allowedFlags = allowedFlagsByAction[action];

    for (let i = 0; i < rest.length; i += 1) {
      const token = rest[i];
      if (!token) continue;
      if (!String(token).startsWith('--')) {
        throw new CliError('INVALID_ARGS', `Unknown positional argument: ${token}`);
      }
      if (!allowedFlags || !allowedFlags.has(token)) {
        throw new CliError('UNKNOWN_FLAG', `Unknown flag for policy ${action || '<none>'}: ${token}`);
      }
      if (token === '--id') {
        options.id = String(requireFlagValue(rest, i, '--id')).trim();
        i += 1;
        continue;
      }
      if (token === '--command') {
        options.command = String(requireFlagValue(rest, i, '--command')).trim();
        i += 1;
        continue;
      }
      if (token === '--mode') {
        options.mode = String(requireFlagValue(rest, i, '--mode')).trim().toLowerCase();
        i += 1;
        continue;
      }
      if (token === '--chain-id') {
        options.chainId = String(requireFlagValue(rest, i, '--chain-id')).trim();
        i += 1;
        continue;
      }
      if (token === '--category') {
        options.category = String(requireFlagValue(rest, i, '--category')).trim();
        i += 1;
        continue;
      }
      if (token === '--profile-id') {
        options.profileId = String(requireFlagValue(rest, i, '--profile-id')).trim();
        i += 1;
        continue;
      }
      if (token === '--secret-source') {
        options.secretSource = String(requireFlagValue(rest, i, '--secret-source')).trim().toLowerCase();
        i += 1;
        continue;
      }
      if (token === '--validation-ticket') {
        options.validationTicket = String(requireFlagValue(rest, i, '--validation-ticket')).trim();
        i += 1;
        continue;
      }
      if (token === '--validation-decision') {
        options.validationDecision = String(requireFlagValue(rest, i, '--validation-decision')).trim().toUpperCase();
        i += 1;
        continue;
      }
      if (token === '--agent-preflight') {
        options.agentPreflight = true;
        continue;
      }
      if (token === '--webhook-url') {
        options.webhookUrl = String(requireFlagValue(rest, i, '--webhook-url')).trim();
        i += 1;
        continue;
      }
      if (token === '--external-dependency') {
        options.externalDependencies.push(String(requireFlagValue(rest, i, '--external-dependency')).trim().toLowerCase());
        i += 1;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(NUMERIC_POLICY_FLAGS, token)) {
        options[NUMERIC_POLICY_FLAGS[token]] = readNumericFlag(rest, i, token);
        i += 1;
        continue;
      }
      if (token === '--file') {
        options.file = resolveFile(requireFlagValue(rest, i, '--file'), '--file');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for policy ${action || '<none>'}: ${token}`);
    }

    options.id = normalizeOptionalString(options.id);
    options.command = normalizeOptionalString(options.command);
    options.mode = normalizeOptionalString(options.mode);
    options.chainId = normalizeOptionalString(options.chainId);
    options.category = normalizeOptionalString(options.category);
    options.profileId = normalizeOptionalString(options.profileId);
    options.secretSource = normalizeOptionalString(options.secretSource);
    options.validationTicket = normalizeOptionalString(options.validationTicket);
    options.validationDecision = normalizeOptionalString(options.validationDecision);
    options.webhookUrl = normalizeOptionalString(options.webhookUrl);
    options.externalDependencies = Array.from(new Set(options.externalDependencies.filter(Boolean)));

    if (!action) {
      throw new CliError('INVALID_ARGS', 'policy requires subcommand: list|get|lint|explain|recommend');
    }
    if (!['list', 'get', 'lint', 'explain', 'recommend'].includes(action)) {
      throw new CliError('INVALID_ARGS', `policy requires subcommand: list|get|lint|explain|recommend. Received: ${action}`);
    }
    if (action === 'get' && !options.id) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'policy get requires --id <policy-id>.');
    }
    if (action === 'explain' && !options.id) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'policy explain requires --id <policy-id>.');
    }
    if (action === 'lint' && !options.file) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'policy lint requires --file <path>.');
    }
    if ((action === 'explain' || action === 'recommend') && !options.command) {
      throw new CliError('MISSING_REQUIRED_FLAG', `policy ${action} requires --command <tool>.`);
    }
    if (options.mode && !POLICY_CONTEXT_MODES.has(options.mode)) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `--mode must be one of: ${Array.from(POLICY_CONTEXT_MODES).join(', ')}.`,
        {
          flag: '--mode',
          received: options.mode,
          allowedValues: Array.from(POLICY_CONTEXT_MODES),
        },
      );
    }
    return options;
  };
}

module.exports = {
  createParsePolicyFlags,
};
