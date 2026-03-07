const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { assertMcpWorkspacePath } = require('../../cli/lib/shared/mcp_path_guard.cjs');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('assertMcpWorkspacePath allows real workspace files in MCP mode', () => {
  const workspaceRoot = makeTempDir('pandora-mcp-workspace-');
  const targetFile = path.join(workspaceRoot, 'inside.txt');
  const previous = process.env.PANDORA_MCP_MODE;
  fs.writeFileSync(targetFile, 'ok\n');
  process.env.PANDORA_MCP_MODE = '1';

  try {
    assert.equal(
      assertMcpWorkspacePath(targetFile, { workspaceRoot }),
      fs.realpathSync.native(targetFile),
    );
  } finally {
    if (previous === undefined) delete process.env.PANDORA_MCP_MODE;
    else process.env.PANDORA_MCP_MODE = previous;
    removeDir(workspaceRoot);
  }
});

test('assertMcpWorkspacePath blocks workspace symlinks that escape to existing files', () => {
  const workspaceRoot = makeTempDir('pandora-mcp-workspace-');
  const outsideRoot = makeTempDir('pandora-mcp-outside-');
  const outsideFile = path.join(outsideRoot, 'secret.env');
  const symlinkPath = path.join(workspaceRoot, 'linked-secret.env');
  const previous = process.env.PANDORA_MCP_MODE;
  fs.writeFileSync(outsideFile, 'SECRET=1\n');
  fs.symlinkSync(outsideFile, symlinkPath);
  process.env.PANDORA_MCP_MODE = '1';

  try {
    assert.throws(
      () => assertMcpWorkspacePath(symlinkPath, { workspaceRoot, flagName: '--dotenv-path' }),
      (error) => error && error.code === 'MCP_FILE_ACCESS_BLOCKED',
    );
  } finally {
    if (previous === undefined) delete process.env.PANDORA_MCP_MODE;
    else process.env.PANDORA_MCP_MODE = previous;
    removeDir(workspaceRoot);
    removeDir(outsideRoot);
  }
});

test('assertMcpWorkspacePath blocks non-existent children under symlinked directories', () => {
  const workspaceRoot = makeTempDir('pandora-mcp-workspace-');
  const outsideRoot = makeTempDir('pandora-mcp-outside-');
  const outsideDir = path.join(outsideRoot, 'real-dir');
  const symlinkDir = path.join(workspaceRoot, 'linked-dir');
  const escapedChild = path.join(symlinkDir, 'future.json');
  const previous = process.env.PANDORA_MCP_MODE;
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.symlinkSync(outsideDir, symlinkDir);
  process.env.PANDORA_MCP_MODE = '1';

  try {
    assert.throws(
      () => assertMcpWorkspacePath(escapedChild, { workspaceRoot, flagName: '--state-file' }),
      (error) => error && error.code === 'MCP_FILE_ACCESS_BLOCKED',
    );
  } finally {
    if (previous === undefined) delete process.env.PANDORA_MCP_MODE;
    else process.env.PANDORA_MCP_MODE = previous;
    removeDir(workspaceRoot);
    removeDir(outsideRoot);
  }
});
