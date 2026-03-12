'use strict';

const os = require('os');
const path = require('path');

const { POLL_CATEGORY_NAME_LIST } = require('./poll_categories.cjs');

const PROFILE_SCHEMA_VERSION = '1.0.0';
const PROFILE_STORE_SCHEMA_VERSION = '1.0.0';
const PROFILE_FILE_ENV_VAR = 'PANDORA_PROFILE_FILE';

const PROFILE_SIGNER_BACKENDS = Object.freeze([
  'local-env',
  'local-keystore',
  'read-only',
  'external-signer',
]);

const PROFILE_APPROVAL_MODES = Object.freeze([
  'manual',
  'policy-gated',
  'read-only',
  'external',
]);

const PROFILE_ENV_PRIVATE_KEY_CANDIDATES = Object.freeze([
  'PANDORA_PRIVATE_KEY',
  'PRIVATE_KEY',
]);

const PROFILE_ENV_DEPLOYER_PRIVATE_KEY_CANDIDATES = Object.freeze([
  'PANDORA_DEPLOYER_PRIVATE_KEY',
  'DEPLOYER_PRIVATE_KEY',
  ...PROFILE_ENV_PRIVATE_KEY_CANDIDATES,
]);

const PROFILE_ENV_WALLET_CANDIDATES = Object.freeze([
  'WALLET',
  'PANDORA_WALLET',
]);

const PROFILE_ENV_RPC_URL_CANDIDATES = Object.freeze([
  'RPC_URL',
]);

const PROFILE_ENV_CHAIN_ID_CANDIDATES = Object.freeze([
  'CHAIN_ID',
]);

const PROFILE_ENV_KEYSTORE_PASSWORD_CANDIDATES = Object.freeze([
  'PANDORA_KEYSTORE_PASSWORD',
  'KEYSTORE_PASSWORD',
]);

const PROFILE_ENV_EXTERNAL_SIGNER_URL_CANDIDATES = Object.freeze([
  'PANDORA_EXTERNAL_SIGNER_URL',
  'EXTERNAL_SIGNER_URL',
]);

const PROFILE_ENV_EXTERNAL_SIGNER_TOKEN_CANDIDATES = Object.freeze([
  'PANDORA_EXTERNAL_SIGNER_TOKEN',
  'EXTERNAL_SIGNER_TOKEN',
]);

const PROFILE_DEFAULT_LOCAL_ENV_PROFILE_ID = 'prod_trader_a';
const PROFILE_DEFAULT_DEPLOYER_PROFILE_ID = 'market_deployer_a';
const PROFILE_DEFAULT_READ_ONLY_PROFILE_ID = 'market_observer_ro';
const PROFILE_DEFAULT_KEYSTORE_PROFILE_ID = 'dev_keystore_operator';
const PROFILE_DEFAULT_EXTERNAL_SIGNER_PROFILE_ID = 'desk_signer_service';

function defaultProfileFile() {
  return path.join(os.homedir(), '.pandora', 'profiles.json');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      deepFreeze(entry);
    }
    return Object.freeze(value);
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

const PROFILE_READ_ONLY_TOOL_FAMILIES = Object.freeze([
  'help',
  'capabilities',
  'schema',
  'markets',
  'scan',
  'events',
  'polls',
  'portfolio',
  'positions',
  'history',
  'leaderboard',
  'quote',
  'watch',
  'stream',
  'odds',
  'sports',
  'mirror',
  'simulate',
  'model',
  'analyze',
  'arb',
  'agent',
  'operations',
]);

const PROFILE_MUTATING_TOOL_FAMILIES = Object.freeze([
  'deploy',
  'trade',
  'sell',
  'lp',
  'claim',
  'resolve',
  'mirror',
  'polymarket',
  'lifecycle',
]);

const PROFILE_BUILTIN_SAMPLE_PROFILES = deepFreeze([
  {
    id: PROFILE_DEFAULT_LOCAL_ENV_PROFILE_ID,
    version: PROFILE_SCHEMA_VERSION,
    displayName: 'Prod Trader A (sample local env profile)',
    description:
      'Built-in sample mutable profile that resolves signer material from local environment variables.',
    signerBackend: 'local-env',
    chainAllowlist: [1, 137],
    categoryAllowlist: ['Politics', 'Sports', 'Finance', 'Crypto'],
    toolFamilyAllowlist: PROFILE_MUTATING_TOOL_FAMILIES,
    defaultPolicy: 'execute-with-validation',
    allowedPolicies: ['execute-with-validation'],
    secretRef: {
      kind: 'env',
      privateKeyEnv: PROFILE_ENV_PRIVATE_KEY_CANDIDATES,
      walletEnv: PROFILE_ENV_WALLET_CANDIDATES,
      rpcUrlEnv: PROFILE_ENV_RPC_URL_CANDIDATES,
      chainIdEnv: PROFILE_ENV_CHAIN_ID_CANDIDATES,
    },
    approvalMode: 'manual',
    riskCeilings: {
      maxDailyNotionalUsd: 2500,
      maxOpenPositions: 6,
      maxSingleTradeUsd: 500,
    },
    labels: {
      builtin: 'true',
      class: 'trader',
      sample: 'true',
    },
    readOnly: false,
  },
  {
    id: PROFILE_DEFAULT_DEPLOYER_PROFILE_ID,
    version: PROFILE_SCHEMA_VERSION,
    displayName: 'Market Deployer A (sample local env profile)',
    description:
      'Built-in sample deployer profile for market creation and mirror deployment using a deployer-compatible local environment signer.',
    signerBackend: 'local-env',
    chainAllowlist: [1],
    categoryAllowlist: ['Politics', 'Sports', 'Finance', 'Crypto'],
    toolFamilyAllowlist: ['deploy'],
    defaultPolicy: 'execute-with-validation',
    allowedPolicies: ['execute-with-validation'],
    secretRef: {
      kind: 'env',
      privateKeyEnv: PROFILE_ENV_DEPLOYER_PRIVATE_KEY_CANDIDATES,
      walletEnv: PROFILE_ENV_WALLET_CANDIDATES,
      rpcUrlEnv: PROFILE_ENV_RPC_URL_CANDIDATES,
      chainIdEnv: PROFILE_ENV_CHAIN_ID_CANDIDATES,
    },
    approvalMode: 'manual',
    riskCeilings: {
      maxDailyNotionalUsd: 5000,
      maxOpenPositions: 12,
      maxSingleTradeUsd: 2500,
    },
    labels: {
      builtin: 'true',
      class: 'deployer',
      sample: 'true',
    },
    readOnly: false,
  },
  {
    id: PROFILE_DEFAULT_READ_ONLY_PROFILE_ID,
    version: PROFILE_SCHEMA_VERSION,
    displayName: 'Market Observer RO (sample read-only profile)',
    description:
      'Built-in sample read-only profile for discovery, analytics, monitoring, and contract inspection.',
    signerBackend: 'read-only',
    chainAllowlist: [],
    categoryAllowlist: POLL_CATEGORY_NAME_LIST,
    toolFamilyAllowlist: PROFILE_READ_ONLY_TOOL_FAMILIES,
    defaultPolicy: 'research-only',
    allowedPolicies: ['research-only'],
    secretRef: null,
    approvalMode: 'read-only',
    riskCeilings: {},
    labels: {
      builtin: 'true',
      class: 'observer',
      sample: 'true',
    },
    readOnly: true,
  },
  {
    id: PROFILE_DEFAULT_KEYSTORE_PROFILE_ID,
    version: PROFILE_SCHEMA_VERSION,
    displayName: 'Dev Keystore Operator (sample local keystore profile)',
    description:
      'Built-in sample keystore-backed profile. The backend is implemented, but runtime readiness still depends on the keystore file, password, and network context.',
    signerBackend: 'local-keystore',
    chainAllowlist: [1],
    categoryAllowlist: ['Sports', 'Crypto'],
    toolFamilyAllowlist: PROFILE_MUTATING_TOOL_FAMILIES,
    defaultPolicy: 'execute-with-validation',
    allowedPolicies: ['execute-with-validation'],
    secretRef: {
      kind: 'file',
      path: '~/.pandora/keys/dev_keystore_operator.json',
      passwordEnv: PROFILE_ENV_KEYSTORE_PASSWORD_CANDIDATES,
      rpcUrlEnv: PROFILE_ENV_RPC_URL_CANDIDATES,
      chainIdEnv: PROFILE_ENV_CHAIN_ID_CANDIDATES,
    },
    approvalMode: 'manual',
    riskCeilings: {
      maxDailyNotionalUsd: 500,
      maxSingleTradeUsd: 100,
    },
    labels: {
      builtin: 'true',
      class: 'operator',
      sample: 'true',
    },
    readOnly: false,
  },
  {
    id: PROFILE_DEFAULT_EXTERNAL_SIGNER_PROFILE_ID,
    version: PROFILE_SCHEMA_VERSION,
    displayName: 'Desk Signer Service (sample external signer profile)',
    description:
      'Built-in sample profile for an external signer integration. The backend is implemented, but runtime readiness still depends on the signer endpoint and network context.',
    signerBackend: 'external-signer',
    chainAllowlist: [1, 137],
    categoryAllowlist: ['Politics', 'Sports', 'Finance', 'Crypto'],
    toolFamilyAllowlist: PROFILE_MUTATING_TOOL_FAMILIES,
    defaultPolicy: 'execute-with-validation',
    allowedPolicies: ['execute-with-validation'],
    secretRef: {
      kind: 'external-signer',
      reference: 'signer://desk-signer-service',
      baseUrlEnv: PROFILE_ENV_EXTERNAL_SIGNER_URL_CANDIDATES,
      authTokenEnv: PROFILE_ENV_EXTERNAL_SIGNER_TOKEN_CANDIDATES,
      rpcUrlEnv: PROFILE_ENV_RPC_URL_CANDIDATES,
      chainIdEnv: PROFILE_ENV_CHAIN_ID_CANDIDATES,
    },
    approvalMode: 'external',
    riskCeilings: {
      maxDailyNotionalUsd: 10000,
      maxSingleTradeUsd: 1500,
    },
    labels: {
      builtin: 'true',
      class: 'service',
      sample: 'true',
    },
    readOnly: false,
  },
]);

module.exports = {
  PROFILE_SCHEMA_VERSION,
  PROFILE_STORE_SCHEMA_VERSION,
  PROFILE_FILE_ENV_VAR,
  PROFILE_SIGNER_BACKENDS,
  PROFILE_APPROVAL_MODES,
  PROFILE_ENV_PRIVATE_KEY_CANDIDATES,
  PROFILE_ENV_DEPLOYER_PRIVATE_KEY_CANDIDATES,
  PROFILE_ENV_WALLET_CANDIDATES,
  PROFILE_ENV_RPC_URL_CANDIDATES,
  PROFILE_ENV_CHAIN_ID_CANDIDATES,
  PROFILE_ENV_KEYSTORE_PASSWORD_CANDIDATES,
  PROFILE_ENV_EXTERNAL_SIGNER_URL_CANDIDATES,
  PROFILE_ENV_EXTERNAL_SIGNER_TOKEN_CANDIDATES,
  PROFILE_DEFAULT_LOCAL_ENV_PROFILE_ID,
  PROFILE_DEFAULT_DEPLOYER_PROFILE_ID,
  PROFILE_DEFAULT_READ_ONLY_PROFILE_ID,
  PROFILE_DEFAULT_KEYSTORE_PROFILE_ID,
  PROFILE_DEFAULT_EXTERNAL_SIGNER_PROFILE_ID,
  PROFILE_READ_ONLY_TOOL_FAMILIES,
  PROFILE_MUTATING_TOOL_FAMILIES,
  PROFILE_BUILTIN_SAMPLE_PROFILES,
  defaultProfileFile,
};
