const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REQUIRED_METHODS,
  createVenueConnectorFactory,
} = require('../../cli/lib/venue_connector_factory.cjs');

function buildConnector(overrides = {}) {
  return {
    async getPrice() {
      return {};
    },
    async getBook() {
      return {};
    },
    async placeTrade() {
      return {};
    },
    async cancelTrade() {
      return {};
    },
    async getPositions() {
      return {};
    },
    ...overrides,
  };
}

test('factory validates required connector methods', () => {
  const invalidConnector = buildConnector();
  delete invalidConnector.getBook;

  const factory = createVenueConnectorFactory({
    registry: {
      mock: () => invalidConnector,
    },
  });

  assert.equal(Array.isArray(REQUIRED_METHODS), true);
  assert.throws(() => factory.createConnector('mock'), /missing required method getBook/i);
});

test('factory supports pandora alias via pandora_amm connector key', () => {
  const factory = createVenueConnectorFactory({
    registry: {
      pandora_amm: () => buildConnector(),
    },
  });

  const connector = factory.createConnector('pandora');
  assert.equal(typeof connector.getPrice, 'function');
  assert.equal(typeof connector.getBook, 'function');
  assert.equal(typeof connector.placeTrade, 'function');
  assert.equal(typeof connector.cancelTrade, 'function');
  assert.equal(typeof connector.getPositions, 'function');
});

test('factory throws deterministic error for unknown venue', () => {
  const factory = createVenueConnectorFactory({
    registry: {
      known: () => buildConnector(),
    },
  });

  assert.throws(() => factory.createConnector('unknown-venue'), /unsupported venue connector/i);
});
