const path = require('path');

const { assertMcpWorkspacePath } = require('../shared/mcp_path_guard.cjs');

function resolveProfileWorkspacePath(rawPath, flagName, CliError) {
  try {
    const resolved = assertMcpWorkspacePath(rawPath, {
      flagName,
      errorFactory: (code, message, details) => new CliError(code, message, details),
    });
    return path.resolve(resolved);
  } catch (error) {
    if (error && error.code) {
      throw error;
    }
    throw new CliError(
      'INVALID_FLAG_VALUE',
      `${flagName} must point to a readable profile file.`,
      {
        flag: flagName,
        requestedPath: rawPath,
        cause: error && error.message ? error.message : String(error),
      },
    );
  }
}

function consumeProfileSelectorFlag({ token, args, index, options, CliError, requireFlagValue }) {
  if (token === '--profile-id') {
    const value = String(requireFlagValue(args, index, '--profile-id')).trim();
    if (!value) {
      throw new CliError('INVALID_FLAG_VALUE', '--profile-id must be a non-empty profile id.');
    }
    options.profileId = value;
    return index + 1;
  }

  if (token === '--profile-file') {
    const value = requireFlagValue(args, index, '--profile-file');
    options.profileFile = resolveProfileWorkspacePath(value, '--profile-file', CliError);
    return index + 1;
  }

  return null;
}

function assertNoMixedSignerSelectors(options, CliError) {
  if (options.privateKey && (options.profileId || options.profileFile)) {
    throw new CliError(
      'INVALID_FLAG_COMBINATION',
      'Use either --private-key or --profile-id/--profile-file, not both.',
      {
        privateKey: true,
        profileId: options.profileId || null,
        profileFile: options.profileFile || null,
      },
    );
  }
}

module.exports = {
  consumeProfileSelectorFlag,
  assertNoMixedSignerSelectors,
  resolveProfileWorkspacePath,
};
