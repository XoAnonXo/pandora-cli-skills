#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_ENV_FILE = path.join(ROOT, 'scripts', '.env');
const DEFAULT_ENV_EXAMPLE = path.join(ROOT, 'scripts', '.env.example');
const DEFAULT_INDEXER_URL = 'https://pandoraindexer.up.railway.app/';

const REQUIRED_ENV_KEYS = ['CHAIN_ID', 'RPC_URL', 'PRIVATE_KEY', 'ORACLE', 'FACTORY', 'USDC'];
const SUPPORTED_CHAIN_IDS = new Set([1, 146]);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const COMMAND_TARGETS = {
  launch: path.join(ROOT, 'scripts', 'create_market_launcher.ts'),
  'clone-bet': path.join(ROOT, 'scripts', 'create_polymarket_clone_and_bet.ts'),
};

const OUTPUT_MODES = new Set(['table', 'json']);
const DEFAULT_RPC_TIMEOUT_MS = 12_000;
const DEFAULT_INDEXER_TIMEOUT_MS = 12_000;

const EVENT_SOURCES = {
  liquidity: {
    singleQueryName: 'liquidityEvents',
    listQueryName: 'liquidityEventss',
    filterType: 'liquidityEventsFilter',
    fields: [
      'id',
      'chainId',
      'chainName',
      'provider',
      'marketAddress',
      'pollAddress',
      'eventType',
      'collateralAmount',
      'lpTokens',
      'yesTokenAmount',
      'noTokenAmount',
      'yesTokensReturned',
      'noTokensReturned',
      'txHash',
      'timestamp',
    ],
  },
  'oracle-fee': {
    singleQueryName: 'oracleFeeEvents',
    listQueryName: 'oracleFeeEventss',
    filterType: 'oracleFeeEventsFilter',
    fields: [
      'id',
      'chainId',
      'chainName',
      'oracleAddress',
      'eventName',
      'newFee',
      'to',
      'amount',
      'txHash',
      'blockNumber',
      'timestamp',
    ],
  },
  claim: {
    singleQueryName: 'claimEvents',
    listQueryName: 'claimEventss',
    filterType: 'claimEventsFilter',
    fields: ['id', 'campaignAddress', 'userAddress', 'amount', 'signature', 'blockNumber', 'timestamp', 'txHash'],
  },
};

class CliError extends Error {
  constructor(code, message, details = undefined, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

function printHelpTable() {
  console.log(`
pandora - Prediction market CLI

Usage:
  pandora [--output table|json] help
  pandora [--output table|json] init-env [--force] [--dotenv-path <path>] [--example <path>]
  pandora [--output table|json] doctor [--dotenv-path <path>] [--skip-dotenv] [--check-usdc-code] [--rpc-timeout-ms <ms>]
  pandora [--output table|json] setup [--force] [--dotenv-path <path>] [--example <path>] [--check-usdc-code] [--rpc-timeout-ms <ms>]
  pandora [--output table|json] markets list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>] [--where-json <json>]
  pandora [--output table|json] markets get --id <id>
  pandora [--output table|json] polls list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--status <int>] [--category <int>] [--question-contains <text>] [--where-json <json>]
  pandora [--output table|json] polls get --id <id>
  pandora [--output table|json] events list [--type all|liquidity|oracle-fee|claim] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-direction asc|desc] [--chain-id <id>] [--wallet <address>] [--market-address <address>] [--poll-address <address>] [--tx-hash <hash>]
  pandora [--output table|json] events get --id <id> [--type all|liquidity|oracle-fee|claim]
  pandora [--output table|json] positions list [--wallet <address>] [--market-address <address>] [--chain-id <id>] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--where-json <json>]
  pandora launch [--dotenv-path <path>] [--skip-dotenv] [script args...]
  pandora clone-bet [--dotenv-path <path>] [--skip-dotenv] [script args...]

Examples:
  pandora setup
  pandora --output json doctor --check-usdc-code
  pandora markets list --limit 10 --order-by createdAt --order-direction desc
  pandora polls get --id 0xabc...
  pandora events list --type all --limit 25
  pandora positions list --wallet 0x1234...
  pandora launch --dry-run --market-type amm --question "Will BTC close above $100k by end of 2026?" --rules "Resolves YES if ... Resolves NO if ... cancelled/postponed/abandoned/unresolved => NO." --sources "https://coinmarketcap.com/currencies/bitcoin/" "https://www.coingecko.com/en/coins/bitcoin" --target-timestamp 1798675200 --liquidity 100 --fee-tier 3000

Notes:
  - launch/clone-bet forward unknown flags directly to underlying scripts.
  - scripts/.env is loaded automatically for launch/clone-bet unless --skip-dotenv is used.
  - --output json is supported for non-execution commands (help/init-env/doctor/setup/markets/polls/events/positions).
  - Indexer URL resolution order: --indexer-url, PANDORA_INDEXER_URL, INDEXER_URL, default public indexer.
`);
}

function helpJsonPayload() {
  return {
    usage: [
      'pandora [--output table|json] help',
      'pandora [--output table|json] init-env ...',
      'pandora [--output table|json] doctor ...',
      'pandora [--output table|json] setup ...',
      'pandora [--output table|json] markets list|get ...',
      'pandora [--output table|json] polls list|get ...',
      'pandora [--output table|json] events list|get ...',
      'pandora [--output table|json] positions list ...',
      'pandora launch ...',
      'pandora clone-bet ...',
    ],
    globalFlags: {
      '--output': ['table', 'json'],
    },
  };
}

function normalizeOutputMode(raw) {
  if (!raw) return 'table';
  const mode = String(raw).trim().toLowerCase();
  if (!OUTPUT_MODES.has(mode)) {
    throw new CliError('INVALID_OUTPUT_MODE', `Invalid --output mode: "${raw}". Use table or json.`);
  }
  return mode;
}

function inferRequestedOutputMode(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--output' || token === '-o') {
      const next = argv[i + 1];
      if (String(next).trim().toLowerCase() === 'json') return 'json';
    }
    if (token.startsWith('--output=')) {
      if (token.slice('--output='.length).trim().toLowerCase() === 'json') return 'json';
    }
  }
  return 'table';
}

function extractOutputMode(argv) {
  let outputMode = 'table';
  const args = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--output' || token === '-o') {
      const next = argv[i + 1];
      if (!next) {
        throw new CliError('MISSING_FLAG_VALUE', `Missing value for ${token}`);
      }
      outputMode = normalizeOutputMode(next);
      i += 1;
      continue;
    }

    if (token.startsWith('--output=')) {
      outputMode = normalizeOutputMode(token.slice('--output='.length));
      continue;
    }

    args.push(token);
  }

  return { outputMode, args };
}

function emitJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function emitJsonError(payload) {
  console.error(JSON.stringify(payload, null, 2));
}

function toErrorEnvelope(error) {
  if (error instanceof CliError) {
    const envelope = {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
      },
    };
    if (error.details !== undefined) {
      envelope.error.details = error.details;
    }
    return envelope;
  }

  return {
    ok: false,
    error: {
      code: 'UNEXPECTED_ERROR',
      message: error && error.message ? error.message : String(error),
    },
  };
}

function emitFailure(outputMode, error) {
  const envelope = toErrorEnvelope(error);

  if (outputMode === 'json') {
    emitJsonError(envelope);
  } else {
    console.error(envelope.error.message);
    if (envelope.error.details && Array.isArray(envelope.error.details.errors) && envelope.error.details.errors.length) {
      for (const err of envelope.error.details.errors) {
        console.error(`- ${err}`);
      }
    }
    if (envelope.error.details && Array.isArray(envelope.error.details.hints) && envelope.error.details.hints.length) {
      for (const hint of envelope.error.details.hints) {
        console.error(`Hint: ${hint}`);
      }
    }
  }

  process.exit(error instanceof CliError ? error.exitCode : 1);
}

function emitSuccess(outputMode, command, data, tableRenderer) {
  if (outputMode === 'json') {
    emitJson({ ok: true, command, data });
    return;
  }

  if (typeof tableRenderer === 'function') {
    tableRenderer(data);
    return;
  }

  console.log('Done.');
}

function parseDotEnv(content) {
  const env = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isValidPrivateKey(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new CliError('ENV_FILE_NOT_FOUND', `Env file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = parseDotEnv(raw);
  for (const [key, value] of Object.entries(parsed)) {
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

function loadEnvIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return false;
  loadEnvFile(filePath);
  return true;
}

function resolveTsxCliPath() {
  const tsxPackageJson = require.resolve('tsx/package.json', { paths: [ROOT] });
  return path.join(path.dirname(tsxPackageJson), 'dist', 'cli.mjs');
}

function runTargetScript(targetScript, passThroughArgs) {
  if (!fs.existsSync(targetScript)) {
    throw new CliError('TARGET_SCRIPT_MISSING', `Target script missing: ${targetScript}`);
  }

  const tsxCliPath = resolveTsxCliPath();
  const result = spawnSync(process.execPath, [tsxCliPath, targetScript, ...passThroughArgs], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw new CliError('SCRIPT_EXEC_ERROR', result.error.message);
  }

  process.exit(result.status === null ? 1 : result.status);
}

function parsePositiveInteger(value, flagName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer. Received: "${value}"`);
  }
  return parsed;
}

function parseInteger(value, flagName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be an integer. Received: "${value}"`);
  }
  return parsed;
}

function requireFlagValue(args, index, flagName) {
  const next = args[index + 1];
  if (!next) {
    throw new CliError('MISSING_FLAG_VALUE', `Missing value for ${flagName}`);
  }
  return next;
}

function mergeWhere(where, jsonText, flagName) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new CliError('INVALID_JSON', `${flagName} must be valid JSON.`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError('INVALID_JSON', `${flagName} must decode to a JSON object.`);
  }

  return { ...where, ...parsed };
}

function normalizeDirection(raw) {
  const value = String(raw).trim().toLowerCase();
  if (value !== 'asc' && value !== 'desc') {
    throw new CliError('INVALID_FLAG_VALUE', `--order-direction must be asc or desc. Received: "${raw}"`);
  }
  return value;
}

function parseScriptEnvFlags(args) {
  let envFile = DEFAULT_ENV_FILE;
  let useEnvFile = true;
  const passthrough = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--dotenv-path' || token === '--env-file') {
      const next = requireFlagValue(args, i, '--dotenv-path');
      envFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    if (token === '--skip-dotenv' || token === '--no-env-file') {
      useEnvFile = false;
      continue;
    }

    passthrough.push(token);
  }

  return { envFile, useEnvFile, passthrough };
}

function parseDoctorFlags(args) {
  let envFile = DEFAULT_ENV_FILE;
  let useEnvFile = true;
  let checkUsdcCode = false;
  let rpcTimeoutMs = DEFAULT_RPC_TIMEOUT_MS;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--dotenv-path' || token === '--env-file') {
      const next = requireFlagValue(args, i, '--dotenv-path');
      envFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    if (token === '--skip-dotenv' || token === '--no-env-file') {
      useEnvFile = false;
      continue;
    }

    if (token === '--check-usdc-code') {
      checkUsdcCode = true;
      continue;
    }

    if (token === '--rpc-timeout-ms') {
      const next = requireFlagValue(args, i, '--rpc-timeout-ms');
      rpcTimeoutMs = parsePositiveInteger(next, '--rpc-timeout-ms');
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for doctor: ${token}`);
  }

  return { envFile, useEnvFile, checkUsdcCode, rpcTimeoutMs };
}

function parseSetupFlags(args) {
  let envFile = DEFAULT_ENV_FILE;
  let exampleFile = DEFAULT_ENV_EXAMPLE;
  let force = false;
  let checkUsdcCode = false;
  let rpcTimeoutMs = DEFAULT_RPC_TIMEOUT_MS;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--force') {
      force = true;
      continue;
    }

    if (token === '--dotenv-path' || token === '--env-file') {
      const next = requireFlagValue(args, i, '--dotenv-path');
      envFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    if (token === '--example') {
      const next = requireFlagValue(args, i, '--example');
      exampleFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    if (token === '--check-usdc-code') {
      checkUsdcCode = true;
      continue;
    }

    if (token === '--rpc-timeout-ms') {
      const next = requireFlagValue(args, i, '--rpc-timeout-ms');
      rpcTimeoutMs = parsePositiveInteger(next, '--rpc-timeout-ms');
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for setup: ${token}`);
  }

  return { envFile, exampleFile, force, checkUsdcCode, rpcTimeoutMs };
}

function parseInitEnvFlags(args) {
  let envFile = DEFAULT_ENV_FILE;
  let exampleFile = DEFAULT_ENV_EXAMPLE;
  let force = false;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--force') {
      force = true;
      continue;
    }

    if (token === '--dotenv-path' || token === '--env-file') {
      const next = requireFlagValue(args, i, '--dotenv-path');
      envFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    if (token === '--example') {
      const next = requireFlagValue(args, i, '--example');
      exampleFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for init-env: ${token}`);
  }

  return { envFile, exampleFile, force };
}

function parseIndexerSharedFlags(args) {
  let envFile = DEFAULT_ENV_FILE;
  let envFileExplicit = false;
  let useEnvFile = true;
  let indexerUrl = null;
  let timeoutMs = DEFAULT_INDEXER_TIMEOUT_MS;
  const rest = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--dotenv-path' || token === '--env-file') {
      const next = requireFlagValue(args, i, '--dotenv-path');
      envFile = path.resolve(process.cwd(), next);
      envFileExplicit = true;
      i += 1;
      continue;
    }

    if (token === '--skip-dotenv' || token === '--no-env-file') {
      useEnvFile = false;
      continue;
    }

    if (token === '--indexer-url') {
      const next = requireFlagValue(args, i, '--indexer-url');
      indexerUrl = next;
      i += 1;
      continue;
    }

    if (token === '--timeout-ms') {
      const next = requireFlagValue(args, i, '--timeout-ms');
      timeoutMs = parsePositiveInteger(next, '--timeout-ms');
      i += 1;
      continue;
    }

    rest.push(token);
  }

  return {
    envFile,
    envFileExplicit,
    useEnvFile,
    indexerUrl,
    timeoutMs,
    rest,
  };
}

function parseGetIdFlags(args, entityName) {
  let id = null;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--id') {
      const next = requireFlagValue(args, i, '--id');
      id = next;
      i += 1;
      continue;
    }

    if (token.startsWith('--')) {
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for ${entityName} get: ${token}`);
    }

    if (id) {
      throw new CliError('INVALID_ARGS', `Unexpected extra argument for ${entityName} get: ${token}`);
    }

    id = token;
  }

  if (!id) {
    throw new CliError('MISSING_REQUIRED_FLAG', `Missing ${entityName} id. Use --id <id>.`);
  }

  return { id };
}

function parseMarketsListFlags(args) {
  const options = {
    where: {},
    limit: 20,
    after: null,
    before: null,
    orderBy: 'createdAt',
    orderDirection: 'desc',
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--limit') {
      options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
      i += 1;
      continue;
    }

    if (token === '--after') {
      options.after = requireFlagValue(args, i, '--after');
      i += 1;
      continue;
    }

    if (token === '--before') {
      options.before = requireFlagValue(args, i, '--before');
      i += 1;
      continue;
    }

    if (token === '--order-by') {
      options.orderBy = requireFlagValue(args, i, '--order-by');
      i += 1;
      continue;
    }

    if (token === '--order-direction') {
      options.orderDirection = normalizeDirection(requireFlagValue(args, i, '--order-direction'));
      i += 1;
      continue;
    }

    if (token === '--chain-id') {
      options.where.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }

    if (token === '--creator') {
      options.where.creator = requireFlagValue(args, i, '--creator').toLowerCase();
      i += 1;
      continue;
    }

    if (token === '--poll-address') {
      options.where.pollAddress = requireFlagValue(args, i, '--poll-address').toLowerCase();
      i += 1;
      continue;
    }

    if (token === '--market-type') {
      options.where.marketType = requireFlagValue(args, i, '--market-type');
      i += 1;
      continue;
    }

    if (token === '--where-json') {
      options.where = mergeWhere(options.where, requireFlagValue(args, i, '--where-json'), '--where-json');
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for markets list: ${token}`);
  }

  return options;
}

function parsePollsListFlags(args) {
  const options = {
    where: {},
    limit: 20,
    after: null,
    before: null,
    orderBy: 'createdAt',
    orderDirection: 'desc',
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--limit') {
      options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
      i += 1;
      continue;
    }

    if (token === '--after') {
      options.after = requireFlagValue(args, i, '--after');
      i += 1;
      continue;
    }

    if (token === '--before') {
      options.before = requireFlagValue(args, i, '--before');
      i += 1;
      continue;
    }

    if (token === '--order-by') {
      options.orderBy = requireFlagValue(args, i, '--order-by');
      i += 1;
      continue;
    }

    if (token === '--order-direction') {
      options.orderDirection = normalizeDirection(requireFlagValue(args, i, '--order-direction'));
      i += 1;
      continue;
    }

    if (token === '--chain-id') {
      options.where.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }

    if (token === '--creator') {
      options.where.creator = requireFlagValue(args, i, '--creator').toLowerCase();
      i += 1;
      continue;
    }

    if (token === '--status') {
      options.where.status = parseInteger(requireFlagValue(args, i, '--status'), '--status');
      i += 1;
      continue;
    }

    if (token === '--category') {
      options.where.category = parseInteger(requireFlagValue(args, i, '--category'), '--category');
      i += 1;
      continue;
    }

    if (token === '--question-contains') {
      options.where.question_contains = requireFlagValue(args, i, '--question-contains');
      i += 1;
      continue;
    }

    if (token === '--where-json') {
      options.where = mergeWhere(options.where, requireFlagValue(args, i, '--where-json'), '--where-json');
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for polls list: ${token}`);
  }

  return options;
}

function parsePositionsListFlags(args) {
  const options = {
    where: {},
    wallet: null,
    limit: 20,
    after: null,
    before: null,
    orderBy: 'lastTradeAt',
    orderDirection: 'desc',
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--limit') {
      options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
      i += 1;
      continue;
    }

    if (token === '--after') {
      options.after = requireFlagValue(args, i, '--after');
      i += 1;
      continue;
    }

    if (token === '--before') {
      options.before = requireFlagValue(args, i, '--before');
      i += 1;
      continue;
    }

    if (token === '--order-by') {
      options.orderBy = requireFlagValue(args, i, '--order-by');
      i += 1;
      continue;
    }

    if (token === '--order-direction') {
      options.orderDirection = normalizeDirection(requireFlagValue(args, i, '--order-direction'));
      i += 1;
      continue;
    }

    if (token === '--wallet') {
      options.wallet = requireFlagValue(args, i, '--wallet').toLowerCase();
      options.where.user = options.wallet;
      i += 1;
      continue;
    }

    if (token === '--market-address') {
      options.where.marketAddress = requireFlagValue(args, i, '--market-address').toLowerCase();
      i += 1;
      continue;
    }

    if (token === '--chain-id') {
      options.where.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }

    if (token === '--where-json') {
      options.where = mergeWhere(options.where, requireFlagValue(args, i, '--where-json'), '--where-json');
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for positions list: ${token}`);
  }

  return options;
}

function parseEventsListFlags(args) {
  const options = {
    type: 'all',
    limit: 20,
    after: null,
    before: null,
    orderDirection: 'desc',
    chainId: null,
    wallet: null,
    marketAddress: null,
    pollAddress: null,
    txHash: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--type') {
      const value = requireFlagValue(args, i, '--type').toLowerCase();
      if (value !== 'all' && value !== 'liquidity' && value !== 'oracle-fee' && value !== 'claim') {
        throw new CliError('INVALID_FLAG_VALUE', `--type must be one of all|liquidity|oracle-fee|claim. Received: "${value}"`);
      }
      options.type = value;
      i += 1;
      continue;
    }

    if (token === '--limit') {
      options.limit = parsePositiveInteger(requireFlagValue(args, i, '--limit'), '--limit');
      i += 1;
      continue;
    }

    if (token === '--after') {
      options.after = requireFlagValue(args, i, '--after');
      i += 1;
      continue;
    }

    if (token === '--before') {
      options.before = requireFlagValue(args, i, '--before');
      i += 1;
      continue;
    }

    if (token === '--order-direction') {
      options.orderDirection = normalizeDirection(requireFlagValue(args, i, '--order-direction'));
      i += 1;
      continue;
    }

    if (token === '--chain-id') {
      options.chainId = parseInteger(requireFlagValue(args, i, '--chain-id'), '--chain-id');
      i += 1;
      continue;
    }

    if (token === '--wallet') {
      options.wallet = requireFlagValue(args, i, '--wallet').toLowerCase();
      i += 1;
      continue;
    }

    if (token === '--market-address') {
      options.marketAddress = requireFlagValue(args, i, '--market-address').toLowerCase();
      i += 1;
      continue;
    }

    if (token === '--poll-address') {
      options.pollAddress = requireFlagValue(args, i, '--poll-address').toLowerCase();
      i += 1;
      continue;
    }

    if (token === '--tx-hash') {
      options.txHash = requireFlagValue(args, i, '--tx-hash').toLowerCase();
      i += 1;
      continue;
    }

    throw new CliError('UNKNOWN_FLAG', `Unknown flag for events list: ${token}`);
  }

  return options;
}

function parseEventsGetFlags(args) {
  const options = { id: null, type: 'all' };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--id') {
      options.id = requireFlagValue(args, i, '--id');
      i += 1;
      continue;
    }

    if (token === '--type') {
      const value = requireFlagValue(args, i, '--type').toLowerCase();
      if (value !== 'all' && value !== 'liquidity' && value !== 'oracle-fee' && value !== 'claim') {
        throw new CliError('INVALID_FLAG_VALUE', `--type must be one of all|liquidity|oracle-fee|claim. Received: "${value}"`);
      }
      options.type = value;
      i += 1;
      continue;
    }

    if (token.startsWith('--')) {
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for events get: ${token}`);
    }

    if (options.id) {
      throw new CliError('INVALID_ARGS', `Unexpected extra argument for events get: ${token}`);
    }

    options.id = token;
  }

  if (!options.id) {
    throw new CliError('MISSING_REQUIRED_FLAG', 'Missing event id. Use --id <id>.');
  }

  return options;
}

function parseChainIdFromHex(value) {
  if (!value || typeof value !== 'string') return null;
  const parsed = Number.parseInt(value, 16);
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

async function rpcRequest(rpcUrl, method, params, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new CliError('RPC_TIMEOUT', `RPC request timed out after ${timeoutMs}ms.`);
    }
    throw new CliError('RPC_REQUEST_FAILED', `RPC request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new CliError('RPC_HTTP_ERROR', `RPC endpoint returned HTTP ${response.status}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new CliError('RPC_INVALID_JSON', 'RPC endpoint returned a non-JSON response.');
  }

  if (payload.error) {
    throw new CliError('RPC_RESPONSE_ERROR', `RPC error: ${payload.error.message || 'Unknown RPC error'}`);
  }

  return payload.result;
}

function validateEnvValues() {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !process.env[key] || !String(process.env[key]).trim());
  const missingSet = new Set(missing);
  const errors = [];

  const chainIdRaw = String(process.env.CHAIN_ID || '').trim();
  let chainId = null;
  if (!missingSet.has('CHAIN_ID')) {
    chainId = Number(chainIdRaw);
    if (!Number.isInteger(chainId)) {
      errors.push(`CHAIN_ID must be an integer. Received: "${chainIdRaw}"`);
    } else if (!SUPPORTED_CHAIN_IDS.has(chainId)) {
      errors.push(`Unsupported CHAIN_ID=${chainId}. Supported values: 1, 146`);
    }
  }

  const rpcUrl = String(process.env.RPC_URL || '').trim();
  if (!missingSet.has('RPC_URL') && !isValidHttpUrl(rpcUrl)) {
    errors.push(`RPC_URL must be a valid http/https URL. Received: "${rpcUrl}"`);
  }

  const privateKey = String(process.env.PRIVATE_KEY || '').trim();
  if (!missingSet.has('PRIVATE_KEY') && !isValidPrivateKey(privateKey)) {
    errors.push('PRIVATE_KEY must be a full 32-byte hex key (0x + 64 hex chars), not a placeholder.');
  }

  for (const key of ['ORACLE', 'FACTORY', 'USDC']) {
    const value = String(process.env[key] || '').trim();
    if (missingSet.has(key)) {
      continue;
    }
    if (!isValidAddress(value)) {
      errors.push(`${key} must be a valid 20-byte hex address (0x + 40 hex chars). Received: "${value}"`);
      continue;
    }
    if (value.toLowerCase() === ZERO_ADDRESS) {
      errors.push(`${key} cannot be the zero address.`);
    }
  }

  return {
    missing,
    errors,
    chainId,
    rpcUrl,
    addresses: {
      ORACLE: String(process.env.ORACLE || '').trim(),
      FACTORY: String(process.env.FACTORY || '').trim(),
      USDC: String(process.env.USDC || '').trim(),
    },
  };
}

function summarizeCodePresence(code) {
  if (typeof code !== 'string') return { hasCode: false, byteLength: 0 };
  const normalized = code.trim().toLowerCase();
  if (normalized === '0x' || normalized === '0x0') {
    return { hasCode: false, byteLength: 0 };
  }

  const hex = normalized.startsWith('0x') ? normalized.slice(2) : normalized;
  const byteLength = hex.length > 0 ? Math.floor(hex.length / 2) : 0;
  return { hasCode: byteLength > 0, byteLength };
}

async function buildDoctorReport(options) {
  if (options.useEnvFile) {
    loadEnvFile(options.envFile);
  }

  const envState = validateEnvValues();
  const report = {
    env: {
      envFile: options.envFile,
      usedEnvFile: options.useEnvFile,
      required: {
        ok: envState.missing.length === 0,
        missing: envState.missing,
      },
      validation: {
        ok: envState.errors.length === 0,
        errors: envState.errors,
      },
    },
    rpc: {
      ok: false,
      url: String(process.env.RPC_URL || '').trim(),
      chainIdHex: null,
      chainId: null,
      expectedChainId: Number.isInteger(envState.chainId) ? envState.chainId : null,
      matchesExpectedChainId: null,
      error: null,
    },
    codeChecks: [],
    summary: {
      ok: false,
      errorCount: 0,
      warningCount: 0,
    },
  };

  if (!report.env.required.ok || !report.env.validation.ok) {
    const envErrorCount = report.env.required.missing.length + report.env.validation.errors.length;
    report.summary.ok = false;
    report.summary.errorCount = envErrorCount;
    return report;
  }

  try {
    const chainIdHex = await rpcRequest(envState.rpcUrl, 'eth_chainId', [], options.rpcTimeoutMs);
    report.rpc.chainIdHex = chainIdHex;
    report.rpc.chainId = parseChainIdFromHex(chainIdHex);
    report.rpc.matchesExpectedChainId = report.rpc.chainId === report.rpc.expectedChainId;
    report.rpc.ok = Boolean(report.rpc.chainIdHex) && report.rpc.matchesExpectedChainId;

    if (!report.rpc.matchesExpectedChainId) {
      report.rpc.error = `RPC chain id mismatch. RPC=${report.rpc.chainId} expected=${report.rpc.expectedChainId}`;
    }
  } catch (err) {
    report.rpc.ok = false;
    report.rpc.error = err instanceof CliError ? err.message : String(err);
  }

  const codeTargets = [
    { key: 'ORACLE', required: true },
    { key: 'FACTORY', required: true },
  ];

  if (options.checkUsdcCode) {
    codeTargets.push({ key: 'USDC', required: false });
  }

  for (const target of codeTargets) {
    const address = envState.addresses[target.key];
    const check = {
      key: target.key,
      address,
      required: target.required,
      checked: false,
      ok: false,
      hasCode: false,
      codeByteLength: 0,
      error: null,
    };

    if (!report.rpc.ok) {
      check.error = 'Skipped because RPC reachability check failed.';
      report.codeChecks.push(check);
      continue;
    }

    try {
      const code = await rpcRequest(envState.rpcUrl, 'eth_getCode', [address, 'latest'], options.rpcTimeoutMs);
      const summary = summarizeCodePresence(code);
      check.checked = true;
      check.hasCode = summary.hasCode;
      check.codeByteLength = summary.byteLength;
      check.ok = summary.hasCode;
      if (!summary.hasCode && target.required) {
        check.error = `${target.key} returned empty bytecode.`;
      }
    } catch (err) {
      check.checked = true;
      check.ok = false;
      check.error = err instanceof CliError ? err.message : String(err);
    }

    report.codeChecks.push(check);
  }

  const failures = [];
  if (!report.env.required.ok) {
    failures.push(...report.env.required.missing.map((name) => `Missing required env var: ${name}`));
  }
  if (!report.env.validation.ok) {
    failures.push(...report.env.validation.errors);
  }
  if (!report.rpc.ok) {
    failures.push(report.rpc.error || 'RPC reachability check failed.');
  }
  for (const check of report.codeChecks) {
    if (!check.ok && check.required) {
      failures.push(check.error || `${check.key} failed code check.`);
    }
    if (!check.ok && !check.required && check.error) {
      report.summary.warningCount += 1;
    }
  }

  report.summary.errorCount = failures.length;
  report.summary.ok = failures.length === 0;
  report.summary.failures = failures;
  return report;
}

function short(value, length = 16) {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  if (raw.length <= length) return raw;
  return `${raw.slice(0, length - 3)}...`;
}

function formatTimestamp(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return String(raw);

  const millis = numeric > 1e12 ? numeric : numeric * 1000;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return String(raw);
  return date.toISOString();
}

function valueToCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function printTable(headers, rows) {
  const normalizedRows = rows.map((row) => row.map(valueToCell));
  const widths = headers.map((header, col) => {
    const headerWidth = valueToCell(header).length;
    const rowWidth = normalizedRows.reduce((max, row) => Math.max(max, row[col] ? row[col].length : 0), 0);
    return Math.max(headerWidth, rowWidth);
  });

  const formatRow = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join('  ');
  console.log(formatRow(headers));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of normalizedRows) {
    console.log(formatRow(row));
  }
}

function printRecord(record) {
  const entries = Object.entries(record);
  printTable(
    ['Field', 'Value'],
    entries.map(([key, value]) => [key, valueToCell(value)]),
  );
}

function renderDoctorReportTable(report) {
  if (report.env.usedEnvFile) {
    console.log(`Loaded env file: ${report.env.envFile}`);
  } else {
    console.log('Skipped env file loading (--skip-dotenv).');
  }

  const statusRows = [
    ['required env', report.env.required.ok ? 'PASS' : 'FAIL', report.env.required.ok ? '' : report.env.required.missing.join(', ')],
    ['env validation', report.env.validation.ok ? 'PASS' : 'FAIL', report.env.validation.ok ? '' : `${report.env.validation.errors.length} issue(s)`],
    ['rpc reachability', report.rpc.ok ? 'PASS' : 'FAIL', report.rpc.ok ? `chainId=${report.rpc.chainId}` : report.rpc.error || 'Unavailable'],
  ];

  for (const check of report.codeChecks) {
    const status = check.ok ? 'PASS' : check.required ? 'FAIL' : 'WARN';
    const detail = check.ok ? `${check.codeByteLength} bytes` : check.error || 'No code';
    statusRows.push([`code:${check.key}`, status, detail]);
  }

  printTable(['Check', 'Status', 'Details'], statusRows);

  if (report.summary.ok) {
    console.log('Doctor checks passed.');
  } else {
    console.log('Doctor checks failed.');
    if (Array.isArray(report.summary.failures) && report.summary.failures.length) {
      for (const failure of report.summary.failures) {
        console.log(`- ${failure}`);
      }
    }
  }
}

function renderSetupTable(data) {
  printTable(
    ['Step', 'Status', 'Details'],
    [
      ['init-env', data.envStep.status.toUpperCase(), data.envStep.message],
      ['doctor', data.doctor.summary.ok ? 'PASS' : 'FAIL', data.doctor.summary.ok ? 'All checks passed' : `${data.doctor.summary.errorCount} issue(s)`],
    ],
  );

  renderDoctorReportTable(data.doctor);

  if (data.doctor.summary.ok) {
    console.log('Setup complete.');
  } else {
    console.log('Setup incomplete. Resolve doctor failures and rerun `pandora setup`.');
  }
}

function renderMarketsListTable(data) {
  if (!data.items.length) {
    console.log('No markets found.');
    return;
  }

  printTable(
    ['ID', 'Type', 'Chain', 'Poll', 'Close', 'Volume'],
    data.items.map((item) => [
      short(item.id, 18),
      item.marketType || '',
      `${item.chainName || ''} (${item.chainId || ''})`,
      short(item.pollAddress, 18),
      formatTimestamp(item.marketCloseTimestamp),
      item.totalVolume || '',
    ]),
  );
}

function renderPollsListTable(data) {
  if (!data.items.length) {
    console.log('No polls found.');
    return;
  }

  printTable(
    ['ID', 'Status', 'Creator', 'Deadline', 'Question'],
    data.items.map((item) => [
      short(item.id, 18),
      item.status,
      short(item.creator, 16),
      formatTimestamp(item.deadlineEpoch),
      short(item.question, 56),
    ]),
  );
}

function renderEventsListTable(data) {
  if (!data.items.length) {
    console.log('No events found.');
    return;
  }

  printTable(
    ['ID', 'Source', 'Chain', 'Time', 'Tx', 'Summary'],
    data.items.map((item) => [
      short(item.id, 20),
      item.source,
      item.chainId || '',
      formatTimestamp(item.timestamp || item.blockNumber),
      short(item.txHash, 18),
      short(item.eventType || item.eventName || item.amount || item.marketAddress || '', 42),
    ]),
  );
}

function renderPositionsListTable(data) {
  if (!data.items.length) {
    console.log('No positions found.');
    return;
  }

  printTable(
    ['ID', 'Wallet', 'Market', 'Last Trade', 'Chain'],
    data.items.map((item) => [
      short(item.id, 22),
      short(item.user, 18),
      short(item.marketAddress, 18),
      formatTimestamp(item.lastTradeAt),
      item.chainId,
    ]),
  );
}

function renderSingleEntityTable(data) {
  printRecord(data.item);
}

function buildGraphqlListQuery(queryName, filterType, fields) {
  return `
query ${queryName}List($where: ${filterType}, $orderBy: String, $orderDirection: String, $before: String, $after: String, $limit: Int) {
  ${queryName}(where: $where, orderBy: $orderBy, orderDirection: $orderDirection, before: $before, after: $after, limit: $limit) {
    items {
      ${fields.join('\n      ')}
    }
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
  }
}
`;
}

function buildGraphqlGetQuery(queryName, fields) {
  return `
query ${queryName}Get($id: String!) {
  ${queryName}(id: $id) {
    ${fields.join('\n    ')}
  }
}
`;
}

async function graphqlRequest(indexerUrl, query, variables, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(indexerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new CliError('INDEXER_TIMEOUT', `Indexer request timed out after ${timeoutMs}ms.`);
    }
    throw new CliError('INDEXER_REQUEST_FAILED', `Indexer request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new CliError('INDEXER_HTTP_ERROR', `Indexer returned HTTP ${response.status}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new CliError('INDEXER_INVALID_JSON', 'Indexer returned a non-JSON response.');
  }

  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new CliError('INDEXER_GRAPHQL_ERROR', 'Indexer GraphQL query failed.', { errors: payload.errors });
  }

  return payload.data || {};
}

function resolveIndexerUrl(explicitUrl) {
  const resolved = explicitUrl || process.env.PANDORA_INDEXER_URL || process.env.INDEXER_URL || DEFAULT_INDEXER_URL;
  if (!isValidHttpUrl(resolved)) {
    throw new CliError('INVALID_INDEXER_URL', `Indexer URL must be a valid http/https URL. Received: "${resolved}"`);
  }
  return resolved;
}

function maybeLoadIndexerEnv(sharedFlags) {
  if (!sharedFlags.useEnvFile) return;

  if (sharedFlags.envFileExplicit) {
    loadEnvFile(sharedFlags.envFile);
    return;
  }

  loadEnvIfPresent(sharedFlags.envFile);
}

function normalizeListVariables(options) {
  return {
    where: options.where,
    orderBy: options.orderBy,
    orderDirection: options.orderDirection,
    before: options.before,
    after: options.after,
    limit: options.limit,
  };
}

function normalizePageResult(rawPage) {
  if (!rawPage || typeof rawPage !== 'object') {
    return { items: [], pageInfo: null };
  }

  const items = Array.isArray(rawPage.items) ? rawPage.items : [];
  const pageInfo = rawPage.pageInfo && typeof rawPage.pageInfo === 'object' ? rawPage.pageInfo : null;
  return { items, pageInfo };
}

async function runMarketsCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);

  const action = shared.rest[0];
  const actionArgs = shared.rest.slice(1);

  const fields = [
    'id',
    'chainId',
    'chainName',
    'pollAddress',
    'creator',
    'marketType',
    'marketCloseTimestamp',
    'totalVolume',
    'currentTvl',
    'createdAt',
  ];

  if (action === 'list') {
    const options = parseMarketsListFlags(actionArgs);
    const query = buildGraphqlListQuery('marketss', 'marketsFilter', fields);
    const data = await graphqlRequest(indexerUrl, query, normalizeListVariables(options), shared.timeoutMs);
    const { items, pageInfo } = normalizePageResult(data.marketss);

    emitSuccess(context.outputMode, 'markets.list', {
      indexerUrl,
      pagination: {
        limit: options.limit,
        before: options.before,
        after: options.after,
        orderBy: options.orderBy,
        orderDirection: options.orderDirection,
      },
      filters: options.where,
      count: items.length,
      pageInfo,
      items,
    }, renderMarketsListTable);
    return;
  }

  if (action === 'get') {
    const { id } = parseGetIdFlags(actionArgs, 'markets');
    const query = buildGraphqlGetQuery('markets', fields);
    const data = await graphqlRequest(indexerUrl, query, { id }, shared.timeoutMs);
    const item = data.markets;

    if (!item) {
      throw new CliError('NOT_FOUND', `Market not found for id: ${id}`);
    }

    emitSuccess(context.outputMode, 'markets.get', { indexerUrl, item }, renderSingleEntityTable);
    return;
  }

  throw new CliError('INVALID_ARGS', 'markets requires a subcommand: list|get');
}

async function runPollsCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);

  const action = shared.rest[0];
  const actionArgs = shared.rest.slice(1);

  const fields = [
    'id',
    'chainId',
    'chainName',
    'creator',
    'question',
    'status',
    'category',
    'deadlineEpoch',
    'createdAt',
    'createdTxHash',
  ];

  if (action === 'list') {
    const options = parsePollsListFlags(actionArgs);
    const query = buildGraphqlListQuery('pollss', 'pollsFilter', fields);
    const data = await graphqlRequest(indexerUrl, query, normalizeListVariables(options), shared.timeoutMs);
    const { items, pageInfo } = normalizePageResult(data.pollss);

    emitSuccess(context.outputMode, 'polls.list', {
      indexerUrl,
      pagination: {
        limit: options.limit,
        before: options.before,
        after: options.after,
        orderBy: options.orderBy,
        orderDirection: options.orderDirection,
      },
      filters: options.where,
      count: items.length,
      pageInfo,
      items,
    }, renderPollsListTable);
    return;
  }

  if (action === 'get') {
    const { id } = parseGetIdFlags(actionArgs, 'polls');
    const query = buildGraphqlGetQuery('polls', fields);
    const data = await graphqlRequest(indexerUrl, query, { id }, shared.timeoutMs);
    const item = data.polls;

    if (!item) {
      throw new CliError('NOT_FOUND', `Poll not found for id: ${id}`);
    }

    emitSuccess(context.outputMode, 'polls.get', { indexerUrl, item }, renderSingleEntityTable);
    return;
  }

  throw new CliError('INVALID_ARGS', 'polls requires a subcommand: list|get');
}

function buildEventWhere(type, options) {
  const where = {};

  if (options.chainId !== null) {
    where.chainId = options.chainId;
  }

  if (options.txHash) {
    where.txHash = options.txHash;
  }

  if (type === 'liquidity') {
    if (options.wallet) where.provider = options.wallet;
    if (options.marketAddress) where.marketAddress = options.marketAddress;
    if (options.pollAddress) where.pollAddress = options.pollAddress;
    return where;
  }

  if (type === 'oracle-fee') {
    if (options.wallet) where.to = options.wallet;
    return where;
  }

  if (type === 'claim') {
    if (options.wallet) where.userAddress = options.wallet;
    return where;
  }

  return where;
}

function toEventTimestamp(item) {
  if (item.timestamp !== undefined && item.timestamp !== null) return Number(item.timestamp);
  if (item.blockNumber !== undefined && item.blockNumber !== null) return Number(item.blockNumber);
  return 0;
}

async function fetchEventsByType(indexerUrl, type, options, timeoutMs) {
  const config = EVENT_SOURCES[type];
  if (!config) throw new CliError('INVALID_EVENT_TYPE', `Unknown event type: ${type}`);

  const query = buildGraphqlListQuery(config.listQueryName, config.filterType, config.fields);
  const variables = {
    where: buildEventWhere(type, options),
    orderBy: options.orderBy || (type === 'claim' ? 'blockNumber' : 'timestamp'),
    orderDirection: options.orderDirection,
    before: options.before,
    after: options.after,
    limit: options.limit,
  };

  const data = await graphqlRequest(indexerUrl, query, variables, timeoutMs);
  const key = config.listQueryName;
  const { items, pageInfo } = normalizePageResult(data[key]);

  return {
    items: items.map((item) => ({ ...item, source: type })),
    pageInfo,
  };
}

async function fetchEventByType(indexerUrl, type, id, timeoutMs) {
  const config = EVENT_SOURCES[type];
  if (!config) throw new CliError('INVALID_EVENT_TYPE', `Unknown event type: ${type}`);

  const query = buildGraphqlGetQuery(config.singleQueryName, config.fields);
  const data = await graphqlRequest(indexerUrl, query, { id }, timeoutMs);
  const item = data[config.singleQueryName];
  if (!item) return null;
  return { ...item, source: type };
}

async function runEventsCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);

  const action = shared.rest[0];
  const actionArgs = shared.rest.slice(1);

  if (action === 'list') {
    const options = parseEventsListFlags(actionArgs);
    const types = options.type === 'all' ? ['liquidity', 'oracle-fee', 'claim'] : [options.type];

    const all = [];
    const pageInfoBySource = {};
    for (const type of types) {
      const page = await fetchEventsByType(indexerUrl, type, options, shared.timeoutMs);
      all.push(...page.items);
      pageInfoBySource[type] = page.pageInfo;
    }

    const direction = options.orderDirection === 'asc' ? 1 : -1;
    all.sort((a, b) => (toEventTimestamp(a) - toEventTimestamp(b)) * direction);

    const items = options.type === 'all' ? all.slice(0, options.limit) : all;

    emitSuccess(context.outputMode, 'events.list', {
      indexerUrl,
      filters: {
        type: options.type,
        chainId: options.chainId,
        wallet: options.wallet,
        marketAddress: options.marketAddress,
        pollAddress: options.pollAddress,
        txHash: options.txHash,
      },
      pagination: {
        limit: options.limit,
        before: options.before,
        after: options.after,
        orderDirection: options.orderDirection,
      },
      pageInfoBySource,
      count: items.length,
      items,
    }, renderEventsListTable);
    return;
  }

  if (action === 'get') {
    const options = parseEventsGetFlags(actionArgs);
    const types = options.type === 'all' ? ['liquidity', 'oracle-fee', 'claim'] : [options.type];

    let found = null;
    for (const type of types) {
      found = await fetchEventByType(indexerUrl, type, options.id, shared.timeoutMs);
      if (found) break;
    }

    if (!found) {
      throw new CliError('NOT_FOUND', `Event not found for id: ${options.id}`);
    }

    emitSuccess(context.outputMode, 'events.get', { indexerUrl, item: found }, renderSingleEntityTable);
    return;
  }

  throw new CliError('INVALID_ARGS', 'events requires a subcommand: list|get');
}

async function runPositionsCommand(args, context) {
  const shared = parseIndexerSharedFlags(args);
  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);

  const action = shared.rest[0];
  const actionArgs = shared.rest.slice(1);

  if (action !== 'list') {
    throw new CliError('INVALID_ARGS', 'positions supports only the list subcommand.');
  }

  const options = parsePositionsListFlags(actionArgs);
  const fields = ['id', 'chainId', 'marketAddress', 'user', 'lastTradeAt'];
  const query = buildGraphqlListQuery('marketUserss', 'marketUsersFilter', fields);
  const data = await graphqlRequest(indexerUrl, query, normalizeListVariables(options), shared.timeoutMs);
  const { items, pageInfo } = normalizePageResult(data.marketUserss);

  emitSuccess(context.outputMode, 'positions.list', {
    indexerUrl,
    wallet: options.wallet,
    pagination: {
      limit: options.limit,
      before: options.before,
      after: options.after,
      orderBy: options.orderBy,
      orderDirection: options.orderDirection,
    },
    filters: options.where,
    count: items.length,
    pageInfo,
    items,
  }, renderPositionsListTable);
}

function runInitEnv(args, outputMode) {
  const options = parseInitEnvFlags(args);

  if (!fs.existsSync(options.exampleFile)) {
    throw new CliError('EXAMPLE_FILE_NOT_FOUND', `Example env file not found: ${options.exampleFile}`);
  }

  if (fs.existsSync(options.envFile) && !options.force) {
    throw new CliError('ENV_FILE_EXISTS', `Env file already exists: ${options.envFile}. Use --force to overwrite.`);
  }

  fs.mkdirSync(path.dirname(options.envFile), { recursive: true });
  fs.copyFileSync(options.exampleFile, options.envFile);

  emitSuccess(outputMode, 'init-env', {
    envFile: options.envFile,
    exampleFile: options.exampleFile,
    overwritten: options.force,
  }, (data) => {
    console.log(`Wrote env file: ${data.envFile}`);
  });
}

function runScriptCommand(command, args) {
  const targetScript = COMMAND_TARGETS[command];
  const { envFile, useEnvFile, passthrough } = parseScriptEnvFlags(args);

  if (useEnvFile) {
    try {
      loadEnvFile(envFile);
    } catch (err) {
      if (err instanceof CliError) {
        throw new CliError('ENV_FILE_NOT_FOUND', err.message, {
          hints: ['Run `pandora init-env` first, or pass --skip-dotenv.'],
        });
      }
      throw err;
    }
  }

  runTargetScript(targetScript, passthrough);
}

async function runDoctor(args, outputMode) {
  const options = parseDoctorFlags(args);
  const report = await buildDoctorReport(options);

  if (!report.summary.ok) {
    if (outputMode === 'table') {
      renderDoctorReportTable(report);
    }

    throw new CliError('DOCTOR_FAILED', 'Doctor checks failed.', {
      report,
      errors: report.summary.failures,
    });
  }

  emitSuccess(outputMode, 'doctor', report, renderDoctorReportTable);
}

async function runSetup(args, outputMode) {
  const options = parseSetupFlags(args);

  if (!fs.existsSync(options.exampleFile)) {
    throw new CliError('EXAMPLE_FILE_NOT_FOUND', `Example env file not found: ${options.exampleFile}`);
  }

  let envStep;
  if (fs.existsSync(options.envFile) && !options.force) {
    envStep = {
      status: 'skipped',
      message: `Env file exists at ${options.envFile}. Reusing existing file.`,
      envFile: options.envFile,
      force: false,
    };
  } else {
    fs.mkdirSync(path.dirname(options.envFile), { recursive: true });
    fs.copyFileSync(options.exampleFile, options.envFile);
    envStep = {
      status: 'written',
      message: `Wrote env file: ${options.envFile}`,
      envFile: options.envFile,
      force: options.force,
    };
  }

  const doctor = await buildDoctorReport({
    envFile: options.envFile,
    useEnvFile: true,
    checkUsdcCode: options.checkUsdcCode,
    rpcTimeoutMs: options.rpcTimeoutMs,
  });

  const payload = {
    envStep,
    doctor,
  };

  if (!doctor.summary.ok) {
    if (outputMode === 'table') {
      renderSetupTable(payload);
    }

    throw new CliError('SETUP_FAILED', 'Setup completed with issues. Resolve doctor failures and rerun setup.', {
      setup: payload,
      errors: doctor.summary.failures,
    });
  }

  emitSuccess(outputMode, 'setup', payload, renderSetupTable);
}

async function dispatch(command, args, context) {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'help', helpJsonPayload());
    } else {
      printHelpTable();
    }
    return;
  }

  if (command === 'init-env') {
    runInitEnv(args, context.outputMode);
    return;
  }

  if (command === 'doctor') {
    await runDoctor(args, context.outputMode);
    return;
  }

  if (command === 'setup') {
    await runSetup(args, context.outputMode);
    return;
  }

  if (command === 'markets') {
    await runMarketsCommand(args, context);
    return;
  }

  if (command === 'polls') {
    await runPollsCommand(args, context);
    return;
  }

  if (command === 'events') {
    await runEventsCommand(args, context);
    return;
  }

  if (command === 'positions') {
    await runPositionsCommand(args, context);
    return;
  }

  if (command === 'launch' || command === 'clone-bet') {
    if (context.outputMode === 'json') {
      throw new CliError(
        'UNSUPPORTED_OUTPUT_MODE',
        '--output json is not supported for launch/clone-bet because these commands stream script output directly.',
      );
    }
    runScriptCommand(command, args);
    return;
  }

  throw new CliError('UNKNOWN_COMMAND', `Unknown command: ${command}`, {
    hints: ['Run `pandora help` to see available commands.'],
  });
}

async function main() {
  const rawArgv = process.argv.slice(2);
  let outputMode = inferRequestedOutputMode(rawArgv);
  let args = rawArgv;

  try {
    const parsed = extractOutputMode(rawArgv);
    outputMode = parsed.outputMode;
    args = parsed.args;
  } catch (err) {
    emitFailure(outputMode, err);
    return;
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  try {
    await dispatch(command, commandArgs, { outputMode });
  } catch (err) {
    emitFailure(outputMode, err);
  }
}

main();
