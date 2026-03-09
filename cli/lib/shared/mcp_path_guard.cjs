const fs = require('fs');
const path = require('path');

function isMcpMode() {
  return String(process.env.PANDORA_MCP_MODE || '').trim() === '1';
}

function isPathInside(baseDir, candidatePath) {
  const relative = path.relative(baseDir, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function realpathIfExists(candidatePath) {
  try {
    return fs.realpathSync.native(candidatePath);
  } catch (error) {
    return null;
  }
}

function resolveWorkspaceConstrainedPath(rawPath, workspaceRoot) {
  const resolvedPath = path.resolve(String(rawPath || ''));
  const canonicalWorkspaceRoot = realpathIfExists(workspaceRoot) || workspaceRoot;
  let cursor = resolvedPath;
  const pendingSegments = [];

  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    pendingSegments.unshift(path.basename(cursor));
    cursor = parent;
  }

  const canonicalExistingPath = realpathIfExists(cursor) || cursor;
  const canonicalResolvedPath = path.resolve(canonicalExistingPath, ...pendingSegments);
  return {
    resolvedPath,
    canonicalWorkspaceRoot,
    canonicalResolvedPath,
  };
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
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const { resolvedPath, canonicalWorkspaceRoot, canonicalResolvedPath } =
    resolveWorkspaceConstrainedPath(rawPath, workspaceRoot);
  if (!isMcpMode()) {
    return canonicalResolvedPath;
  }
  if (isPathInside(canonicalWorkspaceRoot, canonicalResolvedPath)) {
    return canonicalResolvedPath;
  }

  const flagName = options.flagName || '--path';
  const message = options.message || `${flagName} must point to a file within the current workspace when running via MCP.`;
  const details = {
    flag: flagName,
    requestedPath: rawPath,
    resolvedPath,
    canonicalResolvedPath,
    workspaceRoot: canonicalWorkspaceRoot,
  };
  const errorFactory = typeof options.errorFactory === 'function' ? options.errorFactory : createDefaultError;
  throw errorFactory('MCP_FILE_ACCESS_BLOCKED', message, details);
}

module.exports = {
  isMcpMode,
  isPathInside,
  resolveWorkspaceConstrainedPath,
  assertMcpWorkspacePath,
};
