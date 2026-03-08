'use strict';

const path = require('path');

const { assertMcpWorkspacePath } = require('../shared/mcp_path_guard.cjs');

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
    includeBuiltIns: true,
    builtinOnly: false,
  };
  let sawNoBuiltins = false;
  let sawBuiltinOnly = false;

  const allowedFlagsByAction = {
    list: new Set(['--store-file', '--no-builtins', '--builtin-only']),
    get: new Set(['--id', '--store-file']),
    validate: new Set(['--file']),
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
    throw buildCliError(CliError, 'profile requires subcommand: list|get|validate');
  }
  if (!['list', 'get', 'validate'].includes(action)) {
    throw buildCliError(CliError, `profile requires subcommand: list|get|validate. Received: ${action}`);
  }
  if (sawNoBuiltins && sawBuiltinOnly) {
    throw new CliError('INVALID_FLAG_COMBINATION', '--builtin-only cannot be combined with --no-builtins.');
  }
  if (action === 'get' && !options.id) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'get requires --id.', { flag: '--id' });
  }
  if (action === 'validate' && !options.file) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'validate requires --file.', { flag: '--file' });
  }

  return options;
}

module.exports = {
  parseProfileFlags,
};
