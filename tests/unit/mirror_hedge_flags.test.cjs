const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createParseMirrorHedgePlanFlags,
  createParseMirrorHedgeRunFlags,
} = require('../../cli/lib/parsers/mirror_hedge_flags.cjs');

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function requireFlagValue(args, index, flagName) {
  const value = args[index + 1];
  if (value === undefined || String(value).startsWith('--')) {
    throw new CliError('MISSING_FLAG_VALUE', `Missing value for ${flagName}.`);
  }
  return value;
}

function parseAddressFlag(value, flagName) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be an address.`);
  }
  return normalized;
}

function parsePrivateKeyFlag(value) {
  return String(value || '').trim();
}

function parsePositiveInteger(value, flagName) {
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer.`);
  }
  return numeric;
}

function parsePositiveNumber(value, flagName) {
  const numeric = Number(String(value));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive number.`);
  }
  return numeric;
}

function parseInteger(value, flagName) {
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isInteger(numeric)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be an integer.`);
  }
  return numeric;
}

function parseWebhookFlagIntoOptions() {
  return null;
}

function defaultMirrorWorkspacePath(value) {
  return value;
}

function normalizeMirrorPathForMcp(value) {
  return String(value || '').trim();
}

function validateMirrorUrl(value) {
  return String(value || '').trim();
}

function isSecureHttpUrlOrLocal(value) {
  return /^https:\/\//.test(String(value || '')) || /^http:\/\/(localhost|127\.0\.0\.1)/.test(String(value || ''));
}

const parserDeps = {
  CliError,
  requireFlagValue,
  parseAddressFlag,
  parsePrivateKeyFlag,
  parsePositiveInteger,
  parsePositiveNumber,
  parseInteger,
  parseWebhookFlagIntoOptions,
  defaultMirrorWorkspacePath,
  normalizeMirrorPathForMcp,
  validateMirrorUrl,
  isSecureHttpUrlOrLocal,
  defaultMirrorHedgeStateFile: ({ strategyHash } = {}) => `/tmp/${strategyHash || 'hedge'}.json`,
  defaultMirrorHedgeKillSwitchFile: () => '/tmp/mirror-hedge-stop',
};

test('mirror hedge plan parser accepts hedge-daemon specific flags', () => {
  const parse = createParseMirrorHedgePlanFlags(parserDeps);
  const options = parse([
    'plan',
    '--pandora-market-address', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--polymarket-market-id', 'poly-1',
    '--internal-wallets-file', '/tmp/wallets.txt',
    '--min-hedge-usdc', '40',
    '--partial-hedge-policy', 'skip',
    '--sell-hedge-policy', 'manual-only',
    '--bundle-dir', '/tmp/bundle',
  ]);

  assert.equal(options.internalWalletsFile, '/tmp/wallets.txt');
  assert.equal(options.minHedgeUsdc, 40);
  assert.equal(options.partialHedgePolicy, 'skip');
  assert.equal(options.sellHedgePolicy, 'manual-only');
  assert.equal(options.outputDir, '/tmp/bundle');
});

test('mirror hedge run parser accepts hedge-daemon specific flags', () => {
  const parse = createParseMirrorHedgeRunFlags(parserDeps);
  const options = parse([
    'run',
    '--pandora-market-address', '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '--polymarket-slug', 'team-a-vs-team-b',
    '--internal-wallets-file', '/tmp/wallets.txt',
    '--min-hedge-usdc', '35',
    '--partial-hedge-policy', 'partial',
    '--sell-hedge-policy', 'depth-checked',
    '--paper',
  ]);

  assert.equal(options.internalWalletsFile, '/tmp/wallets.txt');
  assert.equal(options.minHedgeUsdc, 35);
  assert.equal(options.partialHedgePolicy, 'partial');
  assert.equal(options.sellHedgePolicy, 'depth-checked');
  assert.equal(options.executeLive, false);
});

test('mirror hedge plan parser rejects unsupported manifest-file flag', () => {
  const parse = createParseMirrorHedgePlanFlags(parserDeps);
  assert.throws(
    () => parse([
      'plan',
      '--pandora-market-address', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--polymarket-market-id', 'poly-1',
      '--internal-wallets-file', '/tmp/wallets.txt',
      '--manifest-file', '/tmp/mirror-pairs.json',
    ]),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGS');
      assert.match(error.message, /--manifest-file is not supported for mirror hedge yet/i);
      return true;
    },
  );
});

test('mirror hedge run parser rejects unsupported manifest-file flag', () => {
  const parse = createParseMirrorHedgeRunFlags(parserDeps);
  assert.throws(
    () => parse([
      'run',
      '--pandora-market-address', '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '--polymarket-market-id', 'poly-1',
      '--internal-wallets-file', '/tmp/wallets.txt',
      '--manifest-file', '/tmp/mirror-pairs.json',
      '--paper',
    ]),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGS');
      assert.match(error.message, /--manifest-file is not supported for mirror hedge yet/i);
      return true;
    },
  );
});
