const path = require('path');
const { assertMcpWorkspacePath, isMcpMode } = require('../shared/mcp_path_guard.cjs');

function createCliErrorFactory(CliError) {
  return (code, message, details) => new CliError(code, message, details);
}

function normalizeMirrorPathForMcp(rawPath, flagName, CliError) {
  if (!isMcpMode()) {
    return rawPath;
  }
  assertMcpWorkspacePath(rawPath, {
    flagName,
    errorFactory: createCliErrorFactory(CliError),
  });
  return path.resolve(String(rawPath || ''));
}

function defaultMirrorWorkspacePath(defaultPath) {
  if (!isMcpMode()) {
    return defaultPath;
  }
  return path.resolve(process.cwd(), '.pandora', 'mirror', path.basename(String(defaultPath || '')));
}

function validateMirrorUrl(rawValue, flagName, CliError, isSecureHttpUrlOrLocal) {
  const value = String(rawValue || '').trim();
  if (!isSecureHttpUrlOrLocal(value)) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      `${flagName} must use https:// (or http://localhost/127.0.0.1 for local testing).`,
    );
  }
  return value;
}

function parseMirrorTargetTimestamp(rawValue, flagName, CliError) {
  const value = String(rawValue || '').trim();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.trunc(numeric > 1e12 ? numeric / 1000 : numeric);
  }
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return Math.floor(parsed / 1000);
  }
  throw new CliError(
    'INVALID_FLAG_VALUE',
    `${flagName} must be a unix timestamp in seconds (or milliseconds) or an ISO date/time string.`,
  );
}

module.exports = {
  normalizeMirrorPathForMcp,
  defaultMirrorWorkspacePath,
  parseMirrorTargetTimestamp,
  validateMirrorUrl,
};
