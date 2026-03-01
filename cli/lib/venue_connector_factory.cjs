const { createPolymarketConnector } = require('./connectors/polymarket_connector.cjs');
const { createPandoraAmmConnector } = require('./connectors/pandora_amm_connector.cjs');

const REQUIRED_METHODS = Object.freeze([
  'getPrice',
  'getBook',
  'placeTrade',
  'cancelTrade',
  'getPositions',
]);

const CONNECTOR_KEYS = Object.freeze({
  POLYMARKET: 'polymarket',
  PANDORA_AMM: 'pandora_amm',
});

/**
 * Validate connector runtime interface.
 * @param {string} venue
 * @param {object} connector
 * @returns {object}
 */
function assertConnectorShape(venue, connector) {
  if (!connector || typeof connector !== 'object') {
    throw new Error(`Connector "${venue}" must be an object.`);
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof connector[method] !== 'function') {
      throw new Error(`Connector "${venue}" is missing required method ${method}().`);
    }
  }

  return connector;
}

/**
 * Create venue connector factory used by `odds` command family.
 * @param {object} [options]
 * @param {Record<string, Function>} [options.registry]
 * @returns {{
 *   createConnector: (venue: string, config?: object) => object,
 *   listVenues: () => string[]
 * }}
 */
function createVenueConnectorFactory(options = {}) {
  const registry = {
    [CONNECTOR_KEYS.POLYMARKET]: createPolymarketConnector,
    [CONNECTOR_KEYS.PANDORA_AMM]: createPandoraAmmConnector,
    ...(options.registry && typeof options.registry === 'object' ? options.registry : {}),
  };

  function normalizeVenue(venue) {
    const normalized = String(venue || '').trim().toLowerCase();
    if (!normalized) {
      throw new Error('Venue is required.');
    }
    if (normalized === 'pandora') return CONNECTOR_KEYS.PANDORA_AMM;
    return normalized;
  }

  function createConnector(venue, config = {}) {
    const key = normalizeVenue(venue);
    const factory = registry[key];
    if (typeof factory !== 'function') {
      const available = Object.keys(registry).sort().join(', ');
      throw new Error(`Unsupported venue connector "${key}". Available: ${available}`);
    }

    return assertConnectorShape(key, factory(config));
  }

  function listVenues() {
    return Object.keys(registry).sort();
  }

  return {
    createConnector,
    listVenues,
  };
}

module.exports = {
  REQUIRED_METHODS,
  CONNECTOR_KEYS,
  createVenueConnectorFactory,
};
