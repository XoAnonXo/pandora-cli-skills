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

function parseJsonEnvelopeLoose(result, label) {
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

test('sports schedule help is subcommand-specific in json and table modes', () => {
  const jsonResult = runCli(['--output', 'json', 'sports', 'schedule', '--help']);
  const jsonPayload = parseJsonEnvelopeStrict(jsonResult, 'sports schedule --help');

  assert.equal(jsonPayload.command, 'sports.schedule.help');
  assert.match(jsonPayload.data.usage, /sports schedule \[--provider/);
  assert.match(jsonPayload.data.notes[0], /lists normalized events/i);

  const tableResult = runCli(['sports', 'schedule', '--help']);
  assert.equal(tableResult.status, 0, tableResult.output);
  assert.match(String(tableResult.stdout || ''), /Usage: pandora \[--output table\|json\] sports schedule/);
  assert.match(String(tableResult.stdout || ''), /lists normalized events/i);
});

test('sports scores help is subcommand-specific in json and table modes', () => {
  const jsonResult = runCli(['--output', 'json', 'sports', 'scores', '--help']);
  const jsonPayload = parseJsonEnvelopeStrict(jsonResult, 'sports scores --help');

  assert.equal(jsonPayload.command, 'sports.scores.help');
  assert.match(jsonPayload.data.usage, /sports scores \[--event-id <id>\|--game <id>\]/);
  assert.match(jsonPayload.data.notes[0], /normalized score and status rows/i);

  const tableResult = runCli(['sports', 'scores', '--help']);
  assert.equal(tableResult.status, 0, tableResult.output);
  assert.match(String(tableResult.stdout || ''), /Usage: pandora \[--output table\|json\] sports scores/);
  assert.match(String(tableResult.stdout || ''), /normalized score and status rows/i);
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

test('sports schedule accepts --date shorthand and returns normalized schedule rows', async (t) => {
  const mock = await startJsonHttpServer(({ url }) => {
    if (url.startsWith('/events?')) {
      return {
        body: {
          events: [
            {
              id: 'nba-bos-cle-2026-03-09',
              competitionId: 'nba',
              home_team: 'Celtics',
              away_team: 'Cavaliers',
              startTime: '2026-03-09T23:00:00Z',
              status: 'scheduled',
            },
          ],
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

  const result = await runCliAsync(
    [
      '--output',
      'json',
      'sports',
      'schedule',
      '--provider',
      'primary',
      '--competition',
      'nba',
      '--date',
      '2026-03-09',
      '--limit',
      '5',
    ],
    {
      env: {
        SPORTSBOOK_PRIMARY_BASE_URL: mock.url,
        SPORTSBOOK_PROVIDER_MODE: 'primary',
      },
    },
  );

  const payload = parseJsonEnvelopeStrict(result, 'sports schedule --date');
  assert.equal(payload.command, 'sports.schedule');
  assert.equal(payload.ok, true);
  assert.equal(payload.data.count, 1);
  assert.equal(payload.data.schedule[0].eventId, 'nba-bos-cle-2026-03-09');
  assert.equal(payload.data.schedule[0].homeTeam, 'Celtics');
  assert.equal(payload.data.schedule[0].awayTeam, 'Cavaliers');

  const requestPath = String(mock.requests[0].url);
  assert.ok(requestPath.startsWith('/events?'));
  assert.ok(requestPath.includes('competitionId=nba'));
  assert.ok(requestPath.includes('from=2026-03-09T00%3A00%3A00.000Z'));
  assert.ok(requestPath.includes('to=2026-03-10T00%3A00%3A00.000Z'));
});

test('sports scores accepts --game alias and returns score/status rows', async (t) => {
  const mock = await startJsonHttpServer(({ url }) => {
    if (url === '/events/nba-bos-cle-2026-03-08/status') {
      return {
        body: {
          event: {
            id: 'nba-bos-cle-2026-03-08',
            competitionId: 'nba',
            homeTeam: 'Celtics',
            awayTeam: 'Cavaliers',
            startTime: '2026-03-08T23:00:00Z',
            status: 'live',
            updatedAt: '2026-03-09T00:40:00Z',
            inPlay: true,
            homeScore: 87,
            awayScore: 74,
            score: 'BOS 87 - CLE 74',
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

  const result = await runCliAsync(
    [
      '--output',
      'json',
      'sports',
      'scores',
      '--provider',
      'primary',
      '--game',
      'nba-bos-cle-2026-03-08',
    ],
    {
      env: {
        SPORTSBOOK_PRIMARY_BASE_URL: mock.url,
        SPORTSBOOK_PROVIDER_MODE: 'primary',
      },
    },
  );

  const payload = parseJsonEnvelopeStrict(result, 'sports scores --game');
  assert.equal(payload.command, 'sports.scores');
  assert.equal(payload.ok, true);
  assert.equal(payload.data.queriedEventId, 'nba-bos-cle-2026-03-08');
  assert.equal(payload.data.count, 1);
  assert.equal(payload.data.scores[0].eventId, 'nba-bos-cle-2026-03-08');
  assert.equal(payload.data.scores[0].homeScore, 87);
  assert.equal(payload.data.scores[0].awayScore, 74);
  assert.equal(payload.data.scores[0].score, 'BOS 87 - CLE 74');
  assert.equal(payload.data.scores[0].inPlay, true);
});

test('sports scores falls back to schedule data when event-status refresh times out and reports diagnostics', async (t) => {
  const mock = await startJsonHttpServer(async ({ url }) => {
    if (url === '/events/nba-bos-cle-2026-03-08/status') {
      await new Promise((resolve) => setTimeout(resolve, 75));
      return {
        body: {
          event: {
            id: 'nba-bos-cle-2026-03-08',
            homeTeam: 'Celtics',
            awayTeam: 'Cavaliers',
            status: 'live',
          },
        },
      };
    }
    if (url.startsWith('/events?')) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        body: {
          events: [
            {
              id: 'nba-bos-cle-2026-03-08',
              competitionId: 'nba',
              home_team: 'Celtics',
              away_team: 'Cavaliers',
              startTime: '2026-03-08T23:00:00Z',
              status: 'scheduled',
            },
          ],
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

  const env = {
    SPORTSBOOK_PRIMARY_BASE_URL: mock.url,
    SPORTSBOOK_PROVIDER_MODE: 'primary',
  };

  const result = await runCliAsync(
    [
      '--output',
      'json',
      'sports',
      'scores',
      '--provider',
      'primary',
      '--event-id',
      'nba-bos-cle-2026-03-08',
      '--timeout-ms',
      '10',
      '--competition',
      'nba',
    ],
    { env },
  );
  const payload = parseJsonEnvelopeStrict(result, 'sports scores fallback');

  assert.equal(payload.command, 'sports.scores');
  assert.equal(payload.ok, true);
  assert.equal(payload.data.count, 1);
  assert.equal(payload.data.scores[0].eventId, 'nba-bos-cle-2026-03-08');
  assert.equal(payload.data.scores[0].homeTeam, 'Celtics');
  assert.equal(payload.data.scores[0].awayTeam, 'Cavaliers');
  assert.equal(payload.data.scores[0].status, 'scheduled');
  assert.equal(Array.isArray(payload.data.diagnostics), true);
  assert.ok(payload.data.diagnostics.length >= 1);
  assert.ok(payload.data.diagnostics.some((item) => item && item.eventId === 'nba-bos-cle-2026-03-08'));
  assert.ok(mock.requests.some((request) => String(request.url).startsWith('/events?')));

  const tableResult = await runCliAsync(
    [
      'sports',
      'scores',
      '--provider',
      'primary',
      '--event-id',
      'nba-bos-cle-2026-03-08',
      '--timeout-ms',
      '10',
      '--competition',
      'nba',
    ],
    { env },
  );
  assert.equal(tableResult.status, 0, tableResult.output);
  assert.match(tableResult.stdout, /diagnostics:/i);
});

test('sports resolve plan returns a strict machine-usable execution payload when safe', () => {
  const checksJson = JSON.stringify([
    {
      checkId: 'c1',
      checkedAt: '2026-03-01T10:00:00.000Z',
      sources: [{ name: 'official-feed', official: true, finalResult: 'yes', checkedAt: '2026-03-01T10:00:00.000Z' }],
    },
    {
      checkId: 'c2',
      checkedAt: '2026-03-01T10:05:00.000Z',
      sources: [{ name: 'official-feed', official: true, finalResult: 'yes', checkedAt: '2026-03-01T10:05:00.000Z' }],
    },
  ]);

  const result = runCli([
    '--output',
    'json',
    'sports',
    'resolve',
    'plan',
    '--checks-json',
    checksJson,
    '--poll-address',
    '0x1111111111111111111111111111111111111111',
    '--settle-delay-ms',
    '600000',
    '--consecutive-checks-required',
    '2',
    '--now',
    '2026-03-01T10:10:00.000Z',
    '--reason',
    'Official final score confirmed.',
    '--rpc-url',
    'https://rpc.example',
  ]);

  assert.equal(result.status, 0, result.output || result.stderr);
  const payload = parseJsonEnvelopeStrict(result, 'sports resolve plan safe');
  assert.equal(payload.command, 'sports.resolve.plan');
  assert.equal(payload.data.safeToResolve, true);
  assert.equal(payload.data.status, 'safe');
  assert.equal(payload.data.summary.executionReady, true);
  assert.equal(payload.data.execution.ready, true);
  assert.equal(payload.data.execution.commandName, 'resolve');
  assert.equal(payload.data.execution.flags.answer, 'yes');
  assert.equal(payload.data.execution.flags.execute, true);
  assert.deepEqual(payload.data.execution.flags.extraFlags, ['--rpc-url', 'https://rpc.example']);
  assert.deepEqual(
    payload.data.execution.argv,
    [
      'resolve',
      '--poll-address',
      '0x1111111111111111111111111111111111111111',
      '--answer',
      'yes',
      '--reason',
      'Official final score confirmed.',
      '--execute',
      '--rpc-url',
      'https://rpc.example',
    ],
  );
  assert.equal(payload.data.resolution.sourceTier, 'official');

  const tableResult = runCli([
    'sports',
    'resolve',
    'plan',
    '--checks-json',
    checksJson,
    '--poll-address',
    '0x1111111111111111111111111111111111111111',
    '--settle-delay-ms',
    '600000',
    '--consecutive-checks-required',
    '2',
    '--now',
    '2026-03-01T10:10:00.000Z',
    '--reason',
    'Official final score confirmed.',
    '--rpc-url',
    'https://rpc.example',
  ]);
  assert.equal(tableResult.status, 0, tableResult.output);
  assert.match(String(tableResult.stdout || ''), /Resolve plan: safe/);
  assert.match(String(tableResult.stdout || ''), /next: pandora resolve --poll-address/);
  assert.match(String(tableResult.stdout || ''), /--rpc-url https:\/\/rpc\.example/);
});

test('sports resolve plan unsafe error includes structured blockers and retry guidance', () => {
  const checksJson = JSON.stringify([
    {
      checkId: 'c1',
      checkedAt: '2026-03-01T10:00:00.000Z',
      sources: [{ name: 'official-feed', official: true, finalResult: 'yes', checkedAt: '2026-03-01T10:00:00.000Z' }],
    },
    {
      checkId: 'c2',
      checkedAt: '2026-03-01T10:05:00.000Z',
      sources: [{ name: 'official-feed', official: true, finalResult: 'yes', checkedAt: '2026-03-01T10:05:00.000Z' }],
    },
  ]);

  const result = runCli([
    '--output',
    'json',
    'sports',
    'resolve',
    'plan',
    '--checks-json',
    checksJson,
    '--poll-address',
    '0x1111111111111111111111111111111111111111',
    '--settle-delay-ms',
    '600000',
    '--consecutive-checks-required',
    '2',
    '--now',
    '2026-03-01T10:09:00.000Z',
    '--event-id',
    'nba-bos-cle-2026-03-01',
  ]);

  assert.equal(result.status, 1, result.output || result.stderr);
  const payload = parseJsonEnvelopeLoose(result, 'sports resolve plan unsafe');
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'SPORTS_RESOLVE_PLAN_UNSAFE');
  assert.equal(payload.error.details.safeToResolve, false);
  assert.equal(payload.error.details.status, 'unsafe');
  assert.equal(payload.error.details.recommendedAnswer, 'yes');
  assert.equal(payload.error.details.blockingCodes.includes('SETTLE_DELAY_PENDING'), true);
  assert.equal(payload.error.details.timing.recommendedRecheckAt, '2026-03-01T10:10:00.000Z');
  assert.equal(payload.error.details.execution.ready, false);
  assert.equal(Array.isArray(payload.error.details.hints), true);
  assert.equal(payload.error.details.hints.some((hint) => /Retry after 2026-03-01T10:10:00.000Z/.test(hint)), true);
  assert.equal(payload.error.details.hints.some((hint) => /--event-id nba-bos-cle-2026-03-01/.test(hint)), true);
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
