const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadScenarioFamily,
  validateScenarioCase,
  validateWorldLock,
  FAMILY_SCHEMA_VERSION,
} = require('../../proving-ground/lib/scenario_family_loader.cjs');

function writeFamilyFixture(tmpDir, overrides = {}) {
  const familyPath = path.join(tmpDir, 'family.json');
  const family = {
    schemaVersion: '1.0.0',
    familyId: 'daemon-in-loop',
    title: 'Daemon-in-loop hedge proving ground',
    description: 'Deterministic scenario family for sandbox hedge experiments, restart checks, and replay calibration.',
    worldLock: {
      schemaVersion: '1.0.0',
      worldId: 'daemon-in-loop-v1',
      simulator: {
        name: 'event-stream',
        version: '1.0.0',
      },
      feeModel: {
        kind: 'fixed-bps',
        valueBps: 20,
      },
      latencyModel: {
        kind: 'seeded-lag',
        baseDelayMs: 250,
        maxDelayMs: 1500,
      },
      marketModel: {
        kind: 'simple-order-book',
        version: '1.0.0',
      },
      riskPolicy: {
        kind: 'hard-invariants',
        version: '1.0.0',
      },
    },
    generator: {
      name: 'daemon-in-loop-family-generator',
      version: '1.0.0',
      seed: 42,
      parameterSpace: {
        externalTradeBurstSizes: [1, 3, 10],
        hedgeLagMs: [250, 1000],
        restartInjections: [false, true],
      },
    },
    cases: [
      {
        id: 'burst-basic',
        sequence: 1,
        title: 'Burst of outside trades',
        description: 'A short burst of external trades forces the daemon to hedge under a small exposure window.',
        seed: 101,
        initialState: {
          inventoryUsdc: 100,
          exposureBandUsdc: 10,
        },
        events: [
          {
            type: 'external-trade',
            atMs: 100,
            side: 'yes',
            amountUsdc: 10,
          },
        ],
        expectations: {
          requiresHedge: true,
          maxExposureExcursionUsdc: 20,
          maxRecoveryMs: 1500,
        },
      },
      {
        id: 'partial-fill-retry',
        sequence: 2,
        title: 'Partial fill and retry',
        description: 'The hedge path gets a partial fill and must retry without duplicating exposure.',
        seed: 202,
        initialState: {
          inventoryUsdc: 80,
          exposureBandUsdc: 8,
        },
        events: [
          {
            type: 'external-trade',
            atMs: 120,
            side: 'yes',
            amountUsdc: 12,
          },
        ],
        expectations: {
          requiresHedge: true,
          maxDuplicateHedgeCount: 0,
          maxRecoveryMs: 2000,
        },
      },
    ],
    ...overrides,
  };
  fs.writeFileSync(familyPath, JSON.stringify(family, null, 2));
  return familyPath;
}

test('loadScenarioFamily loads the daemon-in-loop family in deterministic sequence order', () => {
  const familyPath = path.resolve(__dirname, '..', '..', 'proving-ground', 'scenarios', 'daemon-in-loop', 'family.json');
  const family = loadScenarioFamily(familyPath);

  assert.equal(FAMILY_SCHEMA_VERSION, '1.0.0');
  assert.equal(family.familyId, 'daemon-in-loop');
  assert.equal(family.caseCount, 3);
  assert.deepEqual(family.cases.map((item) => item.id), ['burst-basic', 'partial-fill-retry', 'restart-recover']);
  assert.deepEqual(family.cases.map((item) => item.sequence), [1, 2, 3]);
  assert.equal(family.worldLock.worldId, 'daemon-in-loop-v1');
});

test('validateScenarioCase and validateWorldLock reject malformed proving-ground inputs', () => {
  assert.throws(() => validateWorldLock(null, 'daemon-in-loop'));
  assert.throws(() => validateScenarioCase({ id: '', sequence: 1 }, 'daemon-in-loop', 0));
  assert.throws(() => validateScenarioCase({
    id: 'bad',
    title: 'Bad',
    sequence: 1,
    seed: 1,
    initialState: {},
    events: [],
    expectations: {},
  }, 'daemon-in-loop', 0));
});

test('loadScenarioFamily rejects duplicate case ids', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-pg-'));
  const familyPath = path.join(tmpDir, 'family.json');
  fs.writeFileSync(familyPath, JSON.stringify({
    schemaVersion: '1.0.0',
    familyId: 'dup-family',
    title: 'Duplicate family',
    description: 'Should fail',
    worldLock: {
      schemaVersion: '1.0.0',
      worldId: 'dup-world',
      simulator: { name: 'event-stream', version: '1.0.0' },
      feeModel: { kind: 'fixed-bps', valueBps: 20 },
      latencyModel: { kind: 'seeded-lag', baseDelayMs: 250, maxDelayMs: 1500 },
      marketModel: { kind: 'simple-order-book', version: '1.0.0' },
      riskPolicy: { kind: 'hard-invariants', version: '1.0.0' },
    },
    generator: { name: 'dup-generator', version: '1.0.0', seed: 7, parameterSpace: {} },
    cases: [
      {
        id: 'dup-case',
        sequence: 1,
        title: 'One',
        description: 'One',
        seed: 1,
        initialState: {},
        events: [{ type: 'tick', atMs: 1 }],
        expectations: {},
      },
      {
        id: 'dup-case',
        sequence: 2,
        title: 'Two',
        description: 'Two',
        seed: 2,
        initialState: {},
        events: [{ type: 'tick', atMs: 2 }],
        expectations: {},
      },
    ],
  }, null, 2));

  assert.throws(() => loadScenarioFamily(familyPath), /duplicate case id/);
});

test('loadScenarioFamily does not leak caller mutations across repeated loads', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-pg-'));
  const familyPath = writeFamilyFixture(tmpDir);

  const first = loadScenarioFamily(familyPath);
  first.title = 'mutated-title';
  first.cases[0].title = 'mutated-case-title';
  first.worldLock.worldId = 'mutated-world-id';
  first.generator.seed = 999;

  const second = loadScenarioFamily(familyPath);

  assert.equal(second.title, 'Daemon-in-loop hedge proving ground');
  assert.equal(second.cases[0].title, 'Burst of outside trades');
  assert.equal(second.worldLock.worldId, 'daemon-in-loop-v1');
  assert.equal(second.generator.seed, 42);
});

test('loadScenarioFamily observes file changes after a cached read', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-pg-'));
  const familyPath = writeFamilyFixture(tmpDir);

  loadScenarioFamily(familyPath);

  const updated = JSON.parse(fs.readFileSync(familyPath, 'utf8'));
  updated.title = 'Daemon-in-loop hedge proving ground v2';
  updated.cases[0].title = 'Burst of outside trades, updated';
  updated.generator.seed = 777;
  fs.writeFileSync(familyPath, JSON.stringify(updated, null, 2));

  const second = loadScenarioFamily(familyPath);

  assert.equal(second.title, 'Daemon-in-loop hedge proving ground v2');
  assert.equal(second.cases[0].title, 'Burst of outside trades, updated');
  assert.equal(second.generator.seed, 777);
});
