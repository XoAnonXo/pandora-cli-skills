const fs = require('fs');
const path = require('path');

function buildModelId(prefix = 'model') {
  const now = new Date();
  const y = String(now.getUTCFullYear());
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  const nonce = Math.floor(Math.random() * 1e6)
    .toString(16)
    .padStart(5, '0');
  return `${prefix}-${y}${m}${d}-${hh}${mm}${ss}-${nonce}`;
}

function saveModelArtifact(filePath, artifact) {
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const serialized = JSON.stringify(artifact, null, 2);
  const tempPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(tempPath, serialized, { mode: 0o600, flag: 'w' });
    fs.renameSync(tempPath, absolutePath);
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // best-effort cleanup
      }
    }
  }

  try {
    fs.chmodSync(absolutePath, 0o600);
  } catch {
    // best-effort hardening on platforms that ignore chmod
  }
  return {
    saved: true,
    path: absolutePath,
    bytes: Buffer.byteLength(serialized, 'utf8'),
  };
}

module.exports = {
  buildModelId,
  saveModelArtifact,
};
