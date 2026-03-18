'use strict';

const RESOLUTION_SOURCES_ENV_VAR = 'PANDORA_RESOLUTION_SOURCES';

function normalizeResolutionSources(entries) {
  const values = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const parts = String(entry || '').split(/[\n,]/g);
    for (const part of parts) {
      const normalized = String(part || '').trim();
      if (normalized) values.push(normalized);
    }
  }
  return values;
}

function readResolutionSourcesEnv(env) {
  if (!env || typeof env !== 'object') {
    return { present: false, sources: [] };
  }

  const raw = env[RESOLUTION_SOURCES_ENV_VAR];
  if (raw === undefined || raw === null) {
    return { present: false, sources: [] };
  }

  return {
    present: true,
    sources: normalizeResolutionSources([raw]),
  };
}

module.exports = {
  RESOLUTION_SOURCES_ENV_VAR,
  normalizeResolutionSources,
  readResolutionSourcesEnv,
};
