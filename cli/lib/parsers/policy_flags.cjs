'use strict';

const path = require('path');
const { assertMcpWorkspacePath } = require('../shared/mcp_path_guard.cjs');

function createParsePolicyFlags(deps = {}) {
  const CliError = deps.CliError;
  const requireFlagValue = deps.requireFlagValue;
  if (typeof CliError !== 'function' || typeof requireFlagValue !== 'function') {
    throw new Error('createParsePolicyFlags requires CliError and requireFlagValue.');
  }

  function resolveFile(next, flagName) {
    assertMcpWorkspacePath(next, {
      flagName,
      errorFactory: (code, message, details) => new CliError(code, message, details),
    });
    return path.resolve(process.cwd(), next);
  }

  return function parsePolicyFlags(args = []) {
    const action = String(args[0] || '').trim();
    const rest = args.slice(1);
    const options = { action };

    for (let i = 0; i < rest.length; i += 1) {
      const token = rest[i];
      if (token === '--id') {
        options.id = String(requireFlagValue(rest, i, '--id')).trim();
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

    if (!action) {
      throw new CliError('INVALID_ARGS', 'policy requires subcommand: list|get|lint');
    }
    if (action === 'get' && !options.id) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'policy get requires --id <policy-id>.');
    }
    if (action === 'lint' && !options.file) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'policy lint requires --file <path>.');
    }
    return options;
  };
}

module.exports = {
  createParsePolicyFlags,
};
