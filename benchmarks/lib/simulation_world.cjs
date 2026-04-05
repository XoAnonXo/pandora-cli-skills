const crypto = require('crypto');

const SIMULATION_WORLD_SCHEMA_VERSION = '1.0.0';
const SIMULATION_TIMELINE_SCHEMA_VERSION = '1.0.0';

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort((left, right) => {
      const a = String(left ?? '');
      const b = String(right ?? '');
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    })) {
      sorted[key] = sortJsonValue(value[key]);
    }
    return sorted;
  }
  return value;
}

function stableJsonHash(value) {
  // Keep hashing deterministic without caching mutable object identities.
  return crypto.createHash('sha256').update(JSON.stringify(sortJsonValue(value))).digest('hex');
}

function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normalizeText(entry)).filter(Boolean);
}

function normalizeLatencyModel(value) {
  const model = value && typeof value === 'object' ? value : {};
  return {
    kind: normalizeText(model.kind) || 'deterministic',
    baseMs: toFiniteNumber(model.baseMs, 0),
    jitterMs: toFiniteNumber(model.jitterMs, 0),
    maxMs: toFiniteNumber(model.maxMs, null),
  };
}

function normalizeFeeModel(value) {
  const model = value && typeof value === 'object' ? value : {};
  return {
    kind: normalizeText(model.kind) || 'flat',
    makerBps: toFiniteNumber(model.makerBps, 0),
    takerBps: toFiniteNumber(model.takerBps, 0),
    fixedUsdc: toFiniteNumber(model.fixedUsdc, 0),
  };
}

function normalizeSimulationLock(input = {}) {
  const lock = input && typeof input === 'object' ? input : {};
  const simulation = lock.simulation && typeof lock.simulation === 'object' ? lock.simulation : {};
  const normalized = {
    schemaVersion: SIMULATION_WORLD_SCHEMA_VERSION,
    suite: normalizeText(lock.suite) || 'proving-ground',
    name: normalizeText(lock.name) || 'default-world',
    simulation: {
      version: normalizeText(simulation.version) || '1',
      seed: normalizeText(simulation.seed) || '0',
      scenarioFamily: normalizeText(simulation.scenarioFamily) || 'default',
      strategyHash: normalizeText(simulation.strategyHash) || null,
      policyHash: normalizeText(simulation.policyHash) || null,
      venueModelHash: normalizeText(simulation.venueModelHash) || null,
      feeModel: normalizeFeeModel(simulation.feeModel),
      latencyModel: normalizeLatencyModel(simulation.latencyModel),
    },
    tags: normalizeStringArray(lock.tags),
    notes: normalizeText(lock.notes),
  };
  normalized.worldHash = stableJsonHash({
    schemaVersion: normalized.schemaVersion,
    suite: normalized.suite,
    name: normalized.name,
    simulation: normalized.simulation,
    tags: normalized.tags,
  });
  return sortJsonValue(normalized);
}

function validateSimulationLock(lock) {
  const normalized = normalizeSimulationLock(lock);
  const failures = [];
  if (!normalized.suite) failures.push('missing suite');
  if (!normalized.name) failures.push('missing name');
  if (!normalized.simulation.version) failures.push('missing simulation.version');
  if (!normalized.simulation.seed) failures.push('missing simulation.seed');
  if (!normalized.simulation.scenarioFamily) failures.push('missing simulation.scenarioFamily');
  return {
    ok: failures.length === 0,
    failures,
    lock: normalized,
  };
}

function makeEventId(input = {}) {
  const payload = {
    type: normalizeText(input.type),
    sequence: toFiniteNumber(input.sequence, null),
    timestamp: normalizeText(input.timestamp),
    actionId: normalizeText(input.actionId),
    parentEventId: normalizeText(input.parentEventId),
    causalId: normalizeText(input.causalId),
    actor: normalizeText(input.actor),
    label: normalizeText(input.label),
    payloadHash: normalizeText(input.payloadHash),
  };
  return `evt_${stableJsonHash(payload).slice(0, 16)}`;
}

function normalizeEvent(input = {}, index = 0, previous = null) {
  const event = input && typeof input === 'object' ? input : {};
  const sequence = toFiniteNumber(event.sequence, index + 1);
  const timestamp = normalizeText(event.timestamp) || null;
  const parentEventId = normalizeText(event.parentEventId) || (previous ? previous.id : null);
  const causalId = normalizeText(event.causalId) || normalizeText(event.actionId) || parentEventId || null;
  const actor = normalizeText(event.actor) || 'system';
  const type = normalizeText(event.type) || 'event';
  const label = normalizeText(event.label) || null;
  const payload = event.payload && typeof event.payload === 'object' ? sortJsonValue(event.payload) : null;
  const payloadHash = payload ? stableJsonHash(payload) : null;
  const id = normalizeText(event.id) || makeEventId({
    type,
    sequence,
    timestamp,
    actionId: event.actionId,
    parentEventId,
    causalId,
    actor,
    label,
    payloadHash,
  });
  return sortJsonValue({
    id,
    sequence,
    timestamp,
    type,
    actor,
    actionId: normalizeText(event.actionId) || null,
    parentEventId,
    causalId,
    label,
    payloadHash,
    payload,
  });
}

function buildEventTimeline(input = {}) {
  const timeline = input && typeof input === 'object' ? input : {};
  const lock = normalizeSimulationLock(timeline.worldLock || timeline.lock || {});
  const rawEvents = Array.isArray(timeline.events) ? timeline.events : [];
  const normalizedEvents = rawEvents
    .map((event, index) => normalizeEvent(event, index, index > 0 ? rawEvents[index - 1] : null))
    .sort((left, right) => {
      const sequenceDiff = toFiniteNumber(left.sequence, 0) - toFiniteNumber(right.sequence, 0);
      if (sequenceDiff !== 0) return sequenceDiff;
      const leftId = String(left.id ?? '');
      const rightId = String(right.id ?? '');
      if (leftId < rightId) return -1;
      if (leftId > rightId) return 1;
      return 0;
    })
    .map((event, index, events) => normalizeEvent({
      ...event,
      parentEventId: index > 0 ? events[index - 1].id : event.parentEventId,
    }, index, index > 0 ? events[index - 1] : null));

  const normalized = {
    schemaVersion: SIMULATION_TIMELINE_SCHEMA_VERSION,
    worldLock: lock,
    generatedAt: normalizeText(timeline.generatedAt) || null,
    events: normalizedEvents,
    summary: {
      eventCount: normalizedEvents.length,
      typeCount: Array.from(new Set(normalizedEvents.map((event) => event.type))).length,
      actorCount: Array.from(new Set(normalizedEvents.map((event) => event.actor))).length,
    },
  };
  normalized.timelineHash = stableJsonHash({
    schemaVersion: normalized.schemaVersion,
    worldHash: lock.worldHash,
    events: normalized.events,
  });
  return sortJsonValue(normalized);
}

function appendEvent(timeline, event) {
  const current = timeline && typeof timeline === 'object' ? timeline : {};
  const events = Array.isArray(current.events) ? current.events.slice() : [];
  events.push(event);
  return buildEventTimeline({
    ...current,
    events,
  });
}

module.exports = {
  SIMULATION_WORLD_SCHEMA_VERSION,
  SIMULATION_TIMELINE_SCHEMA_VERSION,
  buildEventTimeline,
  appendEvent,
  makeEventId,
  normalizeEvent,
  normalizeSimulationLock,
  sortJsonValue,
  stableJsonHash,
  validateSimulationLock,
};
