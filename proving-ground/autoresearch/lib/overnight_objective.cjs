const path = require('node:path');

const {
  createFingerprint,
  normalizeText,
} = require('./baton_common.cjs');
const { findSurface } = require('./overnight_adapter.cjs');
const { readYamlFile } = require('./overnight_yaml.cjs');

function normalizeStringList(value, fieldName, options = {}) {
  const required = options.required === true;
  const list = Array.isArray(value)
    ? value.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
  if (required && list.length === 0) {
    throw new Error(`${fieldName} must contain at least one entry`);
  }
  return list;
}

function normalizePriority(value) {
  const priority = normalizeText(value).toLowerCase() || 'medium';
  if (!['low', 'medium', 'high'].includes(priority)) {
    throw new Error('priority must be low, medium, or high');
  }
  return priority;
}

function normalizeObjectiveDocument(document, adapter) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('objective document must be an object');
  }
  const goal = normalizeText(document.goal);
  if (!goal) {
    throw new Error('objective goal is required');
  }
  const allowedSurfaces = normalizeStringList(document.allowed_surfaces || document.allowedSurfaces, 'allowed_surfaces', { required: true });
  allowedSurfaces.forEach((surfaceId) => {
    if (!findSurface(adapter, surfaceId)) {
      throw new Error(`objective references unknown surface: ${surfaceId}`);
    }
  });
  return {
    schemaVersion: normalizeText(document.schema_version || document.schemaVersion) || '1.0.0',
    goal,
    allowedSurfaces,
    success: normalizeStringList(document.success, 'success', { required: true }),
    requiredTests: normalizeStringList(document.required_tests || document.requiredTests, 'required_tests', { required: true }),
    stopConditions: normalizeStringList(document.stop_conditions || document.stopConditions, 'stop_conditions', { required: true }),
    evidence: normalizeStringList(document.evidence, 'evidence'),
    priority: normalizePriority(document.priority),
  };
}

function loadOvernightObjective(objectivePath, adapter, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || adapter.repoRoot || process.cwd());
  const resolvedPath = path.resolve(repoRoot, objectivePath || 'proving-ground/autoresearch/objective.yaml');
  const loaded = readYamlFile(resolvedPath);
  const objective = normalizeObjectiveDocument(loaded.document, adapter);
  return {
    ...objective,
    objectiveHash: createFingerprint({
      goal: objective.goal,
      allowedSurfaces: objective.allowedSurfaces,
      success: objective.success,
      requiredTests: objective.requiredTests,
      stopConditions: objective.stopConditions,
      priority: objective.priority,
    }),
    sourcePath: resolvedPath,
  };
}

module.exports = {
  loadOvernightObjective,
  normalizeObjectiveDocument,
};
