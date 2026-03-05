const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  normalizeForecastRecord,
  appendForecastRecord,
  readForecastRecords,
} = require('../../cli/lib/forecast_store.cjs');
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
