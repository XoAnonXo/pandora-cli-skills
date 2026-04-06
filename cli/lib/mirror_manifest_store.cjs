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
  const leftCondition = String(record && record.polymarketMarketId ? record.polymarketMarketId : '').toLowerCase();
  const rightCondition = String(selector && selector.polymarketMarketId ? selector.polymarketMarketId : '').toLowerCase();
  const leftSlug = String(record && record.polymarketSlug ? record.polymarketSlug : '').toLowerCase();
  const rightSlug = String(selector && selector.polymarketSlug ? selector.polymarketSlug : '').toLowerCase();

  if (!rightMarket && !rightCondition && !rightSlug) return false;
  if (leftMarket && rightMarket && leftMarket !== rightMarket) return false;
  if (leftCondition && rightCondition && leftCondition !== rightCondition) return false;
  if (leftSlug && rightSlug && leftSlug !== rightSlug) return false;
  return true;
}

function compareIsoTimestampsDesc(left, right) {
  const leftValue = typeof left === 'string' && left ? Date.parse(left) : NaN;
  const rightValue = typeof right === 'string' && right ? Date.parse(right) : NaN;
  return rightValue - leftValue;
}

function sameSourceIdentity(left = {}, right = {}) {
  const leftMarketId = String(left.polymarketMarketId || '').toLowerCase();
  const rightMarketId = String(right.polymarketMarketId || '').toLowerCase();
  if (leftMarketId && rightMarketId) {
    return leftMarketId === rightMarketId;
  }

  const leftSlug = String(left.polymarketSlug || '').toLowerCase();
  const rightSlug = String(right.polymarketSlug || '').toLowerCase();
  if (leftSlug && rightSlug) {
    return leftSlug === rightSlug;
  }

  return false;
}

function rankPairs(matches = []) {
  return matches
    .slice()
    .sort((left, right) => {
      const canonicalDelta = Number(Boolean(right && right.canonical)) - Number(Boolean(left && left.canonical));
      if (canonicalDelta !== 0) return canonicalDelta;
      const trustedDelta = Number((right && right.trusted) !== false) - Number((left && left.trusted) !== false);
      if (trustedDelta !== 0) return trustedDelta;
      const updatedDelta = compareIsoTimestampsDesc(left && left.updatedAt, right && right.updatedAt);
      if (updatedDelta !== 0) return updatedDelta;
      return compareIsoTimestampsDesc(left && left.createdAt, right && right.createdAt);
    });
}

function choosePreferredPair(matches = [], selector = {}) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return { pair: null, ambiguous: false };
  }

  const targetMarket = String(selector && selector.pandoraMarketAddress ? selector.pandoraMarketAddress : '').toLowerCase();
  if (targetMarket) {
    const exactMatches = matches.filter(
      (item) => String(item && item.pandoraMarketAddress ? item.pandoraMarketAddress : '').toLowerCase() === targetMarket,
    );
    if (exactMatches.length === 1) {
      return { pair: exactMatches[0], ambiguous: false };
    }
    if (exactMatches.length > 1) {
      const ranked = rankPairs(exactMatches);
      return { pair: ranked[0] || null, ambiguous: true };
    }
    return { pair: null, ambiguous: false };
  }

  const canonicalTrusted = matches.filter((item) => item && item.canonical && item.trusted !== false);
  if (canonicalTrusted.length === 1) {
    return { pair: canonicalTrusted[0], ambiguous: false };
  }
  if (canonicalTrusted.length > 1) {
    return { pair: null, ambiguous: true };
  }

  const trusted = matches.filter((item) => item && item.trusted !== false);
  if (trusted.length === 1) {
    return { pair: trusted[0], ambiguous: false };
  }
  if (trusted.length > 1) {
    return { pair: null, ambiguous: true };
  }

  if (matches.length === 1) {
    return { pair: matches[0], ambiguous: false };
  }

  return { pair: null, ambiguous: true };
}

function findPairs(filePath, selector = {}) {
  const loaded = readManifest(filePath);
  const pairs = Array.isArray(loaded.manifest.pairs) ? loaded.manifest.pairs : [];
  const matches = pairs.filter((record) => pairMatches(record, selector));
  return {
    filePath: loaded.filePath,
    manifest: loaded.manifest,
    pairs: rankPairs(matches),
  };
}

function findPair(filePath, selector = {}) {
  const loaded = findPairs(filePath, selector);
  const preferred = choosePreferredPair(loaded.pairs, selector);
  return {
    filePath: loaded.filePath,
    manifest: loaded.manifest,
    pair: preferred.pair,
    pairs: loaded.pairs,
    ambiguous: preferred.ambiguous,
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
    canonical: record.canonical === true,
    pandoraMarketAddress: record.pandoraMarketAddress || null,
    pandoraPollAddress: record.pandoraPollAddress || null,
    polymarketMarketId: record.polymarketMarketId || null,
    polymarketSlug: record.polymarketSlug || null,
    sourceQuestion: record.sourceQuestion || null,
    sourceRuleHash: record.sourceRuleHash || null,
    supersededByPandoraMarketAddress: record.supersededByPandoraMarketAddress || null,
  };

  const items = Array.isArray(manifest.pairs) ? manifest.pairs.slice() : [];
  const index = items.findIndex((item) => pairMatches(item, pair));
  if (index >= 0) {
    pair.createdAt = items[index].createdAt || pair.createdAt;
    items[index] = { ...items[index], ...pair };
  } else {
    items.push(pair);
  }

  if (pair.canonical) {
    manifest.pairs = items.map((item) => {
      if (!item || item.id === pair.id) return item;
      if (!sameSourceIdentity(item, pair)) return item;
      return {
        ...item,
        canonical: false,
        trusted: false,
        supersededByPandoraMarketAddress: pair.pandoraMarketAddress || item.supersededByPandoraMarketAddress || null,
        updatedAt: nowIso,
      };
    });
  } else {
    manifest.pairs = items;
  }
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
  findPairs,
  findPair,
  upsertPair,
};
