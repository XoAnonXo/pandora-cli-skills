const { saveState } = require('../mirror_state_store.cjs');

function createServiceError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

/**
 * Populate identifying market selectors into persisted sync state if absent.
 * @param {object} state
 * @param {object} options
 * @returns {void}
 */
function ensureStateIdentity(state, options) {
  if (!state.pandoraMarketAddress) state.pandoraMarketAddress = options.pandoraMarketAddress || null;
  if (!state.polymarketMarketId) state.polymarketMarketId = options.polymarketMarketId || null;
  if (!state.polymarketSlug) state.polymarketSlug = options.polymarketSlug || null;
}

/**
 * Persist end-of-tick state and optionally stream tick callback.
 * @param {{loadedFilePath: string, state: object, tickAt: Date, snapshot: object, snapshots: Array<object>, onTick: Function|null, iteration: number}} params
 * @returns {Promise<void>}
 */
async function persistTickSnapshot(params) {
  const { loadedFilePath, state, tickAt, snapshot, snapshots, onTick, iteration } = params;
  state.lastTickAt = tickAt.toISOString();
  saveState(loadedFilePath, state);
  snapshots.push(snapshot);
  if (onTick) {
    await onTick({
      iteration,
      timestamp: snapshot.timestamp,
      snapshot,
      state,
    });
  }
}

module.exports = {
  createServiceError,
  ensureStateIdentity,
  persistTickSnapshot,
};
