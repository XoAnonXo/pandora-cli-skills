/** Default chain RPC endpoints keyed by chain id. */
const DEFAULT_RPC_BY_CHAIN_ID = {
  1: 'https://ethereum.publicnode.com',
};

/** Default public indexer URL used when no override is provided. */
const DEFAULT_INDEXER_URL = 'https://pandoraindexer.up.railway.app/';
/** Default oracle contract address for deploy/admin paths. */
const DEFAULT_ORACLE = '0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442';
/** Default factory contract address for deploy/admin paths. */
const DEFAULT_FACTORY = '0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c';
/** Default USDC token address used by deploy/admin paths. */
const DEFAULT_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

/** Shared constant exports consumed across CLI services/parsers. */
module.exports = {
  DEFAULT_RPC_BY_CHAIN_ID,
  DEFAULT_INDEXER_URL,
  DEFAULT_ORACLE,
  DEFAULT_FACTORY,
  DEFAULT_USDC,
};
