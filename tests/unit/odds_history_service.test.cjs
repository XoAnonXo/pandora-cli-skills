const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { createTempDir, removeDir } = require('../helpers/cli_runner.cjs');
const { createOddsHistoryService } = require('../../cli/lib/odds_history_service.cjs');

test('odds history service records/query rows deterministically on JSONL backend', () => {
  const tempDir = createTempDir('pandora-odds-history-');
  let tick = 1_700_000_000_000;
  try {
    const service = createOddsHistoryService({
      baseDir: tempDir,
      backend: 'jsonl',
      now: () => new Date((tick += 1_000)),
    });

    const writeResult = service.recordEntries([
      {
        competition: 'soccer_epl',
        eventId: 'evt-1',
        venue: 'pandora_amm',
        marketId: 'mkt-1',
        yesPrice: 0.52,
        noPrice: 0.48,
        midPrice: 0.52,
        source: 'yesChance',
      },
      {
        competition: 'soccer_epl',
        eventId: 'evt-1',
        venue: 'polymarket',
        marketId: 'mkt-2',
        yesPrice: 0.54,
        noPrice: 0.46,
        midPrice: 0.54,
        source: 'book',
      },
      {
        competition: 'soccer_epl',
        eventId: '',
        venue: 'polymarket',
      },
    ]);

    assert.equal(writeResult.backend, 'jsonl');
    assert.equal(writeResult.inserted, 2);
    assert.equal(path.basename(service.paths.jsonlFile), 'odds.jsonl');

    const allRows = service.queryByEventId('evt-1');
    assert.equal(allRows.length, 2);
    assert.equal(allRows[0].eventId, 'evt-1');
    assert.equal(allRows[0].venue, 'pandora_amm');
    assert.equal(allRows[1].venue, 'polymarket');
    assert.equal(allRows[0].observedAtMs < allRows[1].observedAtMs, true);

    const latestOnly = service.queryByEventId('evt-1', { limit: 1 });
    assert.equal(latestOnly.length, 1);
    assert.equal(latestOnly[0].venue, 'polymarket');

    const csv = service.formatRows(allRows, 'csv');
    assert.equal(csv.startsWith('observed_at,observed_at_ms,competition,event_id,venue'), true);
    assert.equal(csv.includes('evt-1'), true);
  } finally {
    removeDir(tempDir);
  }
});

test('odds history service falls back to JSONL when sqlite dependencies are unavailable', () => {
  const tempDir = createTempDir('pandora-odds-history-fallback-');
  try {
    const service = createOddsHistoryService({
      baseDir: tempDir,
      backend: 'auto',
      requireFn() {
        throw new Error('module not found');
      },
    });

    assert.equal(service.backend, 'jsonl');
    const writeResult = service.recordEntries([
      {
        eventId: 'evt-fallback',
        venue: 'pandora_amm',
        yesPrice: 0.5,
        noPrice: 0.5,
      },
    ]);
    assert.equal(writeResult.inserted, 1);

    const reopened = createOddsHistoryService({
      baseDir: tempDir,
      backend: 'jsonl',
    });
    const rows = reopened.queryByEventId('evt-fallback');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].eventId, 'evt-fallback');
  } finally {
    removeDir(tempDir);
  }
});

test('odds history service hardens filesystem permissions for cache dir and files', () => {
  if (process.platform === 'win32') return;

  const tempDir = createTempDir('pandora-odds-history-perms-');
  try {
    const service = createOddsHistoryService({
      baseDir: tempDir,
      backend: 'jsonl',
    });

    const dirMode = fs.statSync(service.paths.baseDir).mode & 0o777;
    assert.equal(dirMode, 0o700);

    service.recordEntries([
      {
        competition: 'soccer_epl',
        eventId: 'evt-perms-1',
        venue: 'pandora_amm',
        yesPrice: 0.5,
        noPrice: 0.5,
      },
    ]);

    const fileMode = fs.statSync(service.paths.jsonlFile).mode & 0o777;
    assert.equal(fileMode, 0o600);
  } finally {
    removeDir(tempDir);
  }
});
