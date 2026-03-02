const path = require('path');

function isMcpMode() {
  return String(process.env.PANDORA_MCP_MODE || '').trim() === '1';
}

function isPathInside(baseDir, candidatePath) {
  const relative = path.relative(baseDir, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function createDefaultError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function assertMcpWorkspacePath(rawPath, options = {}) {
  const resolvedPath = path.resolve(String(rawPath || ''));
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  if (!isMcpMode()) {
    return resolvedPath;
  }
  if (isPathInside(workspaceRoot, resolvedPath)) {
    return resolvedPath;
  }

  const flagName = options.flagName || '--path';
  const message = options.message || `${flagName} must point to a file within the current workspace when running via MCP.`;
  const details = {
    flag: flagName,
    requestedPath: rawPath,
    resolvedPath,
    workspaceRoot,
  };
  const errorFactory = typeof options.errorFactory === 'function' ? options.errorFactory : createDefaultError;
  throw errorFactory('MCP_FILE_ACCESS_BLOCKED', message, details);
}

module.exports = {
  isMcpMode,
  isPathInside,
  assertMcpWorkspacePath,
};
