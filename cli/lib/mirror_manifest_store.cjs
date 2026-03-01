const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MIRROR_MANIFEST_SCHEMA_VERSION = '1.0.0';

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function defaultManifestFile() {
  return path.join(os.homedir(), '.pandora', 'mirror', 'pairs.json');
}

function resolveManifestPath(filePath) {
  return path.resolve(expandHome(filePath || defaultManifestFile()));
}

function ensureManifestShape(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const pairs = Array.isArray(data.pairs) ? data.pairs : [];
  return {
    schemaVersion: MIRROR_MANIFEST_SCHEMA_VERSION,
    generatedAt: data.generatedAt || new Date().toISOString(),
    pairs,
  };
}

function readManifest(filePath) {
  const resolved = resolveManifestPath(filePath);
  if (!fs.existsSync(resolved)) {
    return {
      filePath: resolved,
      manifest: ensureManifestShape({}),
    };
  }

  let parsed = {};
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch {
    parsed = {};
  }

  return {
    filePath: resolved,
    manifest: ensureManifestShape(parsed),
  };
}

function saveManifest(filePath, manifest) {
  const resolved = resolveManifestPath(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tmpPath = `${resolved}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, resolved);
    try {
      fs.chmodSync(resolved, 0o600);
    } catch {
      // best-effort hardening on platforms that ignore/limit chmod
    }
    return resolved;
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // best-effort temp cleanup
    }
    throw err;
  }
}

function pairMatches(record, selector = {}) {
  const leftMarket = String(record && record.pandoraMarketAddress ? record.pandoraMarketAddress : '').toLowerCase();
  const rightMarket = String(selector && selector.pandoraMarketAddress ? selector.pandoraMarketAddress : '').toLowerCase();
  if (leftMarket && rightMarket && leftMarket !== rightMarket) return false;

  const leftCondition = String(record && record.polymarketMarketId ? record.polymarketMarketId : '').toLowerCase();
  const rightCondition = String(selector && selector.polymarketMarketId ? selector.polymarketMarketId : '').toLowerCase();
  if (leftCondition && rightCondition && leftCondition !== rightCondition) return false;

  const leftSlug = String(record && record.polymarketSlug ? record.polymarketSlug : '').toLowerCase();
  const rightSlug = String(selector && selector.polymarketSlug ? selector.polymarketSlug : '').toLowerCase();
  if (leftSlug && rightSlug && leftSlug !== rightSlug) return false;

  if (!rightMarket && !rightCondition && !rightSlug) return false;
  return true;
}

function findPair(filePath, selector = {}) {
  const loaded = readManifest(filePath);
  const pairs = Array.isArray(loaded.manifest.pairs) ? loaded.manifest.pairs : [];
  const match = pairs.find((record) => pairMatches(record, selector)) || null;
  return {
    filePath: loaded.filePath,
    manifest: loaded.manifest,
    pair: match,
  };
}

function buildPairId(record) {
  const hash = crypto.createHash('sha256');
  hash.update(
    JSON.stringify({
      pandoraMarketAddress: String(record.pandoraMarketAddress || '').toLowerCase(),
      polymarketMarketId: String(record.polymarketMarketId || '').toLowerCase(),
      polymarketSlug: String(record.polymarketSlug || '').toLowerCase(),
    }),
  );
  return hash.digest('hex').slice(0, 16);
}

function upsertPair(filePath, record = {}) {
  const loaded = readManifest(filePath);
  const manifest = loaded.manifest;
  const nowIso = new Date().toISOString();
  const pair = {
    id: record.id || buildPairId(record),
    createdAt: record.createdAt || nowIso,
    updatedAt: nowIso,
    trusted: record.trusted !== false,
    pandoraMarketAddress: record.pandoraMarketAddress || null,
    pandoraPollAddress: record.pandoraPollAddress || null,
    polymarketMarketId: record.polymarketMarketId || null,
    polymarketSlug: record.polymarketSlug || null,
    sourceQuestion: record.sourceQuestion || null,
    sourceRuleHash: record.sourceRuleHash || null,
  };

  const items = Array.isArray(manifest.pairs) ? manifest.pairs.slice() : [];
  const index = items.findIndex((item) => pairMatches(item, pair));
  if (index >= 0) {
    pair.createdAt = items[index].createdAt || pair.createdAt;
    items[index] = { ...items[index], ...pair };
  } else {
    items.push(pair);
  }

  manifest.pairs = items;
  manifest.generatedAt = nowIso;
  const savedPath = saveManifest(loaded.filePath, manifest);
  return {
    filePath: savedPath,
    pair,
    manifest,
  };
}

module.exports = {
  MIRROR_MANIFEST_SCHEMA_VERSION,
  defaultManifestFile,
  resolveManifestPath,
  readManifest,
  saveManifest,
  findPair,
  upsertPair,
};
