const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SPORTS_TIMING_SPEC_DEFAULTS,
  toEpochMs,
  resolveTimingSpec,
  planCreationWindow,
  getCreationWindowStatus,
  planResolveWindow,
  getResolveWindowStatus,
  evaluateTimingStatus,
} = require('../../cli/lib/sports_timing_service.cjs');

test('toEpochMs accepts seconds, milliseconds, Date, and ISO strings', () => {
  const iso = '2030-01-01T12:00:00Z';
  const ms = Date.parse(iso);
  const seconds = Math.floor(ms / 1000);

  assert.equal(toEpochMs(seconds), ms);
  assert.equal(toEpochMs(ms), ms);
  assert.equal(toEpochMs(new Date(ms)), ms);
  assert.equal(toEpochMs(iso), ms);
  assert.equal(toEpochMs('not-a-date'), null);
});

test('resolveTimingSpec clamps invalid creation/resolve ordering', () => {
  const spec = resolveTimingSpec({
    creationOpenLeadMs: 10 * 60 * 1000,
    creationCloseLeadMs: 10 * 60 * 1000,
    resolveTargetDelayMs: 9_000,
    resolveCloseDelayMs: 2_000,
  });

  assert.equal(spec.creationOpenLeadMs, 10 * 60 * 1000);
  assert.equal(spec.creationCloseLeadMs, 9 * 60 * 1000);
  assert.equal(spec.resolveCloseDelayMs, 2_000);
  assert.equal(spec.resolveTargetDelayMs, 2_000);
});

test('creation window policy transitions pre-open -> open -> closed', () => {
  const eventStartMs = Date.parse('2030-01-01T12:00:00Z');
  const window = planCreationWindow({ eventStartMs });

  assert.equal(window.valid, true);
  assert.equal(window.opensAtMs, eventStartMs - SPORTS_TIMING_SPEC_DEFAULTS.creationOpenLeadMs);
  assert.equal(window.closesAtMs, eventStartMs - SPORTS_TIMING_SPEC_DEFAULTS.creationCloseLeadMs);

  const preOpen = getCreationWindowStatus({
    nowMs: window.opensAtMs - 1,
    eventStartMs,
  });
  assert.equal(preOpen.status, 'pre-open');
  assert.equal(preOpen.canCreate, false);

  const open = getCreationWindowStatus({
    nowMs: window.opensAtMs,
    eventStartMs,
  });
  assert.equal(open.status, 'open');
  assert.equal(open.canCreate, true);

  const closed = getCreationWindowStatus({
    nowMs: window.closesAtMs,
    eventStartMs,
  });
  assert.equal(closed.status, 'closed');
  assert.equal(closed.canCreate, false);
});

test('resolve window policy handles derived/provided end times and gate states', () => {
  const eventStartMs = Date.parse('2030-01-01T12:00:00Z');
  const eventEndMs = Date.parse('2030-01-01T14:00:00Z');
  const spec = resolveTimingSpec({
    resolveOpenDelayMs: 30 * 60 * 1000,
    resolveTargetDelayMs: 90 * 60 * 1000,
    resolveCloseDelayMs: 4 * 60 * 60 * 1000,
  });

  const providedWindow = planResolveWindow({ eventStartMs, eventEndMs, spec });
  assert.equal(providedWindow.valid, true);
  assert.equal(providedWindow.eventEndSource, 'provided');
  assert.equal(providedWindow.resolveOpenAtMs, eventEndMs + spec.resolveOpenDelayMs);
  assert.equal(providedWindow.resolveTargetAtMs, providedWindow.resolveOpenAtMs + spec.resolveTargetDelayMs);
  assert.equal(providedWindow.resolveCloseAtMs, providedWindow.resolveOpenAtMs + spec.resolveCloseDelayMs);

  const derivedWindow = planResolveWindow({ eventStartMs, spec });
  assert.equal(derivedWindow.eventEndSource, 'derived');
  assert.equal(derivedWindow.eventEndMs, eventStartMs + spec.assumedEventDurationMs);

  const preResolve = getResolveWindowStatus({
    nowMs: providedWindow.resolveOpenAtMs - 1,
    eventStartMs,
    eventEndMs,
    spec,
  });
  assert.equal(preResolve.status, 'pre-resolve');
  assert.equal(preResolve.canResolve, false);

  const resolvable = getResolveWindowStatus({
    nowMs: providedWindow.resolveOpenAtMs,
    eventStartMs,
    eventEndMs,
    spec,
  });
  assert.equal(resolvable.status, 'resolvable');
  assert.equal(resolvable.canResolve, true);

  const closed = getResolveWindowStatus({
    nowMs: providedWindow.resolveCloseAtMs + 1,
    eventStartMs,
    eventEndMs,
    spec,
  });
  assert.equal(closed.status, 'resolve-closed');
  assert.equal(closed.resolveWindowClosed, true);

  const status = evaluateTimingStatus({
    nowMs: providedWindow.resolveOpenAtMs,
    eventStartMs,
    eventEndMs,
    spec,
  });
  assert.equal(status.gates.creationOpen, false);
  assert.equal(status.gates.resolveReady, true);
  assert.equal(status.gates.resolveClosed, false);
});
