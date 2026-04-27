const {
  AssetType,
  Chain,
  ClobClient,
  OrderType,
  Side,
  SignatureTypeV2,
} = require('@polymarket/clob-client-v2');

const DEFAULT_POLYMARKET_HOST = 'https://clob-v2.polymarket.com';
const DEFAULT_POLYMARKET_CHAIN = Chain.POLYGON;

function normalizeHost(host) {
  const raw = String(host || DEFAULT_POLYMARKET_HOST).trim();
  return raw || DEFAULT_POLYMARKET_HOST;
}

function buildBuilderConfig(options = {}) {
  if (options.builderConfig && typeof options.builderConfig === 'object') {
    return options.builderConfig;
  }
  const builderCode = String(options.builderCode || '').trim();
  return builderCode ? { builderCode } : undefined;
}

function createClobClient(options = {}) {
  const ClientClass = options.clientClass || ClobClient;
  return new ClientClass({
    host: normalizeHost(options.host),
    chain: options.chain || DEFAULT_POLYMARKET_CHAIN,
    signer: options.signer,
    creds: options.creds,
    signatureType: options.signatureType,
    funderAddress: options.funderAddress || options.funder,
    useServerTime: options.useServerTime,
    builderConfig: buildBuilderConfig(options),
    getSigner: options.getSigner,
    retryOnError: options.retryOnError,
    throwOnError: options.throwOnError,
  });
}

module.exports = {
  AssetType,
  Chain,
  ClobClient,
  DEFAULT_POLYMARKET_CHAIN,
  DEFAULT_POLYMARKET_HOST,
  OrderType,
  Side,
  SignatureTypeV2,
  createClobClient,
};
