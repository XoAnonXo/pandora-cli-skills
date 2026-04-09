const fs = require('node:fs');
const path = require('node:path');

const FAMILY_SCHEMA_VERSION = '1.0.0';

function compareStableStrings(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

const _readJsonCache = new Map();

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(filePath) {
  const resolvedPath = path.resolve(filePath);
  const stats = fs.statSync(resolvedPath);
  const cacheEntry = _readJsonCache.get(resolvedPath);
  if (
    cacheEntry &&
    cacheEntry.mtimeMs === stats.mtimeMs &&
    cacheEntry.size === stats.size
  ) {
    return cloneJson(cacheEntry.value);
  }

  const value = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  _readJsonCache.set(resolvedPath, {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    value,
  });
  return cloneJson(value);
}

function validateEvent(event, caseId, index) {
  if (!event || typeof event !== 'object') {
    throw new Error(`Case ${caseId} events[${index}] must be an object`);
  }
  if (!String(event.type || '').trim()) {
    throw new Error(`Case ${caseId} events[${index}] is missing type`);
  }
  if (!Number.isFinite(Number(event.atMs)) || Number(event.atMs) < 0) {
    throw new Error(`Case ${caseId} events[${index}] must declare a non-negative atMs`);
  }
}

function validateScenarioCase(scenarioCase, familyId, index) {
  if (!scenarioCase || typeof scenarioCase !== 'object') {
    throw new Error(`Family ${familyId} cases[${index}] must be an object`);
  }
  if (!String(scenarioCase.id || '').trim()) {
    throw new Error(`Family ${familyId} cases[${index}] is missing id`);
  }
  if (!String(scenarioCase.title || '').trim()) {
    throw new Error(`Family ${familyId} case ${scenarioCase.id} is missing title`);
  }
  if (!Number.isFinite(Number(scenarioCase.sequence))) {
    throw new Error(`Family ${familyId} case ${scenarioCase.id} must declare sequence`);
  }
  if (!Number.isFinite(Number(scenarioCase.seed))) {
    throw new Error(`Family ${familyId} case ${scenarioCase.id} must declare seed`);
  }
  if (!scenarioCase.initialState || typeof scenarioCase.initialState !== 'object' || Array.isArray(scenarioCase.initialState)) {
    throw new Error(`Family ${familyId} case ${scenarioCase.id} must declare initialState`);
  }
  if (!Array.isArray(scenarioCase.events) || scenarioCase.events.length === 0) {
    throw new Error(`Family ${familyId} case ${scenarioCase.id} must declare events[]`);
  }
  scenarioCase.events.forEach((event, eventIndex) => validateEvent(event, scenarioCase.id, eventIndex));
  if (!scenarioCase.expectations || typeof scenarioCase.expectations !== 'object' || Array.isArray(scenarioCase.expectations)) {
    throw new Error(`Family ${familyId} case ${scenarioCase.id} must declare expectations`);
  }
}

function validateWorldLock(worldLock, familyId) {
  if (!worldLock || typeof worldLock !== 'object' || Array.isArray(worldLock)) {
    throw new Error(`Family ${familyId} must declare worldLock`);
  }
  if (worldLock.schemaVersion !== FAMILY_SCHEMA_VERSION) {
    throw new Error(`Family ${familyId} worldLock schemaVersion must be ${FAMILY_SCHEMA_VERSION}`);
  }
  for (const key of ['worldId', 'simulator', 'feeModel', 'latencyModel', 'marketModel', 'riskPolicy']) {
    if (worldLock[key] === undefined || worldLock[key] === null) {
      throw new Error(`Family ${familyId} worldLock is missing ${key}`);
    }
  }
}

function loadScenarioFamily(familyPath) {
  const resolvedPath = path.resolve(familyPath);
  const family = readJson(resolvedPath);
  if (!family || typeof family !== 'object' || Array.isArray(family)) {
    throw new Error(`Scenario family must be a JSON object: ${resolvedPath}`);
  }
  if (family.schemaVersion !== FAMILY_SCHEMA_VERSION) {
    throw new Error(`Scenario family schemaVersion must be ${FAMILY_SCHEMA_VERSION}: ${resolvedPath}`);
  }
  if (!String(family.familyId || '').trim()) {
    throw new Error(`Scenario family is missing familyId: ${resolvedPath}`);
  }
  if (!String(family.title || '').trim()) {
    throw new Error(`Scenario family ${family.familyId} is missing title`);
  }
  if (!String(family.description || '').trim()) {
    throw new Error(`Scenario family ${family.familyId} is missing description`);
  }
  validateWorldLock(family.worldLock, family.familyId);
  if (!family.generator || typeof family.generator !== 'object' || Array.isArray(family.generator)) {
    throw new Error(`Scenario family ${family.familyId} is missing generator`);
  }
  if (!Number.isFinite(Number(family.generator.seed))) {
    throw new Error(`Scenario family ${family.familyId} generator must declare seed`);
  }
  if (!Array.isArray(family.cases) || family.cases.length === 0) {
    throw new Error(`Scenario family ${family.familyId} must declare cases[]`);
  }

  const cases = family.cases.slice().sort((left, right) => {
    const seqCompare = Number(left.sequence) - Number(right.sequence);
    if (seqCompare !== 0) return seqCompare;
    return compareStableStrings(left.id, right.id);
  });

  const ids = new Set();
  cases.forEach((scenarioCase, index) => {
    validateScenarioCase(scenarioCase, family.familyId, index);
    if (ids.has(scenarioCase.id)) {
      throw new Error(`Scenario family ${family.familyId} contains duplicate case id: ${scenarioCase.id}`);
    }
    ids.add(scenarioCase.id);
  });

  return {
    familyId: family.familyId,
    title: family.title,
    description: family.description,
    worldLock: cloneJson(family.worldLock),
    generator: cloneJson(family.generator),
    caseCount: cases.length,
    cases: cloneJson(cases),
    sourcePath: resolvedPath,
  };
}

module.exports = {
  FAMILY_SCHEMA_VERSION,
  loadScenarioFamily,
  validateScenarioCase,
  validateWorldLock,
};
