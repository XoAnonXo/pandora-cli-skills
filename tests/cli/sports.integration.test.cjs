const test = require('node:test');
const assert = require('node:assert/strict');

const { runCli, startJsonHttpServer } = require('../helpers/cli_runner.cjs');
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
              homeTeam: 'Arsenal',
              awayTeam: 'Chelsea',
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
            homeTeam: 'Arsenal',
            awayTeam: 'Chelsea',
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
  assert.ok(requestedPaths[0].includes('sport=soccer'));
  assert.equal(requestedPaths[1], '/events/evt-1/odds?marketType=soccer_winner');
  assert.equal(requestedPaths[2], '/events/evt-1/status');
  assert.equal(requestedPaths[3], '/health');
});
