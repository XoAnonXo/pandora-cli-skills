const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  runCli,
  runCliAsync,
  startJsonHttpServer,
  createTempDir,
  removeDir,
} = require('../helpers/cli_runner.cjs');
const { createSportsProviderRegistry } = require('../../cli/lib/sports_provider_registry.cjs');

function parseJsonEnvelopeStrict(result, label) {
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();

  assert.equal(
    stderr,
    '',
    `${label} wrote to stderr in JSON mode.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.notEqual(stdout, '', `${label} returned empty stdout.`);

  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${label} returned non-JSON stdout: ${error.message}\nstdout:\n${result.stdout}`);
  }

  assert.equal(typeof payload, 'object');
  assert.notEqual(payload, null);
  assert.equal(typeof payload.ok, 'boolean');
  assert.equal(typeof payload.command, 'string');
  return payload;
}

test('sports env mocked URLs do not break JSON help/version command flows', async (t) => {
  const mock = await startJsonHttpServer(() => ({ body: { ok: true } }));
  t.after(async () => {
    await mock.close();
  });

  const env = {
    SPORTSBOOK_PRIMARY_BASE_URL: mock.url,
    SPORTSBOOK_BACKUP_BASE_URL: mock.url,
    SPORTSBOOK_PROVIDER_MODE: 'auto',
  };

  const help = runCli(['--output', 'json', 'help'], { env });
  assert.equal(help.status, 0, help.output);
  const helpPayload = parseJsonEnvelopeStrict(help, 'help');
  assert.equal(helpPayload.ok, true);
  assert.equal(helpPayload.command, 'help');
  assert.equal(Array.isArray(helpPayload.data.usage), true);
  assert.ok(helpPayload.data.usage.length > 0);

  const version = runCli(['--output', 'json', '--version'], { env });
  assert.equal(version.status, 0, version.output);
  const versionPayload = parseJsonEnvelopeStrict(version, '--version');
  assert.equal(versionPayload.ok, true);
  assert.equal(versionPayload.command, 'version');
  assert.match(versionPayload.data.version, /^\d+\.\d+\.\d+/);

  assert.equal(mock.requests.length, 0);
});

test('sports provider registry returns normalized JSON from mocked sportsbook URLs', async (t) => {
  const mock = await startJsonHttpServer(({ url }) => {
    if (url.startsWith('/events?')) {
      return {
        body: {
          events: [
            {
              id: 'evt-1',
              competitionId: 'prem',
              home_team: 'Arsenal',
              away_team: 'Chelsea',
              startTime: '2030-01-01T12:00:00Z',
              status: 'scheduled',
            },
          ],
        },
      };
    }

    if (url.startsWith('/events/evt-1/odds?')) {
      return {
        body: {
          event: {
            id: 'evt-1',
            competitionId: 'prem',
            home_team: 'Arsenal',
            away_team: 'Chelsea',
            startTime: '2030-01-01T12:00:00Z',
            status: 'scheduled',
          },
          updatedAt: '2030-01-01T10:00:00Z',
          bookmakers: [
            {
              book: 'bet365',
              outcomes: [
                { name: 'Arsenal', price: '2.2' },
                { name: 'Draw', price: '3.3' },
                { name: 'Chelsea', price: '3.4' },
              ],
            },
            {
              book: 'williamhill',
              outcomes: [
                { name: 'Arsenal', price: '2.1' },
                { name: 'Draw', price: '3.5' },
                { name: 'Chelsea', price: '3.2' },
              ],
            },
          ],
        },
      };
    }

    if (url === '/events/evt-1/status') {
      return {
        body: {
          event: {
            id: 'evt-1',
            homeTeam: 'Arsenal',
            awayTeam: 'Chelsea',
            startTime: '2030-01-01T12:00:00Z',
            status: 'live',
            updatedAt: '2030-01-01T12:30:00Z',
          },
        },
      };
    }

    if (url === '/health') {
      return { body: { ok: true, status: 'ok' } };
    }

    return { status: 404, body: { error: `unexpected path ${url}` } };
  });

  t.after(async () => {
    await mock.close();
  });

  assert.equal(typeof globalThis.fetch, 'function');

  const registry = createSportsProviderRegistry({
    env: {
      SPORTSBOOK_PRIMARY_BASE_URL: mock.url,
      SPORTSBOOK_PROVIDER_MODE: 'primary',
    },
    fetch: globalThis.fetch,
  });

  const events = await registry.listEvents({ competitionId: 'prem' });
  assert.equal(events.mode, 'primary');
  assert.equal(events.provider, 'primary');
  assert.equal(events.count, 1);
  assert.equal(events.events[0].id, 'evt-1');
  assert.equal(events.events[0].marketType, 'soccer_winner');
  assert.equal(events.events[0].homeTeam, 'Arsenal');
  assert.equal(events.events[0].awayTeam, 'Chelsea');

  const odds = await registry.getEventOdds('evt-1');
  assert.equal(odds.mode, 'primary');
  assert.equal(odds.provider, 'primary');
  assert.equal(odds.marketType, 'soccer_winner');
  assert.equal(odds.event.id, 'evt-1');
  assert.equal(odds.bookCount, 2);
  assert.deepEqual(odds.bestOdds, { home: 2.2, draw: 3.5, away: 3.4 });

  const status = await registry.getEventStatus('evt-1');
  assert.equal(status.mode, 'primary');
  assert.equal(status.provider, 'primary');
  assert.equal(status.eventId, 'evt-1');
  assert.equal(status.status, 'live');
  assert.equal(status.inPlay, true);

  const health = await registry.health();
  assert.equal(health.mode, 'primary');
  assert.equal(health.ok, true);
  assert.equal(health.activeProvider, 'primary');
  assert.equal(Array.isArray(health.providers), true);
  assert.equal(health.providers.some((provider) => provider.provider === 'primary' && provider.ok), true);

  const requestedPaths = mock.requests.map((request) => String(request.url));
  assert.equal(requestedPaths.length, 4);
  assert.ok(requestedPaths[0].startsWith('/events?'));
  assert.ok(requestedPaths[0].includes('competitionId=prem'));
  assert.equal(requestedPaths[0].includes('sport='), false);
  assert.equal(requestedPaths[1], '/events/evt-1/odds?marketType=soccer_winner');
  assert.equal(requestedPaths[2], '/events/evt-1/status');
  assert.equal(requestedPaths[3], '/health');
});

test('sports odds snapshot/consensus use bulk competition endpoint with disk cache across invocations', async (t) => {
  const tempDir = createTempDir('pandora-sports-bulk-cache-');
  const expectedCacheFile = path.join(tempDir, '.pandora', 'cache', 'odds', 'soccer_epl__soccer_winner.json');
  const mock = await startJsonHttpServer(({ url }) => {
    if (url.startsWith('/odds?')) {
      return {
        body: [
          {
            id: 'evt-a',
            sport_key: 'soccer_epl',
            commence_time: '2030-01-01T12:00:00Z',
            home_team: 'Arsenal',
            away_team: 'Chelsea',
            bookmakers: [
              {
                key: 'bet365',
                title: 'Bet365',
                outcomes: [
                  { name: 'Arsenal', price: 2.1 },
                  { name: 'Draw', price: 3.3 },
                  { name: 'Chelsea', price: 3.5 },
                ],
              },
            ],
          },
          {
            id: 'evt-b',
            sport_key: 'soccer_epl',
            commence_time: '2030-01-01T15:00:00Z',
            home_team: 'Liverpool',
            away_team: 'Tottenham',
            bookmakers: [
              {
                key: 'bet365',
                title: 'Bet365',
                outcomes: [
                  { name: 'Liverpool', price: 1.9 },
                  { name: 'Draw', price: 3.4 },
                  { name: 'Tottenham', price: 4.1 },
                ],
              },
            ],
          },
        ],
      };
    }

    if (url.startsWith('/events/')) {
      return { status: 500, body: { error: 'per-event endpoint should not be called in this test' } };
    }

    if (url === '/health') {
      return { body: { ok: true, status: 'ok' } };
    }

    return { status: 404, body: { error: `unexpected path ${url}` } };
  });

  t.after(async () => {
    await mock.close();
    removeDir(tempDir);
  });

  const env = {
    HOME: tempDir,
    SPORTSBOOK_PRIMARY_BASE_URL: mock.url,
    SPORTSBOOK_PROVIDER_MODE: 'primary',
    SPORTSBOOK_PRIMARY_BULK_ODDS_PATH: '/odds',
  };

  const bulk = await runCliAsync([
    '--output',
    'json',
    'sports',
    'odds',
    'bulk',
    '--competition',
    'soccer_epl',
  ], { env });
  assert.equal(bulk.status, 0, bulk.output);
  const bulkPayload = parseJsonEnvelopeStrict(bulk, 'sports odds bulk');
  assert.equal(bulkPayload.ok, true);
  assert.equal(bulkPayload.command, 'sports.odds.bulk');
  assert.equal(bulkPayload.data.count, 2);
  assert.equal(bulkPayload.data.source.cache.source, 'api');
  assert.equal(bulkPayload.data.source.cache.hit, false);
  assert.equal(bulkPayload.data.source.cache.miss, true);
  assert.equal(bulkPayload.data.source.cache.file, expectedCacheFile);
  assert.equal(fs.existsSync(expectedCacheFile), true);

  const snapshot = await runCliAsync([
    '--output',
    'json',
    'sports',
    'odds',
    'snapshot',
    '--event-id',
    'evt-a',
    '--competition',
    'soccer_epl',
  ], { env });
  assert.equal(snapshot.status, 0, snapshot.output);
  const snapshotPayload = parseJsonEnvelopeStrict(snapshot, 'sports odds snapshot (bulk)');
  assert.equal(snapshotPayload.ok, true);
  assert.equal(snapshotPayload.command, 'sports.odds.snapshot');
  assert.equal(snapshotPayload.data.event.id, 'evt-a');
  assert.equal(snapshotPayload.data.source.cache.source, 'cache');
  assert.equal(snapshotPayload.data.source.cache.hit, true);
  assert.equal(snapshotPayload.data.source.cache.miss, false);
  assert.equal(snapshotPayload.data.source.cache.file, expectedCacheFile);
  assert.equal(snapshotPayload.data.source.bulk.used, true);
  assert.equal(snapshotPayload.data.source.bulk.cacheHit, true);

  const consensus = await runCliAsync([
    '--output',
    'json',
    'sports',
    'consensus',
    '--event-id',
    'evt-b',
    '--competition',
    'soccer_epl',
  ], { env });
  assert.equal(consensus.status, 0, consensus.output);
  const consensusPayload = parseJsonEnvelopeStrict(consensus, 'sports consensus (bulk cache)');
  assert.equal(consensusPayload.ok, true);
  assert.equal(consensusPayload.command, 'sports.consensus');
  assert.equal(consensusPayload.data.eventId, 'evt-b');
  assert.equal(consensusPayload.data.source.cache.source, 'cache');
  assert.equal(consensusPayload.data.source.cache.hit, true);
  assert.equal(consensusPayload.data.source.cache.miss, false);
  assert.equal(consensusPayload.data.source.cache.file, expectedCacheFile);
  assert.equal(consensusPayload.data.source.bulk.used, true);
  assert.equal(consensusPayload.data.source.bulk.cacheHit, true);

  const requestedPaths = mock.requests.map((request) => String(request.url));
  assert.equal(requestedPaths.length, 1);
  assert.ok(requestedPaths[0].startsWith('/odds?'));
  assert.equal(requestedPaths[0].includes('competitionId=soccer_epl'), true);
});

test('sports create plan accepts --model-file BYOM input and attributes model source', async (t) => {
  const tempDir = createTempDir('pandora-sports-model-file-');
  const modelFile = path.join(tempDir, 'model.json');
  fs.writeFileSync(
    modelFile,
    JSON.stringify({
      probability: 0.62,
      confidence: 'high',
      source: 'my_model_v3',
    }),
    'utf8',
  );

  const mock = await startJsonHttpServer(({ url }) => {
    if (url.startsWith('/events/evt-1/odds?')) {
      return {
        body: {
          event: {
            id: 'evt-1',
            competitionId: 'prem',
            home_team: 'Arsenal',
            away_team: 'Chelsea',
            startTime: '2030-01-01T12:00:00Z',
            status: 'scheduled',
          },
          updatedAt: '2030-01-01T10:00:00Z',
          bookmakers: [
            {
              book: 'bet365',
              outcomes: [
                { name: 'Arsenal', price: '2.2' },
                { name: 'Draw', price: '3.3' },
                { name: 'Chelsea', price: '3.4' },
              ],
            },
          ],
        },
      };
    }

    if (url === '/events/evt-1/status') {
      return {
        body: {
          event: {
            id: 'evt-1',
            homeTeam: 'Arsenal',
            awayTeam: 'Chelsea',
            startTime: '2030-01-01T12:00:00Z',
            status: 'scheduled',
            updatedAt: '2030-01-01T10:00:00Z',
          },
        },
      };
    }

    return { status: 404, body: { error: `unexpected path ${url}` } };
  });

  t.after(async () => {
    await mock.close();
    removeDir(tempDir);
  });

  const env = {
    SPORTSBOOK_PRIMARY_BASE_URL: mock.url,
    SPORTSBOOK_PROVIDER_MODE: 'primary',
  };

  const plan = await runCliAsync([
    '--output',
    'json',
    'sports',
    'create',
    'plan',
    '--event-id',
    'evt-1',
    '--model-file',
    modelFile,
    '--now-ms',
    String(Date.parse('2030-01-01T10:00:00Z')),
    '--min-total-books',
    '6',
    '--min-tier1-books',
    '3',
  ], { env });
  assert.equal(plan.status, 0, plan.output);
  const planPayload = parseJsonEnvelopeStrict(plan, 'sports create plan --model-file');
  assert.equal(planPayload.ok, true);
  assert.equal(planPayload.command, 'sports.create.plan');
  assert.equal(planPayload.data.source.probabilitySource, 'model');
  assert.equal(planPayload.data.source.model.probability, 0.62);
  assert.equal(planPayload.data.source.model.confidence, 'high');
  assert.equal(planPayload.data.source.model.source, 'my_model_v3');
  assert.equal(planPayload.data.source.model.inputMode, 'file');
  assert.equal(planPayload.data.source.model.modelFile, modelFile);
  assert.equal(
    planPayload.data.safety.blockedReasons.some((reason) => String(reason).includes('Insufficient book coverage')),
    false,
  );

  const requestedPaths = mock.requests.map((request) => String(request.url));
  assert.equal(requestedPaths.length, 2);
  assert.equal(requestedPaths[0], '/events/evt-1/odds?marketType=soccer_winner');
  assert.equal(requestedPaths[1], '/events/evt-1/status');
});
