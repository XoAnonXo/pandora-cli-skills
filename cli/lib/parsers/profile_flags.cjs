'use strict';

const path = require('path');

const { assertMcpWorkspacePath } = require('../shared/mcp_path_guard.cjs');

const PROFILE_CONTEXT_MODES = new Set(['dry-run', 'paper', 'fork', 'execute', 'execute-live']);

function buildCliError(CliError, message, details = null) {
  return new CliError('INVALID_ARGS', message, details || undefined);
}

function requireFlagValue(args, index, flag, CliError) {
  const value = args[index + 1];
  if (!value || String(value).startsWith('--')) {
    throw buildCliError(CliError, `${flag} requires a value.`, { flag });
  }
  return String(value);
}

function resolveWorkspacePath(rawPath, flagName, CliError) {
  const resolved = assertMcpWorkspacePath(rawPath, {
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

function parseProfileFlags(args = [], deps = {}) {
  const { CliError } = deps;
  if (typeof CliError !== 'function') {
    throw new Error('parseProfileFlags requires deps.CliError');
  }

  const action = String(args[0] || '').trim();
  const rest = args.slice(1);
  const options = {
    action,
    id: null,
    file: null,
    storeFile: null,
    command: null,
    mode: null,
    chainId: null,
    category: null,
    policyId: null,
    includeBuiltIns: true,
    builtinOnly: false,
  };
  let sawNoBuiltins = false;
  let sawBuiltinOnly = false;

  const allowedFlagsByAction = {
    list: new Set(['--store-file', '--no-builtins', '--builtin-only']),
    get: new Set(['--id', '--store-file', '--command', '--mode', '--chain-id', '--category', '--policy-id']),
    explain: new Set(['--id', '--store-file', '--command', '--mode', '--chain-id', '--category', '--policy-id']),
    validate: new Set(['--file']),
    recommend: new Set(['--store-file', '--no-builtins', '--builtin-only', '--command', '--mode', '--chain-id', '--category', '--policy-id']),
  };
  const allowedFlags = allowedFlagsByAction[action];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token) continue;
    if (!String(token).startsWith('--')) {
      throw buildCliError(CliError, `Unknown positional argument: ${token}`);
    }
    if (!allowedFlags || !allowedFlags.has(token)) {
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for profile ${action}: ${token}`, {
        action,
        flag: token,
      });
    }

    if (token === '--id') {
      options.id = requireFlagValue(rest, index, '--id', CliError);
      index += 1;
      continue;
    }

    if (token === '--file') {
      options.file = resolveWorkspacePath(requireFlagValue(rest, index, '--file', CliError), '--file', CliError);
      index += 1;
      continue;
    }

    if (token === '--store-file') {
      options.storeFile = resolveWorkspacePath(
        requireFlagValue(rest, index, '--store-file', CliError),
        '--store-file',
        CliError,
      );
      index += 1;
      continue;
    }

    if (token === '--command') {
      options.command = requireFlagValue(rest, index, '--command', CliError);
      index += 1;
      continue;
    }

    if (token === '--mode') {
      options.mode = requireFlagValue(rest, index, '--mode', CliError);
      index += 1;
      continue;
    }

    if (token === '--chain-id') {
      options.chainId = requireFlagValue(rest, index, '--chain-id', CliError);
      index += 1;
      continue;
    }

    if (token === '--category') {
      options.category = requireFlagValue(rest, index, '--category', CliError);
      index += 1;
      continue;
    }

    if (token === '--policy-id') {
      options.policyId = requireFlagValue(rest, index, '--policy-id', CliError);
      index += 1;
      continue;
    }

    if (token === '--no-builtins') {
      sawNoBuiltins = true;
      options.includeBuiltIns = false;
      continue;
    }

    if (token === '--builtin-only') {
      sawBuiltinOnly = true;
      options.includeBuiltIns = true;
      options.builtinOnly = true;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag: ${token}`, { flag: token });
  }

  if (!action) {
    throw buildCliError(CliError, 'profile requires subcommand: list|get|explain|recommend|validate');
  }
  if (!['list', 'get', 'explain', 'recommend', 'validate'].includes(action)) {
    throw buildCliError(CliError, `profile requires subcommand: list|get|explain|recommend|validate. Received: ${action}`);
  }
  if (sawNoBuiltins && sawBuiltinOnly) {
    throw new CliError('INVALID_FLAG_COMBINATION', '--builtin-only cannot be combined with --no-builtins.');
  }
  options.id = normalizeOptionalString(options.id);
  options.command = normalizeOptionalString(options.command);
  options.chainId = normalizeOptionalString(options.chainId);
  options.category = normalizeOptionalString(options.category);
  options.policyId = normalizeOptionalString(options.policyId);
  if ((action === 'get' || action === 'explain') && !options.id) {
    throw new CliError('MISSING_REQUIRED_FLAG', `${action} requires --id.`, { flag: '--id' });
  }
  if (options.mode !== null) {
    const normalizedMode = normalizeOptionalString(options.mode);
    if (!normalizedMode || !PROFILE_CONTEXT_MODES.has(normalizedMode.toLowerCase())) {
      throw new CliError(
        'INVALID_FLAG_VALUE',
        `--mode must be one of: ${Array.from(PROFILE_CONTEXT_MODES).join(', ')}.`,
        {
          flag: '--mode',
          received: options.mode,
          allowedValues: Array.from(PROFILE_CONTEXT_MODES),
        },
      );
    }
    options.mode = normalizedMode.toLowerCase();
  }
  if (action === 'validate' && !options.file) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'validate requires --file.', { flag: '--file' });
  }

  return options;
}

module.exports = {
  parseProfileFlags,
};
