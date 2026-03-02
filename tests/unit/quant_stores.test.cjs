const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  normalizeForecastRecord,
  appendForecastRecord,
  readForecastRecords,
} = require('../../cli/lib/forecast_store.cjs');
const {
  loadModelStore,
  saveModelStore,
  upsertModelMetric,
} = require('../../cli/lib/model_store.cjs');
const { createTempDir, removeDir } = require('../helpers/cli_runner.cjs');

test('forecast_store normalizes and appends JSONL records with filtering support', () => {
  const tempDir = createTempDir('pandora-forecast-store-');
  const forecastFile = path.join(tempDir, 'forecasts.jsonl');
  try {
    const normalized = normalizeForecastRecord({
      source: 'watch',
      marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      probabilityYes: 64,
      forecastAt: '2026-03-02T00:00:00.000Z',
    });
    assert.equal(normalized.probabilityYes, 0.64);
    assert.equal(normalized.probabilityNo, 0.36);
    assert.equal(normalized.outcome, null);

    appendForecastRecord(forecastFile, {
      source: 'watch',
      marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      probabilityYes: 0.6,
      forecastAt: '2026-03-02T10:00:00.000Z',
    });
    appendForecastRecord(forecastFile, {
      source: 'consensus',
      marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      probabilityYes: 0.55,
      outcome: 'yes',
      resolvedAt: '2026-03-03T00:00:00.000Z',
      forecastAt: '2026-03-02T11:00:00.000Z',
    });

    const allRows = readForecastRecords(forecastFile);
    assert.equal(allRows.exists, true);
    assert.equal(allRows.records.length, 2);

    const onlyWatch = readForecastRecords(forecastFile, { source: 'watch' });
    assert.equal(onlyWatch.records.length, 1);
    assert.equal(onlyWatch.records[0].source, 'watch');

    const onlyResolved = readForecastRecords(forecastFile, { includeUnresolved: false });
    assert.equal(onlyResolved.records.length, 1);
    assert.equal(onlyResolved.records[0].outcome, 1);

    if (process.platform !== 'win32') {
      const mode = fs.statSync(forecastFile).mode & 0o777;
      assert.equal(mode, 0o600);
    }
  } finally {
    removeDir(tempDir);
  }
});

test('forecast_store reports invalid JSONL lines without crashing', () => {
  const tempDir = createTempDir('pandora-forecast-invalid-');
  const forecastFile = path.join(tempDir, 'forecasts.jsonl');
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(
      forecastFile,
      '{"source":"watch","probabilityYes":0.5,"forecastAt":"2026-03-02T00:00:00.000Z"}\n{bad\n',
      'utf8',
    );

    const loaded = readForecastRecords(forecastFile);
    assert.equal(loaded.records.length, 1);
    assert.equal(loaded.invalidLineCount, 1);
  } finally {
    removeDir(tempDir);
  }
});

test('model_store loads defaults, saves, and upserts metric history', () => {
  const tempDir = createTempDir('pandora-model-store-');
  const modelFile = path.join(tempDir, 'models.json');
  try {
    const initial = loadModelStore(modelFile);
    assert.equal(initial.exists, false);
    assert.equal(initial.state.schemaVersion, '1.0.0');

    const saved = saveModelStore(modelFile, {
      models: {
        baseline: {
          modelId: 'baseline',
          source: 'watch',
          createdAt: '2026-03-02T00:00:00.000Z',
          updatedAt: '2026-03-02T00:00:00.000Z',
          scoreHistory: [],
          latestByMetric: {},
        },
      },
    });
    assert.equal(saved.filePath, modelFile);

    const update = upsertModelMetric(modelFile, {
      modelId: 'baseline',
      source: 'watch',
      metric: 'brier',
      score: 0.19,
      sampleSize: 12,
      windowDays: 7,
      groupBy: 'source',
    });

    assert.equal(update.model.modelId, 'baseline');
    assert.equal(update.model.latestByMetric.brier.score, 0.19);
    assert.equal(update.model.scoreHistory.length, 1);

    const reloaded = loadModelStore(modelFile);
    assert.equal(reloaded.exists, true);
    assert.equal(reloaded.state.models.baseline.scoreHistory.length, 1);

    if (process.platform !== 'win32') {
      const mode = fs.statSync(modelFile).mode & 0o777;
      assert.equal(mode, 0o600);
    }
  } finally {
    removeDir(tempDir);
  }
});
