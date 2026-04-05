const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { findPair, upsertPair } = require('../../cli/lib/mirror_manifest_store.cjs');

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('findPair prefers the canonical trusted pair when duplicate source mappings exist', () => {
  const tempDir = createTempDir('pandora-mirror-manifest-');
  const manifestFile = path.join(tempDir, 'pairs.json');

  try {
    upsertPair(manifestFile, {
      trusted: true,
      canonical: false,
      pandoraMarketAddress: '0xae3ad3038d539138f71323e8895f62fe35b18d8c',
      pandoraPollAddress: '0xec96bbc011ce437d4708bfe4c717bdd111c9bc66',
      polymarketMarketId: 'poly-france',
      polymarketSlug: 'will-france-win-the-2026-fifa-world-cup-924',
      sourceQuestion: 'Will France win the 2026 FIFA World Cup?',
      sourceRuleHash: 'hash-1',
    });

    upsertPair(manifestFile, {
      trusted: true,
      canonical: true,
      pandoraMarketAddress: '0x0fea7e320efc2d207e683e7faedeb065c2769c81',
      pandoraPollAddress: '0xf3d9eac263cc9210980b705fe35beca4927107e3',
      polymarketMarketId: 'poly-france',
      polymarketSlug: 'will-france-win-the-2026-fifa-world-cup-924',
      sourceQuestion: 'Will France win the 2026 FIFA World Cup?',
      sourceRuleHash: 'hash-1',
    });

    const lookup = findPair(manifestFile, {
      polymarketMarketId: 'poly-france',
    });

    assert.equal(lookup.ambiguous, false);
    assert.equal(lookup.pair.pandoraMarketAddress, '0x0fea7e320efc2d207e683e7faedeb065c2769c81');
    assert.equal(lookup.pairs.length, 2);
    const superseded = lookup.pairs.find((item) => item.pandoraMarketAddress === '0xae3ad3038d539138f71323e8895f62fe35b18d8c');
    assert.equal(superseded.trusted, false);
    assert.equal(superseded.supersededByPandoraMarketAddress, '0x0fea7e320efc2d207e683e7faedeb065c2769c81');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
