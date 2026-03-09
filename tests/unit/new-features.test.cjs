const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { EventEmitter } = require('events');

const { normalizeQuestion, questionSimilarity } = require('../../cli/lib/arbitrage_service.cjs');
const { buildSuggestions } = require('../../cli/lib/suggest_service.cjs');
const { evaluateMarket, AnalyzeProviderError } = require('../../cli/lib/analyze_provider.cjs');
const {
  strategyHash,
  saveState,
  pruneIdempotencyKeys,
  resetDailyCountersIfNeeded,
} = require('../../cli/lib/autopilot_state_store.cjs');
const { runAutopilot } = require('../../cli/lib/autopilot_service.cjs');
const { computeLiquidityRecommendation, computeDistributionHint } = require('../../cli/lib/mirror_sizing_service.cjs');
const { hashRules, buildRuleDiffSummary } = require('../../cli/lib/mirror_verify_service.cjs');
const {
  computeCompleteSetAllocation,
  buildMirrorLpExplain,
  buildMirrorHedgeCalc,
  buildMirrorSimulate,
} = require('../../cli/lib/mirror_econ_service.cjs');
const {
  strategyHash: mirrorStrategyHash,
  saveState: saveMirrorState,
  loadState: loadMirrorState,
} = require('../../cli/lib/mirror_state_store.cjs');
const {
  calculateExecutableDepthUsd,
  resolvePolymarketMarket,
  browsePolymarketMarkets,
  placeHedgeOrder,
  readTradingCredsFromEnv,
  fetchPolymarketPositionInventory,
  normalizePolymarketPositionSummary,
  fetchPolymarketPositionSummary,
} = require('../../cli/lib/polymarket_trade_adapter.cjs');
const {
  fetchPolymarketMarkets,
  subscribePolymarketMarketFeed,
} = require('../../cli/lib/polymarket_adapter.cjs');
const { buildPlanDigest } = require('../../cli/lib/mirror_service.cjs');
const { discoverOwnedMarkets } = require('../../cli/lib/markets_mine_service.cjs');
const {
  computeApprovalDiff,
  runPolymarketCheck,
  runPolymarketPreflight,
  runPolymarketWithdraw,
  POLYMARKET_OPS_SCHEMA_VERSION,
} = require('../../cli/lib/polymarket_ops_service.cjs');
const { formatDecodedContractError } = require('../../cli/lib/contract_error_decoder.cjs');
const { runMirrorSync } = require('../../cli/lib/mirror_sync_service.cjs');
const {
  assessMirrorSourceFreshness,
  buildMirrorSourceSubscriptionRequest,
} = require('../../cli/lib/mirror_sync/source_freshness.cjs');
const {
  readPandoraOnchainReserveContext,
  readPandoraOnchainReserveTrace,
} = require('../../cli/lib/mirror_sync/reserve_source.cjs');
const { createRunMirrorCommand } = require('../../cli/lib/mirror_command_service.cjs');
const { createRunPolymarketCommand } = require('../../cli/lib/polymarket_command_service.cjs');
const handleMirrorSync = require('../../cli/lib/mirror_handlers/sync.cjs');
const handleMirrorGo = require('../../cli/lib/mirror_handlers/go.cjs');
const { resolveForkRuntime } = require('../../cli/lib/fork_runtime_service.cjs');
const { createErrorRecoveryService } = require('../../cli/lib/error_recovery_service.cjs');
const { createParseTradeFlags } = require('../../cli/lib/parsers/trade_flags.cjs');
const { createParseWatchFlags } = require('../../cli/lib/parsers/watch_flags.cjs');
const { createParseAutopilotFlags } = require('../../cli/lib/parsers/autopilot_flags.cjs');
const { createParseMirrorDeployFlags } = require('../../cli/lib/parsers/mirror_deploy_flags.cjs');
const { createParseMirrorGoFlags } = require('../../cli/lib/parsers/mirror_go_flags.cjs');
const {
  createParseMirrorBrowseFlags,
  createParseMirrorTraceFlags,
} = require('../../cli/lib/parsers/mirror_remaining_flags.cjs');
const { createParseLifecycleFlags } = require('../../cli/lib/parsers/lifecycle_flags.cjs');
const { createParseOddsFlags } = require('../../cli/lib/parsers/odds_flags.cjs');
const {
  createParsePolymarketSharedFlags,
  createParsePolymarketPositionsFlags,
} = require('../../cli/lib/parsers/polymarket_flags.cjs');
const {
  createParseMirrorSyncFlags,
  createParseMirrorSyncDaemonSelectorFlags,
} = require('../../cli/lib/parsers/mirror_sync_flags.cjs');
const { parseArbScanFlags, buildArbOpportunities } = require('../../cli/lib/arb_command_service.cjs');
const {
  buildTickPlan,
  buildTickSnapshot,
  buildVerifyRequest,
} = require('../../cli/lib/mirror_sync/planning.cjs');
const {
  MIRROR_SYNC_GATE_CODES,
  applyGateBypassPolicy,
  normalizeSkipGateChecks,
  evaluateSnapshot,
  evaluateStrictGates,
  resolveMinimumTimeToCloseSec,
  runStartupVerify,
} = require('../../cli/lib/mirror_sync/gates.cjs');
const { buildIdempotencyKey } = require('../../cli/lib/mirror_sync/execution.cjs');
const { DEFAULT_MIRROR_MIN_CLOSE_LEAD_SECONDS } = require('../../cli/lib/shared/mirror_timing.cjs');
const {
  ensureStateIdentity,
  buildMirrorRuntimeTelemetry,
  buildPendingActionFilePath,
  readPendingActionLock,
} = require('../../cli/lib/mirror_sync/state.cjs');
const handleMirrorDashboard = require('../../cli/lib/mirror_handlers/dashboard.cjs');

class ParserCliError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ParserCliError';
    this.code = code;
    this.details = details;
  }
}

function parserRequireFlagValue(args, i, flagName) {
  const value = args[i + 1];
  if (typeof value !== 'string' || value.startsWith('--')) {
    throw new ParserCliError('MISSING_FLAG_VALUE', `Missing value for ${flagName}`);
  }
  return value;
}

function parserParsePositiveInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be a positive integer.`);
  }
  return parsed;
}

function parserParsePositiveNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be a positive number.`);
  }
  return parsed;
}

function parserParseInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be an integer.`);
  }
  return parsed;
}

function parserParseNonNegativeInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be a non-negative integer.`);
  }
  return parsed;
}

function parserParseProbabilityPercent(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be between 0 and 100.`);
  }
  return parsed;
}

function parserParseOutcomeSide(value, flagName) {
  const normalized = String(value || '').toLowerCase();
  if (normalized !== 'yes' && normalized !== 'no') {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be yes|no.`);
  }
  return normalized;
}

function parserParseNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be numeric.`);
  }
  return parsed;
}

function parserParseAddressFlag(value, flagName) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(value))) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be an EVM address.`);
  }
  return value;
}

function parserParsePrivateKeyFlag(value, flagName) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(value))) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be a 32-byte hex key.`);
  }
  return value;
}

function parserIsSecureHttpUrlOrLocal(value) {
  return /^https:\/\//.test(value) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(value);
}

function parserParseDateLikeFlag(value, flagName) {
  const text = String(value || '').trim();
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be an ISO date/time string.`);
  }
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must be an ISO date/time string.`);
  }
  return text;
}

function parserParseMirrorSyncGateSkipList(value, flagName) {
  const checks = String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.toUpperCase());
  if (!checks.length) {
    throw new ParserCliError('INVALID_FLAG_VALUE', `${flagName} must include at least one check code.`);
  }
  return Array.from(new Set(checks));
}

function parserMergeMirrorSyncGateSkipLists(current, incoming) {
  const left = Array.isArray(current) ? current : [];
  const right = Array.isArray(incoming) ? incoming : [];
  return Array.from(new Set([...left, ...right]));
}

function buildParserDeps(overrides = {}) {
  return {
    CliError: ParserCliError,
    parseAddressFlag: parserParseAddressFlag,
    parsePrivateKeyFlag: parserParsePrivateKeyFlag,
    requireFlagValue: parserRequireFlagValue,
    parsePositiveInteger: parserParsePositiveInteger,
    parsePositiveNumber: parserParsePositiveNumber,
    parseInteger: parserParseInteger,
    parseNonNegativeInteger: parserParseNonNegativeInteger,
    parseProbabilityPercent: parserParseProbabilityPercent,
    parseDateLikeFlag: parserParseDateLikeFlag,
    parseOutcomeSide: parserParseOutcomeSide,
    parseNumber: parserParseNumber,
    isValidPrivateKey: (value) => /^0x[a-fA-F0-9]{64}$/.test(String(value)),
    parseWebhookFlagIntoOptions: () => null,
    isSecureHttpUrlOrLocal: parserIsSecureHttpUrlOrLocal,
    parseMirrorSyncGateSkipList: parserParseMirrorSyncGateSkipList,
    mergeMirrorSyncGateSkipLists: parserMergeMirrorSyncGateSkipLists,
    ...overrides,
  };
}

function withMcpMode(fn) {
  const original = process.env.PANDORA_MCP_MODE;
  process.env.PANDORA_MCP_MODE = '1';
  try {
    return fn();
  } finally {
    if (original === undefined) {
      delete process.env.PANDORA_MCP_MODE;
    } else {
      process.env.PANDORA_MCP_MODE = original;
    }
  }
}

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const TEST_MARKET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TEST_PRIVATE_KEY = `0x${'1'.repeat(64)}`;
const TEST_USDC = '0x3333333333333333333333333333333333333333';
const POLYMARKET_TEST_SPENDERS = {
  exchange: '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  negRiskExchange: '0xc5d563a36ae78145c45a50134d48a1215220f80a',
  negRiskAdapter: '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
};

function buildPolymarketOpsTestViemRuntime(options = {}) {
  const signerAddress = String(options.signerAddress || TEST_WALLET).toLowerCase();
  const funderAddress = String(options.funderAddress || signerAddress).toLowerCase();
  const allowanceValue =
    options.allowanceValue === null || options.allowanceValue === undefined
      ? 1n << 200n
      : BigInt(options.allowanceValue);
  const usdcBalanceRaw =
    options.usdcBalanceRaw === null || options.usdcBalanceRaw === undefined
      ? 2_500_000n
      : BigInt(options.usdcBalanceRaw);
  const safeOwner = options.safeOwner !== false;
  const deadRpcUrls = new Set(
    (Array.isArray(options.deadRpcUrls) ? options.deadRpcUrls : []).map((entry) => String(entry)),
  );

  return {
    parseUnits(value, decimals) {
      const [wholePart, fractionPart = ''] = String(value).split('.');
      const whole = BigInt(wholePart || '0');
      const paddedFraction = `${fractionPart}${'0'.repeat(decimals)}`.slice(0, decimals);
      const fraction = BigInt(paddedFraction || '0');
      return whole * (10n ** BigInt(decimals)) + fraction;
    },
    http(url) {
      return { url };
    },
    privateKeyToAccount() {
      return { address: signerAddress };
    },
    createPublicClient({ transport }) {
      const rpcUrl = transport && transport.url ? String(transport.url) : '';
      return {
        async getChainId() {
          if (deadRpcUrls.has(rpcUrl)) {
            throw new Error(`RPC down for ${rpcUrl}`);
          }
          return 137;
        },
        async getBytecode({ address }) {
          return String(address || '').toLowerCase() === funderAddress ? '0x6001600101' : '0x';
        },
        async readContract({ functionName }) {
          if (functionName === 'balanceOf') {
            return usdcBalanceRaw;
          }
          if (functionName === 'allowance') {
            return allowanceValue;
          }
          if (functionName === 'isApprovedForAll') {
            return true;
          }
          if (functionName === 'isOwner') {
            return safeOwner;
          }
          throw new Error(`Unsupported readContract function ${functionName}`);
        },
      };
    },
  };
}

async function startUnitIndexerMetadataServer(fixtures = {}) {
  const marketsById = new Map(
    Object.entries(fixtures.markets || {}).map(([id, value]) => [String(id).toLowerCase(), value]),
  );
  const pollsById = new Map(
    Object.entries(fixtures.polls || {}).map(([id, value]) => [String(id).toLowerCase(), value]),
  );

  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      let parsed;
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ errors: [{ message: 'invalid json' }] }));
        return;
      }

      const query = String(parsed && parsed.query ? parsed.query : '');
      const variables = parsed && parsed.variables && typeof parsed.variables === 'object'
        ? parsed.variables
        : {};
      const data = {};

      if (query.includes('markets')) {
        if (Object.prototype.hasOwnProperty.call(variables, 'id')) {
          data.markets = marketsById.get(String(variables.id).toLowerCase()) || null;
        }
        for (const [key, value] of Object.entries(variables)) {
          if (/^id\d+$/.test(key)) {
            data[`item${key.slice(2)}`] = marketsById.get(String(value).toLowerCase()) || null;
          }
        }
      }

      if (query.includes('polls')) {
        if (Object.prototype.hasOwnProperty.call(variables, 'id')) {
          data.polls = pollsById.get(String(variables.id).toLowerCase()) || null;
        }
        for (const [key, value] of Object.entries(variables)) {
          if (/^id\d+$/.test(key)) {
            data[`item${key.slice(2)}`] = pollsById.get(String(value).toLowerCase()) || null;
          }
        }
      }

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

test('normalizeQuestion strips punctuation and stopwords', () => {
  const value = normalizeQuestion('Will, the Arsenal win the PL?!');
  assert.equal(value, 'arsenal win pl');
});

test('questionSimilarity is high for equivalent phrasing', () => {
  const score = questionSimilarity('Will Arsenal win the PL?', 'Arsenal to win Premier League');
  assert.ok(score > 0.6);
});

test('mirror browse parser validates URL override flags', () => {
  const parseMirrorBrowseFlags = createParseMirrorBrowseFlags(buildParserDeps());

  assert.throws(
    () => parseMirrorBrowseFlags(['--polymarket-gamma-url', 'http://example.com/gamma']),
    (error) => error && error.code === 'INVALID_FLAG_VALUE',
  );
});

test('createParsePolymarketSharedFlags accepts comma-separated rpc fallback chains', () => {
  const parsePolymarketSharedFlags = createParsePolymarketSharedFlags(buildParserDeps());
  const parsed = parsePolymarketSharedFlags(
    ['--rpc-url', 'https://primary.example, https://secondary.example,https://primary.example'],
    'check',
  );
  assert.equal(parsed.rpcUrl, 'https://primary.example,https://secondary.example');
});

test('mirror sync selector parser blocks pid files outside workspace in MCP mode', () => {
  const parseMirrorSyncDaemonSelectorFlags = createParseMirrorSyncDaemonSelectorFlags(buildParserDeps());

  withMcpMode(() => {
    assert.throws(
      () => parseMirrorSyncDaemonSelectorFlags(['--pid-file', '/tmp/mirror.pid'], 'stop'),
      (error) => error && error.code === 'MCP_FILE_ACCESS_BLOCKED',
    );
  });
});

test('buildSuggestions returns bounded deterministic suggestions', () => {
  const payload = buildSuggestions({
    wallet: '0xabc',
    risk: 'medium',
    budget: 60,
    count: 2,
    arbitrageOpportunities: [
      {
        groupId: 'g1',
        spreadYesPct: 8,
        spreadNoPct: 2,
        confidenceScore: 0.7,
        bestYesBuy: { venue: 'pandora', marketId: 'm1' },
        bestNoBuy: { venue: 'pandora', marketId: 'm2' },
        riskFlags: [],
      },
      {
        groupId: 'g2',
        spreadYesPct: 2,
        spreadNoPct: 6,
        confidenceScore: 0.6,
        bestYesBuy: { venue: 'polymarket', marketId: 'm3' },
        bestNoBuy: { venue: 'polymarket', marketId: 'm4' },
        riskFlags: ['LOW_LIQUIDITY'],
      },
    ],
  });

  assert.equal(payload.count, 2);
  assert.equal(payload.items[0].groupId, 'g1');
  assert.equal(payload.items[0].amountUsdc, 30);
});

test('evaluateMarket throws deterministic error without provider', async () => {
  await assert.rejects(
    () => evaluateMarket({ market: { yesPct: 50 } }, {}),
    (error) => {
      assert.equal(error instanceof AnalyzeProviderError, true);
      assert.equal(error.code, 'ANALYZE_PROVIDER_NOT_CONFIGURED');
      return true;
    },
  );
});

test('contract error formatter maps known trade-size selector to actionable hint', () => {
  const message = formatDecodedContractError({ data: '0x7e2d7787' });
  assert.match(message, /trade too large/i);
  assert.match(message, /--max-imbalance/i);
});

test('autopilot state helpers are deterministic', () => {
  const hash1 = strategyHash({ a: 1, b: 'x' });
  const hash2 = strategyHash({ a: 1, b: 'x' });
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 16);

  const state = { idempotencyKeys: ['a', 'b', 'c', 'd', 'e'] };
  pruneIdempotencyKeys(state, 3);
  assert.deepEqual(state.idempotencyKeys, ['c', 'd', 'e']);

  const stale = {
    lastResetDay: '2000-01-01',
    dailySpendUsdc: 100,
    tradesToday: 10,
  };
  resetDailyCountersIfNeeded(stale, new Date('2026-02-26T00:00:00.000Z'));
  assert.equal(stale.dailySpendUsdc, 0);
  assert.equal(stale.tradesToday, 0);
  assert.equal(stale.lastResetDay, '2026-02-26');
});

test('saveState uses unique temp files per write to avoid cross-process rename collisions', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-autopilot-state-'));
  const stateFile = path.join(tempDir, 'state.json');

  const originalWriteFileSync = fs.writeFileSync;
  const originalRenameSync = fs.renameSync;
  const writeTargets = [];
  const renameTargets = [];

  try {
    fs.writeFileSync = (target, content) => {
      writeTargets.push(target);
      return originalWriteFileSync(target, content);
    };
    fs.renameSync = (from, to) => {
      renameTargets.push([from, to]);
      return originalRenameSync(from, to);
    };

    saveState(stateFile, { iteration: 1 });
    saveState(stateFile, { iteration: 2 });
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    fs.renameSync = originalRenameSync;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  assert.equal(writeTargets.length, 2);
  assert.equal(renameTargets.length, 2);
  assert.notEqual(writeTargets[0], writeTargets[1]);
  assert.match(path.basename(writeTargets[0]), /^state\.json\.\d+\.\d+\.[a-f0-9]{8}\.tmp$/);
  assert.match(path.basename(writeTargets[1]), /^state\.json\.\d+\.\d+\.[a-f0-9]{8}\.tmp$/);
});

test('saveState lock file is cleaned up after writes', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-autopilot-lock-'));
  const stateFile = path.join(tempDir, 'state.json');
  const lockFile = `${stateFile}.lock`;
  try {
    saveState(stateFile, { iteration: 1 });
    assert.equal(fs.existsSync(lockFile), false);
    saveState(stateFile, { iteration: 2 });
    assert.equal(fs.existsSync(lockFile), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('mirror liquidity sizing applies model + depth caps deterministically', () => {
  const payload = computeLiquidityRecommendation({
    volume24hUsd: 100_000,
    depthWithinSlippageUsd: 6_000,
    targetSlippageBps: 150,
    turnoverTarget: 1.25,
    safetyMultiplier: 1.2,
    minLiquidityUsd: 100,
    maxLiquidityUsd: 50_000,
  });

  assert.equal(payload.schemaVersion, '1.0.0');
  assert.equal(payload.recommendation.liquidityUsd, 50000);
  assert.equal(payload.recommendation.boundedByMax, true);
  assert.ok(payload.derived.lImpact > 0);
});

test('mirror distribution hint maps YES probability into 1e9 parts', () => {
  const distribution = computeDistributionHint(0.37);
  assert.equal(distribution.distributionNo, 370000000);
  assert.equal(distribution.distributionYes, 630000000);
});

test('mirror complete-set allocation keeps total YES/NO inventory neutral', () => {
  const allocation = computeCompleteSetAllocation({
    liquidityUsdc: 10000,
    distributionYes: 420000000,
    distributionNo: 580000000,
  });

  assert.equal(allocation.neutralCompleteSets, true);
  assert.equal(allocation.totalYesRaw.toString(), allocation.totalNoRaw.toString());
  assert.equal(allocation.reserveYesUsdc, 10000);
  assert.ok(allocation.reserveNoUsdc < 10000);
  assert.ok(allocation.excessNoUsdc > 0);
});

test('mirror lp-explain returns deterministic complete-set flow fields', () => {
  const payload = buildMirrorLpExplain({
    liquidityUsdc: 10000,
    sourceYesPct: 58,
  });

  assert.equal(payload.schemaVersion, '1.0.0');
  assert.equal(payload.flow.totalLpInventory.neutralCompleteSets, true);
  assert.equal(payload.flow.totalLpInventory.deltaUsdc, 0);
  assert.equal(payload.inputs.distributionYes + payload.inputs.distributionNo, 1000000000);
});

test('mirror lp-explain treats --source-yes-pct as explicit percent scale', () => {
  const payload = buildMirrorLpExplain({
    liquidityUsdc: 1000,
    sourceYesPct: 1,
  });

  assert.equal(payload.inputs.sourceYesPct, 1);
  assert.equal(payload.inputs.distributionNo, 10000000);
  assert.equal(payload.inputs.distributionYes, 990000000);
});

test('mirror hedge-calc computes hedge side, size, and break-even volume', () => {
  const payload = buildMirrorHedgeCalc({
    reserveYesUsdc: 8,
    reserveNoUsdc: 12,
    excessYesUsdc: 0,
    excessNoUsdc: 2,
    polymarketYesPct: 60,
    hedgeRatio: 1,
    feeTier: 3000,
    hedgeCostBps: 30,
    volumeScenarios: [1000, 5000],
  });

  assert.equal(payload.schemaVersion, '1.0.0');
  assert.equal(payload.metrics.hedgeToken, 'yes');
  assert.ok(payload.metrics.targetHedgeUsdcAbs > 0);
  assert.ok(payload.metrics.breakEvenVolumeUsdc > 0);
  assert.equal(payload.scenarios.length, 2);
});

test('mirror simulate models fee accrual and hedge recommendation per volume scenario', () => {
  const payload = buildMirrorSimulate({
    liquidityUsdc: 5000,
    sourceYesPct: 60,
    targetYesPct: 60,
    polymarketYesPct: 60,
    feeTier: 3000,
    hedgeRatio: 1,
    volumeScenarios: [500, 2500],
  });

  assert.equal(payload.schemaVersion, '1.0.0');
  assert.equal(payload.inputs.tradeSide, 'yes');
  assert.equal(payload.scenarios.length, 2);
  assert.equal(typeof payload.scenarios[0].feesEarnedUsdc, 'number');
  assert.equal(typeof payload.scenarios[0].netPnlApproxUsdc, 'number');
});

test('mirror plan digest changes when rules text changes', () => {
  const base = {
    sourceMarket: {
      marketId: 'poly-cond-1',
      slug: 'deterministic-tests-pass',
      question: 'Will deterministic tests pass?',
      description: 'Rule A',
      yesPct: 60,
      closeTimestamp: 1893456000,
    },
    rules: {
      sourceRules: 'Rule A',
      proposedPandoraRules: 'Rule A',
      sourceCount: 2,
    },
    liquidityRecommendation: { liquidityUsdc: 1000 },
    distributionHint: { distributionYes: 400000000, distributionNo: 600000000 },
  };

  const digestA = buildPlanDigest(base);
  const digestB = buildPlanDigest({
    ...base,
    rules: {
      ...base.rules,
      proposedPandoraRules: 'Rule B',
    },
  });

  assert.notEqual(digestA, digestB);
});

test('mirror rule hashing normalizes whitespace and case', () => {
  const left = hashRules('Resolves YES if A.\nResolves NO otherwise.');
  const right = hashRules('resolves yes if a. resolves no otherwise.');
  assert.equal(left, right);

  const diff = buildRuleDiffSummary('Resolves YES if A.', 'Resolves NO if B.');
  assert.equal(diff.equal, false);
  assert.ok(diff.overlapRatio < 1);
});

test('mirror state writes use unique temp paths and deterministic hash', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-state-'));
  const stateFile = path.join(tempDir, 'mirror.json');

  const hash1 = mirrorStrategyHash({ market: '0xabc', mode: 'once' });
  const hash2 = mirrorStrategyHash({ market: '0xabc', mode: 'once' });
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 16);

  const originalWriteFileSync = fs.writeFileSync;
  const writeTargets = [];

  try {
    fs.writeFileSync = (target, content) => {
      writeTargets.push(target);
      return originalWriteFileSync(target, content);
    };

    saveMirrorState(stateFile, { iteration: 1 });
    saveMirrorState(stateFile, { iteration: 2 });
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  assert.equal(writeTargets.length, 2);
  assert.notEqual(writeTargets[0], writeTargets[1]);
  assert.match(path.basename(writeTargets[0]), /^mirror\.json\.\d+\.\d+\.[a-f0-9]{8}\.tmp$/);
});

test('mirror state loader preserves stored strategy hash when lookup hash is omitted', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-state-load-'));
  const stateFile = path.join(tempDir, 'mirror.json');

  try {
    fs.writeFileSync(
      stateFile,
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          strategyHash: 'feedfacecafebeef',
          tradesToday: 1,
        },
        null,
        2,
      ),
    );

    const loaded = loadMirrorState(stateFile, null);
    assert.equal(loaded.state.strategyHash, 'feedfacecafebeef');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('orderbook depth calculation honors slippage window', () => {
  const depth = calculateExecutableDepthUsd(
    {
      bids: [
        { price: '0.48', size: '100' },
        { price: '0.47', size: '100' },
      ],
      asks: [
        { price: '0.52', size: '100' },
        { price: '0.53', size: '100' },
      ],
    },
    'buy',
    500,
  );

  assert.ok(depth.depthUsd > 0);
  assert.ok(depth.midPrice !== null);
  assert.ok(depth.worstPrice !== null);
});

test('placeHedgeOrder returns ok=false when CLOB response includes error payload', async () => {
  const result = await placeHedgeOrder({
    tokenId: 'poly-yes-1',
    side: 'buy',
    amountUsd: 10,
    client: {
      getTickSize: async () => 0.01,
      getNegRisk: async () => false,
      createAndPostMarketOrder: async () => ({ status: 401, error: 'Unauthorized' }),
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.mode, 'live');
  assert.equal(result.orderType, 'FAK');
  assert.equal(result.tokenId, 'poly-yes-1');
});

test('placeHedgeOrder catches thrown CLOB errors and returns structured failure payload', async () => {
  const result = await placeHedgeOrder({
    tokenId: 'poly-no-1',
    side: 'buy',
    amountUsd: 5,
    client: {
      getTickSize: async () => 0.01,
      getNegRisk: async () => false,
      createAndPostMarketOrder: async () => {
        throw new Error('network timeout');
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.mode, 'live');
  assert.equal(typeof result.error.message, 'string');
  assert.match(result.error.message, /network timeout/i);
});

test('placeHedgeOrder times out hanging getTickSize calls', async () => {
  const result = await placeHedgeOrder({
    tokenId: 'poly-yes-timeout-1',
    side: 'buy',
    amountUsd: 5,
    timeoutMs: 50,
    client: {
      getTickSize: async () => new Promise(() => {}),
      getNegRisk: async () => false,
      createAndPostMarketOrder: async () => ({ status: 200 }),
    },
  });

  assert.equal(result.ok, false);
  assert.match(String(result.error && result.error.message), /getTickSize/i);
  assert.match(String(result.error && result.error.message), /timed out/i);
});

test('placeHedgeOrder times out hanging createAndPostMarketOrder calls', async () => {
  const result = await placeHedgeOrder({
    tokenId: 'poly-yes-timeout-2',
    side: 'buy',
    amountUsd: 5,
    timeoutMs: 50,
    client: {
      getTickSize: async () => 0.01,
      getNegRisk: async () => false,
      createAndPostMarketOrder: async () => new Promise(() => {}),
    },
  });

  assert.equal(result.ok, false);
  assert.match(String(result.error && result.error.message), /createAndPostMarketOrder/i);
  assert.match(String(result.error && result.error.message), /timed out/i);
});

test('placeHedgeOrder surfaces deriveApiKey timeout from buildTradingClient', async () => {
  class HangingDeriveClobClient {
    async deriveApiKey() {
      return new Promise(() => {});
    }
  }

  await assert.rejects(
    () =>
      placeHedgeOrder({
        tokenId: 'poly-yes-timeout-derive',
        side: 'buy',
        amountUsd: 5,
        timeoutMs: 50,
        disableCache: true,
        host: 'https://timeout-derive.polymarket.test',
        privateKey: `0x${'1'.repeat(64)}`,
        clobClientClass: HangingDeriveClobClient,
      }),
    (error) => {
      assert.match(String(error && error.message), /deriveApiKey/i);
      assert.match(String(error && error.message), /timed out/i);
      return true;
    },
  );
});

test('placeHedgeOrder surfaces createOrDeriveApiKey timeout from buildTradingClient', async () => {
  class HangingCreateOrDeriveClobClient {
    async createOrDeriveApiKey() {
      return new Promise(() => {});
    }
  }

  await assert.rejects(
    () =>
      placeHedgeOrder({
        tokenId: 'poly-yes-timeout-create',
        side: 'buy',
        amountUsd: 5,
        timeoutMs: 50,
        disableCache: true,
        host: 'https://timeout-create.polymarket.test',
        privateKey: `0x${'2'.repeat(64)}`,
        clobClientClass: HangingCreateOrDeriveClobClient,
      }),
    (error) => {
      assert.match(String(error && error.message), /createOrDeriveApiKey/i);
      assert.match(String(error && error.message), /timed out/i);
      return true;
    },
  );
});

test('placeHedgeOrder treats non-object CLOB responses as failures', async () => {
  const result = await placeHedgeOrder({
    tokenId: 'poly-yes-1',
    side: 'buy',
    amountUsd: 5,
    client: {
      getTickSize: async () => 0.01,
      getNegRisk: async () => false,
      createAndPostMarketOrder: async () => 'unauthorized',
    },
  });

  assert.equal(result.ok, false);
  assert.match(String(result.error && result.error.message), /rejected/i);
});

test('readTradingCredsFromEnv does not silently fallback to PRIVATE_KEY', () => {
  const creds = readTradingCredsFromEnv({
    PRIVATE_KEY: `0x${'1'.repeat(64)}`,
    POLYMARKET_FUNDER: '0x2222222222222222222222222222222222222222',
  });

  assert.equal(creds.privateKey, null);
  assert.equal(creds.funder, '0x2222222222222222222222222222222222222222');
});

test('readTradingCredsFromEnv rejects malformed POLYMARKET_PRIVATE_KEY values', () => {
  const creds = readTradingCredsFromEnv({
    POLYMARKET_PRIVATE_KEY: 'not-a-private-key',
    POLYMARKET_FUNDER: '0x3333333333333333333333333333333333333333',
  });

  assert.equal(creds.privateKey, null);
  assert.equal(creds.privateKeyInvalid, true);
  assert.equal(creds.funder, '0x3333333333333333333333333333333333333333');
});

test('normalizePolymarketPositionSummary computes balances, open orders, and mark-to-market value', () => {
  const summary = normalizePolymarketPositionSummary({
    marketId: 'poly-cond-1',
    yesTokenId: 'poly-yes-1',
    noTokenId: 'poly-no-1',
    yesPrice: 74,
    noPrice: 26,
    balancesByToken: {
      'poly-yes-1': '12.5',
      'poly-no-1': '3.25',
    },
    openOrders: [
      {
        id: 'order-1',
        market: 'poly-cond-1',
        asset_id: 'poly-yes-1',
        original_size: '10',
        size_matched: '4',
        price: '0.74',
      },
      {
        id: 'order-2',
        market: 'poly-cond-1',
        asset_id: 'poly-no-1',
        remaining_size: '2',
        price: '0.26',
      },
    ],
  });

  assert.equal(summary.yesBalance, 12.5);
  assert.equal(summary.noBalance, 3.25);
  assert.equal(summary.openOrdersCount, 2);
  assert.equal(summary.openOrdersNotionalUsd, 4.96);
  assert.equal(summary.estimatedValueUsd, 10.095);
  assert.equal(summary.positionDeltaApprox, 9.25);
  assert.equal(Array.isArray(summary.diagnostics), true);
  assert.equal(summary.diagnostics.length, 0);
});

test('normalizePolymarketPositionSummary degrades gracefully for missing payloads', () => {
  const summary = normalizePolymarketPositionSummary({
    marketId: 'poly-cond-1',
    yesTokenId: 'poly-yes-1',
    noTokenId: 'poly-no-1',
    yesPrice: 0.74,
  });

  assert.equal(summary.yesBalance, null);
  assert.equal(summary.noBalance, null);
  assert.equal(summary.openOrdersCount, null);
  assert.equal(summary.estimatedValueUsd, null);
  assert.equal(summary.positionDeltaApprox, null);
  assert.equal(summary.diagnostics.some((line) => line.includes('Open orders unavailable')), true);
});

test('fetchPolymarketPositionSummary composes authenticated CTF balances and scoped open orders', async () => {
  const calls = [];
  const summary = await fetchPolymarketPositionSummary({
    market: {
      marketId: 'poly-cond-1',
      yesTokenId: 'poly-yes-1',
      noTokenId: 'poly-no-1',
      yesPct: 74,
      noPct: 26,
    },
    privateKey: `0x${'1'.repeat(64)}`,
    client: {
      getBalanceAllowance: async ({ token_id }) => {
        calls.push(['getBalanceAllowance', token_id]);
        if (token_id === 'poly-yes-1') return { balance: '7.5' };
        if (token_id === 'poly-no-1') return { balance: '2' };
        throw new Error(`unexpected token ${token_id}`);
      },
      getOpenOrders: async (query) => {
        calls.push(['getOpenOrders', query]);
        return [
          {
            id: 'order-1',
            market: 'poly-cond-1',
            asset_id: 'poly-yes-1',
            remaining_size: '3',
            price: '0.74',
          },
          {
            id: 'order-2',
            market: 'other-market',
            asset_id: 'other-token',
            remaining_size: '8',
            price: '0.11',
          },
        ];
      },
    },
  });

  assert.equal(summary.yesBalance, 7.5);
  assert.equal(summary.noBalance, 2);
  assert.equal(summary.openOrdersCount, 1);
  assert.equal(summary.openOrdersNotionalUsd, 2.22);
  assert.equal(summary.estimatedValueUsd, 6.07);
  assert.equal(summary.positionDeltaApprox, 5.5);
  assert.deepEqual(summary.prices, { yes: 0.74, no: 0.26 });
  assert.deepEqual(summary.diagnostics, []);
  assert.deepEqual(calls, [
    ['getBalanceAllowance', 'poly-yes-1'],
    ['getBalanceAllowance', 'poly-no-1'],
    ['getOpenOrders', { market: 'poly-cond-1' }],
  ]);
});

test('resolvePolymarketMarket scans deep pagination for selector matches', async () => {
  const pages = [
    {
      data: Array.from({ length: 250 }, (_, index) => ({
        condition_id: `early-${index}`,
        market_slug: `early-${index}`,
        question: `Early market ${index}`,
        active: true,
        closed: false,
        tokens: [
          { outcome: 'Yes', price: '0.51', token_id: `yes-early-${index}` },
          { outcome: 'No', price: '0.49', token_id: `no-early-${index}` },
        ],
      })),
      next_cursor: 'cursor-2',
    },
    {
      data: Array.from({ length: 250 }, (_, index) => ({
        condition_id: `middle-${index}`,
        market_slug: `middle-${index}`,
        question: `Middle market ${index}`,
        active: true,
        closed: false,
        tokens: [
          { outcome: 'Yes', price: '0.52', token_id: `yes-middle-${index}` },
          { outcome: 'No', price: '0.48', token_id: `no-middle-${index}` },
        ],
      })),
      next_cursor: 'cursor-3',
    },
    {
      data: [
        {
          condition_id: 'target-cond-id',
          market_slug: 'target-market',
          question: 'Target market deep in pagination',
          rules: 'Exact target rules text',
          active: true,
          closed: false,
          tokens: [
            { outcome: 'Yes', price: '0.61', token_id: 'yes-target' },
            { outcome: 'No', price: '0.39', token_id: 'no-target' },
          ],
        },
      ],
      next_cursor: null,
    },
  ];
  let pageIndex = 0;
  let callCount = 0;

  const payload = await resolvePolymarketMarket({
    marketId: 'target-cond-id',
    allowStaleCache: false,
    clientFactory: () => ({
      getMarkets: async () => {
        callCount += 1;
        const current = pages[Math.min(pageIndex, pages.length - 1)];
        pageIndex += 1;
        return current;
      },
    }),
  });

  assert.equal(payload.marketId, 'target-cond-id');
  assert.equal(payload.question, 'Target market deep in pagination');
  assert.equal(callCount >= 3, true);
});

test('resolvePolymarketMarket composes rich rules text for mirror copy', async () => {
  const inline = await resolvePolymarketMarket({
    marketId: 'rules-cond-id',
    allowStaleCache: false,
    persistCache: false,
    clientFactory: () => ({
      getMarkets: async () => ({
        data: [
          {
            condition_id: 'rules-cond-id',
            question: 'Exact question text?',
            rules: 'Primary rules block.',
            description: 'Extended market description.',
            resolution_source: 'Official source URL list.',
            events: [{ description: 'Event-level description' }],
            active: true,
            closed: false,
            tokens: [
              { outcome: 'Yes', price: '0.52', token_id: 'yes-rules' },
              { outcome: 'No', price: '0.48', token_id: 'no-rules' },
            ],
          },
        ],
        next_cursor: null,
      }),
    }),
  });

  assert.equal(inline.question, 'Exact question text?');
  assert.match(inline.description, /Primary rules block\./);
  assert.match(inline.description, /Extended market description\./);
  assert.match(inline.description, /Resolution Source: Official source URL list\./);
  assert.match(inline.description, /Event: Event-level description/);
});

test('resolvePolymarketMarket uses direct getMarket lookup for conditionId selectors', async () => {
  const conditionId = `0x${'a'.repeat(64)}`;
  let getMarketCalls = 0;
  let getMarketsCalls = 0;

  const payload = await resolvePolymarketMarket({
    marketId: conditionId,
    allowStaleCache: false,
    persistCache: false,
    clientFactory: () => ({
      getMarket: async (id) => {
        getMarketCalls += 1;
        assert.equal(id, conditionId);
        return {
          condition_id: conditionId,
          market_slug: 'direct-lookup-market',
          question: 'Direct lookup market?',
          active: true,
          closed: false,
          tokens: [
            { outcome: 'Yes', price: '0.44', token_id: 'yes-direct' },
            { outcome: 'No', price: '0.56', token_id: 'no-direct' },
          ],
        };
      },
      getMarkets: async () => {
        getMarketsCalls += 1;
        return { data: [], next_cursor: null };
      },
    }),
  });

  assert.equal(payload.marketId, conditionId);
  assert.equal(payload.slug, 'direct-lookup-market');
  assert.equal(payload.source, 'polymarket:clob-direct');
  assert.equal(getMarketCalls >= 1, true);
  assert.equal(getMarketsCalls, 0);
});

test('resolvePolymarketMarket cache files are written with 0600 permissions (non-Windows)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-poly-cache-'));
  const cacheFile = path.join(tempDir, 'market-cache.json');
  try {
    await resolvePolymarketMarket({
      marketId: 'cache-cond-id',
      allowStaleCache: false,
      cacheFile,
      clientFactory: () => ({
        getMarkets: async () => ({
          data: [
            {
              condition_id: 'cache-cond-id',
              market_slug: 'cache-market',
              question: 'Cache market?',
              active: true,
              closed: false,
              tokens: [
                { outcome: 'Yes', price: '0.51', token_id: 'yes-cache' },
                { outcome: 'No', price: '0.49', token_id: 'no-cache' },
              ],
            },
          ],
          next_cursor: null,
        }),
      }),
    });

    assert.equal(fs.existsSync(cacheFile), true);
    if (process.platform !== 'win32') {
      const mode = fs.statSync(cacheFile).mode & 0o777;
      assert.equal(mode, 0o600);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('resolvePolymarketMarket times out hanging CLOB calls instead of hanging indefinitely', async () => {
  const conditionId = `0x${'b'.repeat(64)}`;
  await assert.rejects(
    () =>
      resolvePolymarketMarket({
        marketId: conditionId,
        host: 'https://clob.polymarket.com',
        timeoutMs: 50,
        maxPages: 1,
        allowStaleCache: false,
        persistCache: false,
        clientFactory: () => ({
          getMarket: async () => new Promise(() => {}),
          getMarkets: async () => new Promise(() => {}),
        }),
      }),
    (error) => {
      assert.match(String(error && error.message), /timed out/i);
      return true;
    },
  );
});

test('browsePolymarketMarkets filters mock payload deterministically', async () => {
  const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        markets: [
          {
            condition_id: 'c1',
            market_slug: 'kept-market',
            question: 'Will Team A win?',
            end_date_iso: '2030-03-09T16:00:00Z',
            active: true,
            closed: false,
            volume24hr: 120000,
            tokens: [
              { outcome: 'Yes', price: '0.6', token_id: 'yes-1' },
              { outcome: 'No', price: '0.4', token_id: 'no-1' },
            ],
          },
          {
            condition_id: 'c2',
            market_slug: 'filtered-market',
            question: 'Will Team B win?',
            end_date_iso: '2030-03-09T16:00:00Z',
            active: true,
            closed: false,
            volume24hr: 100,
            tokens: [
              { outcome: 'Yes', price: '0.9', token_id: 'yes-2' },
              { outcome: 'No', price: '0.1', token_id: 'no-2' },
            ],
          },
        ],
      }),
    );
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const mockUrl = `http://127.0.0.1:${port}/markets`;

  try {
    const payload = await browsePolymarketMarkets({
      mockUrl,
      minYesPct: 20,
      maxYesPct: 80,
      minVolume24h: 1000,
      limit: 5,
    });
    assert.equal(payload.schemaVersion, '1.0.0');
    assert.equal(payload.count, 1);
    assert.equal(payload.items[0].slug, 'kept-market');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('fetchPolymarketMarkets prefers game_start_time over midnight endDateIso for sports rows', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return [
        {
          conditionId: 'gamma-sports-1',
          question: 'Will Everton beat Burnley?',
          slug: 'everton-v-burnley-home',
          endDateIso: '2030-03-09T00:00:00Z',
          game_start_time: '2030-03-09T23:00:00Z',
          liquidityNum: '15000',
          volumeNum: '25000',
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.61","0.39"]',
        },
      ];
    },
  });

  try {
    const payload = await fetchPolymarketMarkets({ limit: 10, timeoutMs: 1000 });
    assert.equal(payload.source, 'polymarket:gamma');
    assert.equal(payload.count, 1);
    assert.equal(
      payload.items[0].closeTimestamp,
      Math.floor(Date.parse('2030-03-09T23:00:00Z') / 1000),
    );
    assert.equal(
      payload.items[0].eventStartTimestamp,
      Math.floor(Date.parse('2030-03-09T23:00:00Z') / 1000),
    );
    assert.equal(
      payload.items[0].sourceCloseTimestamp,
      Math.floor(Date.parse('2030-03-09T00:00:00Z') / 1000),
    );
    assert.equal(payload.items[0].timestampSource, 'game_start_time');
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchPolymarketMarkets annotates live-feed freshness when websocket prices refresh sports rows', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return [
        {
          conditionId: 'gamma-feed-1',
          question: 'Will Everton beat Burnley?',
          slug: 'everton-v-burnley-home',
          endDateIso: '2030-03-09T00:00:00Z',
          game_start_time: '2030-03-09T23:00:00Z',
          liquidityNum: '15000',
          volumeNum: '25000',
          tokens: [
            { outcome: 'Yes', price: '0.61', token_id: 'feed-yes-1' },
            { outcome: 'No', price: '0.39', token_id: 'feed-no-1' },
          ],
        },
      ];
    },
  });

  class FakeSocket extends EventEmitter {
    constructor() {
      super();
      this.sent = [];
      setImmediate(() => this.emit('open'));
    }

    send(payload) {
      this.sent.push(JSON.parse(payload));
      setImmediate(() => {
        this.emit('message', JSON.stringify({
          type: 'price_change',
          asset_id: 'feed-yes-1',
          best_bid: '0.63',
          best_ask: '0.65',
        }));
        this.emit('message', JSON.stringify({
          type: 'price_change',
          asset_id: 'feed-no-1',
          best_bid: '0.35',
          best_ask: '0.37',
        }));
      });
    }

    close() {}
  }

  try {
    const payload = await fetchPolymarketMarkets({
      limit: 10,
      timeoutMs: 1000,
      maxAgeMs: 10_000,
      webSocketFactory: () => new FakeSocket(),
    });

    assert.equal(payload.source, 'polymarket:feed');
    assert.equal(payload.sourceFreshness.transport, 'stream');
    assert.equal(payload.sourceFreshness.usedLivePrices, true);
    assert.equal(payload.sourceFreshness.fresh, true);
    assert.equal(payload.subscription.supported, true);
    assert.equal(payload.subscription.attempted, true);
    assert.equal(payload.subscription.connected, true);
    assert.equal(payload.items[0].sourceFreshness.transport, 'stream');
    assert.equal(payload.items[0].sourceFreshness.usedLivePrices, true);
    assert.equal(payload.items[0].sourceFreshness.fresh, true);
    assert.equal(payload.items[0].yesPct > 60, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchPolymarketMarkets preserves poll freshness metadata when live feed is disabled', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return [
        {
          conditionId: 'gamma-poll-1',
          question: 'Will bitcoin trade above 120k in 2026?',
          slug: 'bitcoin-price-120k-2026',
          endDateIso: '2030-03-09T18:00:00Z',
          liquidityNum: '15000',
          volumeNum: '25000',
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.55","0.45"]',
        },
      ];
    },
  });

  try {
    const payload = await fetchPolymarketMarkets({
      limit: 10,
      timeoutMs: 1000,
      disableLiveFeed: true,
      maxAgeMs: 10_000,
    });

    assert.equal(payload.source, 'polymarket:gamma');
    assert.equal(payload.sourceFreshness.transport, 'poll');
    assert.equal(payload.sourceFreshness.usedLivePrices, false);
    assert.equal(payload.sourceFreshness.fresh, true);
    assert.equal(payload.subscription.attempted, false);
    assert.equal(payload.items[0].sourceFreshness.transport, 'poll');
    assert.equal(payload.items[0].sourceFreshness.fresh, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('subscribePolymarketMarketFeed streams incremental price updates for subscribed token ids', async () => {
  const statusEvents = [];
  const priceEvents = [];

  class FakeSocket extends EventEmitter {
    constructor() {
      super();
      setImmediate(() => this.emit('open'));
    }

    send() {
      setImmediate(() => {
        this.emit('message', JSON.stringify({
          type: 'price_change',
          asset_id: 'sub-yes-1',
          best_bid: '0.58',
          best_ask: '0.60',
        }));
      });
    }

    close() {}
  }

  const subscription = subscribePolymarketMarketFeed({
    assetIds: ['sub-yes-1'],
    webSocketFactory: () => new FakeSocket(),
    onStatus: (event) => {
      statusEvents.push(event.event);
    },
    onPrice: (event) => {
      priceEvents.push(event);
    },
  });

  await subscription.ready;
  await new Promise((resolve) => setTimeout(resolve, 10));
  const snapshot = subscription.getSnapshot();
  subscription.close();

  assert.equal(statusEvents.includes('open'), true);
  assert.equal(priceEvents.length, 1);
  assert.equal(snapshot.priceByAssetId.get('sub-yes-1') > 0.58, true);
  assert.equal(typeof snapshot.observedAt, 'string');
});

test('mirror source freshness policy tightens sports max age and recommends stream on short live intervals', () => {
  const sportsSource = {
    source: 'polymarket:feed',
    timestampSource: 'game_start_time',
    eventStartTimestamp: Math.floor(Date.parse('2030-03-09T23:00:00Z') / 1000),
    sourceCloseTimestamp: Math.floor(Date.parse('2030-03-09T00:00:00Z') / 1000),
    yesTokenId: 'sports-yes',
    noTokenId: 'sports-no',
    sourceFreshness: {
      transport: 'poll',
      observedAt: new Date(Date.now() - 20_000).toISOString(),
    },
  };
  const nonSportsSource = {
    source: 'polymarket:gamma',
    yesTokenId: 'crypto-yes',
    noTokenId: 'crypto-no',
    sourceFreshness: {
      transport: 'poll',
      observedAt: new Date(Date.now() - 20_000).toISOString(),
    },
  };

  const sportsAssessment = assessMirrorSourceFreshness(sportsSource, {
    executeLive: true,
    intervalMs: 5_000,
    nowMs: Date.now(),
  });
  const nonSportsAssessment = assessMirrorSourceFreshness(nonSportsSource, {
    executeLive: true,
    intervalMs: 30_000,
    nowMs: Date.now(),
  });
  const subscriptionRequest = buildMirrorSourceSubscriptionRequest(sportsSource, {
    executeLive: true,
    intervalMs: 5_000,
  });

  assert.equal(sportsAssessment.sportsLike, true);
  assert.equal(sportsAssessment.streamPreferred, true);
  assert.equal(sportsAssessment.fresh, false);
  assert.equal(nonSportsAssessment.sportsLike, false);
  assert.equal(nonSportsAssessment.maxAgeMs > sportsAssessment.maxAgeMs, true);
  assert.equal(subscriptionRequest.enabled, true);
  assert.deepEqual(subscriptionRequest.assetIds, ['sports-yes', 'sports-no']);
});

test('browsePolymarketMarkets uses gamma events endpoint for tag-id sports discovery', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url || '/');
    const parsed = new URL(req.url || '/', 'http://127.0.0.1');
    const tagId = parsed.searchParams.get('tag_id');

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    if (parsed.pathname !== '/events') {
      res.end(JSON.stringify({ events: [] }));
      return;
    }

    if (tagId === '82') {
      res.end(
        JSON.stringify({
          events: [
            {
              id: 'evt-82',
              slug: 'everton-v-burnley',
              title: 'Everton vs Burnley',
              markets: [
                {
                  condition_id: 'sports-c1',
                  market_slug: 'everton-v-burnley-home',
                  question: 'Will Everton beat Burnley?',
                  end_date_iso: '2030-03-09T16:00:00Z',
                  game_start_time: '2030-03-09T23:00:00Z',
                  active: true,
                  closed: false,
                  volume24hr: 500000,
                  tokens: [
                    { outcome: 'Yes', price: '0.605', token_id: 'yes-sports-1' },
                    { outcome: 'No', price: '0.395', token_id: 'no-sports-1' },
                  ],
                },
              ],
            },
          ],
        }),
      );
      return;
    }

    if (tagId === '100350') {
      res.end(
        JSON.stringify({
          events: [
            {
              id: 'evt-100350',
              slug: 'leeds-v-sunderland',
              title: 'Leeds vs Sunderland',
              markets: [
                {
                  // Duplicate condition id should be deduped across tag-id scans.
                  condition_id: 'sports-c1',
                  market_slug: 'duplicate-market-ignored',
                  question: 'Duplicate row should be ignored',
                  end_date_iso: '2030-03-09T16:00:00Z',
                  active: true,
                  closed: false,
                  volume24hr: 1,
                  tokens: [
                    { outcome: 'Yes', price: '0.5', token_id: 'dup-yes' },
                    { outcome: 'No', price: '0.5', token_id: 'dup-no' },
                  ],
                },
                {
                  condition_id: 'sports-c2',
                  market_slug: 'leeds-v-sunderland-home',
                  question: 'Will Leeds beat Sunderland?',
                  end_date_iso: '2030-03-09T16:00:00Z',
                  active: true,
                  closed: false,
                  volume24hr: 400000,
                  tokens: [
                    { outcome: 'Yes', price: '0.495', token_id: 'yes-sports-2' },
                    { outcome: 'No', price: '0.505', token_id: 'no-sports-2' },
                  ],
                },
              ],
            },
          ],
        }),
      );
      return;
    }

    res.end(JSON.stringify({ events: [] }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const gammaUrl = `http://127.0.0.1:${port}`;

  try {
    const payload = await browsePolymarketMarkets({
      gammaUrl,
      polymarketTagIds: [82, 100350],
      limit: 10,
    });

    assert.equal(payload.source, 'polymarket:gamma-events');
    assert.deepEqual(payload.filters.polymarketTagIds, [82, 100350]);
    assert.equal(payload.count, 2);
    assert.equal(payload.items[0].eventSlug, 'everton-v-burnley');
    assert.equal(payload.items[1].eventSlug, 'leeds-v-sunderland');
    assert.equal(payload.items[0].eventTitle, 'Everton vs Burnley');
    assert.equal(payload.items[0].eventId, 'evt-82');
    assert.equal(
      payload.items[0].closeTimestamp,
      Math.floor(Date.parse('2030-03-09T23:00:00Z') / 1000),
    );

    const eventRequests = requests.filter((entry) => String(entry).startsWith('/events?'));
    assert.equal(eventRequests.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('browsePolymarketMarkets supports category/keyword/date filters with explicit sorting', async () => {
  const nowMs = Date.now();
  const toIso = (offsetHours) => new Date(nowMs + offsetHours * 60 * 60 * 1000).toISOString();

  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url || '/', 'http://127.0.0.1');
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    if (parsed.pathname !== '/markets') {
      res.end(JSON.stringify({ markets: [] }));
      return;
    }

    res.end(
      JSON.stringify({
        markets: [
          {
            condition_id: 'm-sports',
            market_slug: 'everton-v-burnley-home',
            question: 'Will Everton beat Burnley?',
            end_date_iso: toIso(12),
            active: true,
            closed: false,
            volume24hr: 9000,
            liquidity: 9000,
            tags: [{ id: 82, slug: 'soccer' }],
            tokens: [
              { outcome: 'Yes', price: '0.60', token_id: 'sports-yes' },
              { outcome: 'No', price: '0.40', token_id: 'sports-no' },
            ],
          },
          {
            condition_id: 'm-crypto-high-vol',
            market_slug: 'bitcoin-etf-approval-2026',
            question: 'Will Bitcoin ETF approval happen in 2026?',
            end_date_iso: toIso(24),
            active: true,
            closed: false,
            volume24hr: 8000,
            liquidity: 1000,
            tags: [{ slug: 'crypto' }],
            tokens: [
              { outcome: 'Yes', price: '0.45', token_id: 'c1-yes' },
              { outcome: 'No', price: '0.55', token_id: 'c1-no' },
            ],
          },
          {
            condition_id: 'm-crypto-high-liq',
            market_slug: 'bitcoin-price-120k-2026',
            question: 'Will bitcoin trade above 120k in 2026?',
            end_date_iso: toIso(18),
            active: true,
            closed: false,
            volume24hr: 2000,
            liquidity: 7000,
            tags: [{ slug: 'crypto' }],
            tokens: [
              { outcome: 'Yes', price: '0.55', token_id: 'c2-yes' },
              { outcome: 'No', price: '0.45', token_id: 'c2-no' },
            ],
          },
          {
            condition_id: 'm-crypto-extreme',
            market_slug: 'bitcoin-over-300k',
            question: 'Will bitcoin exceed 300k?',
            end_date_iso: toIso(10),
            active: true,
            closed: false,
            volume24hr: 10000,
            liquidity: 1000,
            tags: [{ slug: 'crypto' }],
            tokens: [
              { outcome: 'Yes', price: '0.95', token_id: 'c3-yes' },
              { outcome: 'No', price: '0.05', token_id: 'c3-no' },
            ],
          },
          {
            condition_id: 'm-crypto-far',
            market_slug: 'bitcoin-long-dated',
            question: 'Will bitcoin close above 200k by 2028?',
            end_date_iso: toIso(120),
            active: true,
            closed: false,
            volume24hr: 11000,
            liquidity: 11000,
            tags: [{ slug: 'crypto' }],
            tokens: [
              { outcome: 'Yes', price: '0.50', token_id: 'c4-yes' },
              { outcome: 'No', price: '0.50', token_id: 'c4-no' },
            ],
          },
        ],
      }),
    );
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const gammaUrl = `http://127.0.0.1:${port}`;

  try {
    const byVolume = await browsePolymarketMarkets({
      gammaUrl,
      minYesPct: 15,
      maxYesPct: 85,
      closesBefore: toIso(72),
      keyword: 'bitcoin',
      categories: ['crypto'],
      excludeSports: true,
      sortBy: 'volume24h',
      limit: 10,
    });

    assert.equal(byVolume.count, 2);
    assert.equal(byVolume.items[0].slug, 'bitcoin-etf-approval-2026');
    assert.equal(byVolume.items[1].slug, 'bitcoin-price-120k-2026');
    assert.ok(Array.isArray(byVolume.items[0].categories));
    assert.ok(byVolume.items[0].categories.includes('crypto'));
    assert.equal(byVolume.filters.excludeSports, true);
    assert.deepEqual(byVolume.filters.categories, ['crypto']);
    assert.equal(byVolume.filters.sortBy, 'volume24h');

    const byLiquidity = await browsePolymarketMarkets({
      gammaUrl,
      minYesPct: 15,
      maxYesPct: 85,
      closesBefore: toIso(72),
      keyword: 'bitcoin',
      categories: ['crypto'],
      excludeSports: true,
      sortBy: 'liquidity',
      limit: 10,
    });

    assert.equal(byLiquidity.count, 2);
    assert.equal(byLiquidity.items[0].slug, 'bitcoin-price-120k-2026');
    assert.equal(byLiquidity.items[1].slug, 'bitcoin-etf-approval-2026');
    assert.equal(byLiquidity.filters.sortBy, 'liquidity');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('computeApprovalDiff deterministically marks missing allowance/operator checks', () => {
  const payload = computeApprovalDiff({
    ownerAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    allowanceTargetRaw: 100n,
    allowanceBySpender: {
      exchange: { ok: true, value: 100n },
      negRiskExchange: { ok: true, value: 50n },
      negRiskAdapter: { ok: false, value: null, error: 'read failed' },
    },
    operatorApprovalBySpender: {
      exchange: { ok: true, value: true },
      negRiskExchange: { ok: true, value: false },
      negRiskAdapter: { ok: true, value: true },
    },
  });

  assert.equal(payload.targetAllowanceRaw, '100');
  assert.equal(payload.checks.length, 6);
  assert.equal(payload.missingCount, 3);
  const missingKeys = payload.missingChecks.map((item) => item.key).sort();
  assert.deepEqual(
    missingKeys,
    ['allowance:negRiskAdapter', 'allowance:negRiskExchange', 'operator:negRiskExchange'],
  );
  assert.equal(payload.allSatisfied, false);
});

test('computeApprovalDiff treats near-max approvals above high-water floor as ready', () => {
  const highAllowance = (1n << 128n) + 123n;
  const belowFloorAllowance = (1n << 128n) - 1n;

  const readyPayload = computeApprovalDiff({
    ownerAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    allowanceTargetRaw: (1n << 256n) - 1n,
    allowanceBySpender: {
      exchange: { ok: true, value: highAllowance },
      negRiskExchange: { ok: true, value: highAllowance },
      negRiskAdapter: { ok: true, value: highAllowance },
    },
    operatorApprovalBySpender: {
      exchange: { ok: true, value: true },
      negRiskExchange: { ok: true, value: true },
      negRiskAdapter: { ok: true, value: true },
    },
  });
  assert.equal(readyPayload.allSatisfied, true);
  assert.equal(readyPayload.missingCount, 0);

  const belowFloorPayload = computeApprovalDiff({
    ownerAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    allowanceTargetRaw: (1n << 256n) - 1n,
    allowanceBySpender: {
      exchange: { ok: true, value: belowFloorAllowance },
      negRiskExchange: { ok: true, value: highAllowance },
      negRiskAdapter: { ok: true, value: highAllowance },
    },
    operatorApprovalBySpender: {
      exchange: { ok: true, value: true },
      negRiskExchange: { ok: true, value: true },
      negRiskAdapter: { ok: true, value: true },
    },
  });
  assert.equal(belowFloorPayload.allSatisfied, false);
  assert.equal(
    belowFloorPayload.missingChecks.some((item) => item.key === 'allowance:exchange'),
    true,
  );
});

test('runPolymarketPreflight fails with structured payload when funder is missing', async () => {
  await assert.rejects(
    () =>
      runPolymarketPreflight({
        privateKey: `0x${'1'.repeat(64)}`,
        env: { POLYMARKET_SKIP_API_KEY_SANITY: '1' },
      }),
    (error) => {
      assert.equal(error && error.code, 'POLYMARKET_PREFLIGHT_FAILED');
      assert.equal(Boolean(error && error.details), true);
      assert.equal(Array.isArray(error.details.failedChecks), true);
      assert.equal(error.details.failedChecks.includes('FUNDER_PRESENT'), true);
      return true;
    },
  );
});

test('runPolymarketCheck returns deterministic payload structure without RPC', async () => {
  const payload = await runPolymarketCheck({
    env: { POLYMARKET_SKIP_API_KEY_SANITY: '1' },
  });

  assert.equal(payload.schemaVersion, POLYMARKET_OPS_SCHEMA_VERSION);
  assert.equal(typeof payload.generatedAt, 'string');
  assert.equal(typeof payload.runtime, 'object');
  assert.equal(Array.isArray(payload.runtime.spenders), true);
  assert.equal(payload.runtime.spenders.length, 3);
  assert.equal(typeof payload.ownership, 'object');
  assert.equal(typeof payload.balances, 'object');
  assert.equal(typeof payload.approvals, 'object');
  assert.equal(Array.isArray(payload.approvals.checks), true);
  assert.equal(payload.approvals.checks.length, 6);
  assert.equal(payload.apiKeySanity.status, 'skipped');
});

test('runPolymarketCheck falls back across configured rpc candidates in order', async () => {
  const primaryRpcUrl = 'https://primary-rpc.example';
  const secondaryRpcUrl = 'https://secondary-rpc.example';
  const payload = await runPolymarketCheck(
    {
      rpcUrl: `${primaryRpcUrl},${secondaryRpcUrl}`,
      privateKey: TEST_PRIVATE_KEY,
      funder: TEST_WALLET,
      env: { POLYMARKET_SKIP_API_KEY_SANITY: '1' },
    },
    {
      viemRuntime: buildPolymarketOpsTestViemRuntime({
        signerAddress: TEST_WALLET,
        funderAddress: TEST_WALLET,
        deadRpcUrls: [primaryRpcUrl],
      }),
    },
  );

  assert.equal(payload.chainOk, true);
  assert.equal(payload.chainId, 137);
  assert.equal(payload.runtime.rpcUrl, secondaryRpcUrl);
  assert.equal(payload.rpcSelection.configuredRpcUrl, `${primaryRpcUrl},${secondaryRpcUrl}`);
  assert.deepEqual(payload.rpcSelection.candidateUrls, [primaryRpcUrl, secondaryRpcUrl]);
  assert.equal(payload.rpcSelection.selectedRpcUrl, secondaryRpcUrl);
  assert.equal(payload.rpcSelection.fallbackUsed, true);
  assert.deepEqual(
    payload.rpcSelection.attempts.map((entry) => [entry.order, entry.rpcUrl, entry.ok]),
    [
      [1, primaryRpcUrl, false],
      [2, secondaryRpcUrl, true],
    ],
  );
  assert.equal(
    payload.diagnostics.some((entry) => entry.includes(`RPC fallback used ${secondaryRpcUrl}`)),
    true,
  );
});

test('runPolymarketPreflight reports exhausted rpc candidates when every fallback fails', async () => {
  const primaryRpcUrl = 'https://primary-rpc.example';
  const secondaryRpcUrl = 'https://secondary-rpc.example';

  await assert.rejects(
    () =>
      runPolymarketPreflight(
        {
          rpcUrl: `${primaryRpcUrl},${secondaryRpcUrl}`,
          privateKey: TEST_PRIVATE_KEY,
          funder: TEST_WALLET,
          env: { POLYMARKET_SKIP_API_KEY_SANITY: '1' },
        },
        {
          viemRuntime: buildPolymarketOpsTestViemRuntime({
            signerAddress: TEST_WALLET,
            funderAddress: TEST_WALLET,
            deadRpcUrls: [primaryRpcUrl, secondaryRpcUrl],
          }),
        },
      ),
    (error) => {
      assert.equal(error && error.code, 'POLYMARKET_PREFLIGHT_FAILED');
      assert.deepEqual(error.details.check.rpcSelection.candidateUrls, [primaryRpcUrl, secondaryRpcUrl]);
      assert.equal(error.details.check.rpcSelection.selectedRpcUrl, null);
      assert.deepEqual(
        error.details.check.rpcSelection.attempts.map((entry) => [entry.rpcUrl, entry.ok]),
        [
          [primaryRpcUrl, false],
          [secondaryRpcUrl, false],
        ],
      );
      assert.equal(error.details.failedChecks.includes('RPC_CONNECTED'), true);
      assert.equal(
        error.details.check.diagnostics.some((entry) => entry.includes('configured endpoint(s)')),
        true,
      );
      return true;
    },
  );
});

test('runPolymarketWithdraw dry-run surfaces proxy-manual execution and source shortfall in one payload', async () => {
  const funder = '0x2222222222222222222222222222222222222222';
  const payload = await runPolymarketWithdraw(
    {
      rpcUrl: 'https://polygon-rpc.example',
      privateKey: TEST_PRIVATE_KEY,
      funder,
      amountUsdc: 5,
    },
    {
      viemRuntime: buildPolymarketOpsTestViemRuntime({
        signerAddress: TEST_WALLET,
        funderAddress: funder,
        usdcBalanceRaw: 2_000_000n,
      }),
    },
  );

  assert.equal(payload.action, 'withdraw');
  assert.equal(payload.mode, 'dry-run');
  assert.equal(payload.fromAddress, funder);
  assert.equal(payload.toAddress, TEST_WALLET);
  assert.equal(payload.preflight.manualProxyActionRequired, true);
  assert.equal(payload.preflight.executeSupported, false);
  assert.equal(payload.preflight.sourceBalanceSufficient, false);
  assert.equal(payload.preflight.sourceBalanceAfterRaw, '-3000000');
  assert.equal(payload.preflight.sourceBalanceAfter, '-3');
  assert.equal(
    payload.diagnostics.some((entry) => entry.includes('proxy-originated transfer requires manual execution')),
    true,
  );
});

test('discoverOwnedMarkets groups token, LP, and claimable exposure into operator market summaries', async () => {
  const marketToken = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const marketLp = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const marketClaim = '0xcccccccccccccccccccccccccccccccccccccccc';
  const pollToken = '0x1111111111111111111111111111111111111111';
  const pollLp = '0x2222222222222222222222222222222222222222';
  const pollClaim = '0x3333333333333333333333333333333333333333';
  const indexer = await startUnitIndexerMetadataServer({
    markets: {
      [marketToken]: { id: marketToken, chainId: 1, pollAddress: pollToken, marketType: 'amm', marketCloseTimestamp: '1893456000' },
      [marketLp]: { id: marketLp, chainId: 1, pollAddress: pollLp, marketType: 'amm', marketCloseTimestamp: '1893456000' },
      [marketClaim]: { id: marketClaim, chainId: 1, pollAddress: pollClaim, marketType: 'amm', marketCloseTimestamp: '1893456000' },
    },
    polls: {
      [pollToken]: { id: pollToken, question: 'Alpha token exposure' },
      [pollLp]: { id: pollLp, question: 'Bravo LP exposure' },
      [pollClaim]: { id: pollClaim, question: 'Charlie claim exposure' },
    },
  });

  try {
    const payload = await discoverOwnedMarkets(
      {
        wallet: TEST_WALLET,
        chainId: 1,
        indexerUrl: indexer.url,
        timeoutMs: 1000,
      },
      {
        collectPortfolioSnapshot: async () => ({
          positions: [
            {
              marketAddress: marketToken,
              chainId: 1,
              positionSide: 'yes',
              yesBalance: 3,
              noBalance: 0,
              markValueUsdc: 2.1,
              question: 'Alpha token exposure',
              diagnostics: ['Token exposure came from the position snapshot.'],
            },
          ],
          lpPositions: [
            {
              marketAddress: marketLp,
              lpTokenBalanceRaw: '1200000',
              lpTokenBalance: '1.2',
              lpTokenDecimals: 6,
              preview: { collateralOutUsdc: 14 },
              outcomeTokens: {
                hasClaimableInventory: true,
                claimableAmount: '2.5',
                claimableAmountRaw: '2500000',
                claimableUsdc: '2.5',
              },
              diagnostics: ['LP preview came from cached reserves.'],
            },
          ],
          diagnostics: ['Portfolio snapshot loaded without signer credentials.'],
        }),
        runClaim: async () => ({
          count: 2,
          successCount: 2,
          failureCount: 0,
          diagnostics: ['Claim scan completed.'],
          items: [
            {
              marketAddress: marketLp,
              ok: true,
              result: {
                claimable: true,
                pollAddress: pollLp,
                preflight: {
                  estimatedClaimRaw: '2500000',
                },
                resolution: {
                  pollFinalized: true,
                  pollAnswer: 'Yes',
                  finalizationEpoch: 1700000000,
                  currentEpoch: 1700000600,
                },
                diagnostics: ['LP claim estimate derived from outcome inventory.'],
              },
            },
            {
              marketAddress: marketClaim,
              ok: true,
              result: {
                claimable: true,
                pollAddress: pollClaim,
                preflight: {
                  estimatedClaimRaw: '3500000',
                },
                resolution: {
                  pollFinalized: true,
                  pollAnswer: 'Yes',
                  finalizationEpoch: 1700000000,
                  currentEpoch: 1700000600,
                },
                diagnostics: ['Claim estimate derived from outcome balances.'],
              },
            },
          ],
        }),
      },
    );

    assert.equal(payload.wallet, TEST_WALLET);
    assert.equal(payload.walletSource, 'flag');
    assert.equal(payload.runtime.signerResolved, false);
    assert.equal(payload.count, 3);
    assert.deepEqual(payload.exposureCounts, {
      token: 1,
      lp: 1,
      claimable: 2,
    });
    assert.deepEqual(
      payload.items.map((item) => item.question),
      ['Alpha token exposure', 'Bravo LP exposure', 'Charlie claim exposure'],
    );

    const lpItem = payload.items.find((item) => item.marketAddress === marketLp);
    const claimItem = payload.items.find((item) => item.marketAddress === marketClaim);

    assert.deepEqual(lpItem.exposureTypes, ['lp', 'claimable']);
    assert.equal(lpItem.exposure.lp.estimatedCollateralOutUsdc, 14);
    assert.equal(lpItem.exposure.lp.outcomeTokens.claimableUsdc, '2.5');
    assert.deepEqual(claimItem.exposureTypes, ['claimable']);
    assert.equal(claimItem.exposure.claimable.estimatedClaimUsdc, '3.5');
    assert.equal(claimItem.exposure.claimable.pollFinalized, true);
    assert.equal(
      payload.diagnostics.includes(
        'Claimable exposure inference is best-effort without signer credentials; estimated claim amounts may be unavailable.',
      ),
      true,
    );
  } finally {
    await indexer.close();
  }
});

test('mirror sync live execution normalizes rebalance trades before onchain execution', async () => {
  const captured = {
    callOrder: [],
  };
  const quotePayload = {
    quoteAvailable: true,
    odds: { yesPct: 54, noPct: 46 },
    estimate: { estimatedShares: 46.296296, minSharesOut: 45.601852 },
  };
  let emittedPayload = null;

  await handleMirrorSync({
    shared: {
      rest: ['once'],
      timeoutMs: 1000,
    },
    context: {
      outputMode: 'json',
    },
    deps: {
      CliError: ParserCliError,
      includesHelpFlag: () => false,
      emitSuccess: (_mode, _command, payload) => {
        emittedPayload = payload;
      },
      maybeLoadTradeEnv: () => {},
      resolveIndexerUrl: (value) => value || 'https://indexer.example/graphql',
      parseMirrorSyncDaemonSelectorFlags: () => {
        throw new Error('selector flags should not be read for once mode');
      },
      stopMirrorDaemon: async () => {
        throw new Error('stopMirrorDaemon should not run for once mode');
      },
      mirrorDaemonStatus: () => {
        throw new Error('mirrorDaemonStatus should not run for once mode');
      },
      parseMirrorSyncFlags: () => ({
        mode: 'once',
        stream: false,
        daemon: false,
        executeLive: true,
        trustDeploy: false,
        pandoraMarketAddress: TEST_MARKET,
        polymarketMarketId: 'poly-cond-1',
        polymarketSlug: null,
        chainId: 1,
        rpcUrl: 'https://rpc.example',
        fork: false,
        forkRpcUrl: null,
        forkChainId: null,
        privateKey: TEST_PRIVATE_KEY,
        profileId: null,
        profileFile: null,
        usdc: TEST_USDC,
        failOnWebhookError: false,
      }),
      buildMirrorSyncStrategy: () => ({}),
      mirrorStrategyHash: () => 'strategy-hash',
      buildMirrorSyncDaemonCliArgs: () => [],
      startMirrorDaemon: async () => {
        throw new Error('startMirrorDaemon should not run for once mode');
      },
      resolveTrustedDeployPair: () => {
        throw new Error('resolveTrustedDeployPair should not run without trustDeploy');
      },
      selectHealthyPolymarketRpc: async () => ({
        selectedRpcUrl: 'https://polygon-rpc.example',
        fallbackUsed: false,
        attempts: [{ rpcUrl: 'https://polygon-rpc.example', ok: true, order: 1, chainId: 137 }],
        diagnostics: [],
      }),
      runLivePolymarketPreflightForMirror: async () => ({ ok: true }),
      runMirrorSync: async (_options, runtimeDeps) => {
        const result = await runtimeDeps.rebalanceFn({
          marketAddress: TEST_MARKET,
          side: 'yes',
          amountUsdc: 25,
        });
        captured.rebalanceResult = result;
        return {
          mode: 'once',
          strategyHash: 'strategy-hash',
          actionCount: 1,
          actions: [{ status: 'executed', rebalance: { result } }],
          snapshots: [],
          diagnostics: [],
          state: { tradesToday: 1, idempotencyKeys: [] },
        };
      },
      buildQuotePayload: async (_indexerUrl, tradeOptions) => {
        captured.callOrder.push('quote');
        captured.quoteTradeOptions = tradeOptions;
        return quotePayload;
      },
      enforceTradeRiskGuards: (tradeOptions, quote) => {
        captured.callOrder.push('guard');
        captured.guardTradeOptions = tradeOptions;
        captured.guardQuote = quote;
      },
      executeTradeOnchain: async (tradeOptions) => {
        captured.callOrder.push('execute');
        captured.executionTradeOptions = tradeOptions;
        return {
          ok: true,
          marketType: 'amm',
          tradeSignature: 'buy(bool,uint256,uint256,uint256)',
          ammDeadlineEpoch: '1710000900',
        };
      },
      assertLiveWriteAllowed: async () => {},
      hasWebhookTargets: () => false,
      sendWebhookNotifications: async () => ({ failureCount: 0 }),
      coerceMirrorServiceError: (error) => error,
      renderMirrorSyncTickLine: () => {},
      renderMirrorSyncDaemonTable: () => {},
      renderMirrorSyncTable: () => {},
      cliPath: '/Users/mac/Desktop/pandora-market-setup-shareable/cli/pandora.cjs',
    },
    mirrorSyncUsage: 'pandora mirror sync once|run|start|stop|status ...',
  });

  assert.deepEqual(captured.callOrder, ['quote', 'guard', 'execute']);
  assert.equal(captured.guardTradeOptions, captured.executionTradeOptions);
  assert.equal(captured.quoteTradeOptions, captured.executionTradeOptions);
  assert.equal(captured.executionTradeOptions.mode, 'buy');
  assert.equal(captured.executionTradeOptions.amount, null);
  assert.equal(captured.executionTradeOptions.minAmountOutRaw, null);
  assert.equal(captured.executionTradeOptions.allowUnquotedExecute, true);
  assert.equal(captured.executionTradeOptions.maxAmountUsdc, 25);
  assert.equal(captured.executionTradeOptions.fork, false);
  assert.equal(captured.executionTradeOptions.forkRpcUrl, null);
  assert.equal(captured.executionTradeOptions.forkChainId, null);
  assert.equal(captured.executionTradeOptions.deadlineSeconds, 900);
  assert.equal(captured.guardQuote, quotePayload);
  assert.equal(captured.rebalanceResult.quote, quotePayload);
  assert.equal(captured.rebalanceResult.ammDeadlineEpoch, '1710000900');
  assert.equal(emittedPayload.actions[0].rebalance.result.quote, quotePayload);
});

test('mirror go auto-sync live execution reuses normalized rebalance trade shape', async () => {
  const captured = {
    callOrder: [],
  };
  const quotePayload = {
    quoteAvailable: true,
    odds: { yesPct: 61, noPct: 39 },
    estimate: { estimatedShares: 24.590164, minSharesOut: 24.221311 },
  };
  let emittedPayload = null;

  await handleMirrorGo({
    shared: {
      rest: [],
      timeoutMs: 1000,
    },
    context: {
      outputMode: 'json',
    },
    deps: {
      CliError: ParserCliError,
      includesHelpFlag: () => false,
      emitSuccess: (_mode, _command, payload) => {
        emittedPayload = payload;
      },
      commandHelpPayload: () => ({}),
      maybeLoadTradeEnv: () => {},
      resolveIndexerUrl: (value) => value || 'https://indexer.example/graphql',
      parseMirrorGoFlags: () => ({
        executeLive: true,
        autoSync: true,
        syncOnce: true,
        noHedge: true,
        hedgeRatio: 1,
        syncIntervalMs: 1000,
        driftTriggerBps: 25,
        hedgeTriggerUsdc: 10,
        maxRebalanceUsdc: 50,
        maxHedgeUsdc: 20,
        maxOpenExposureUsdc: 100,
        maxTradesPerDay: 10,
        cooldownMs: 1000,
        chainId: 1,
        rpcUrl: 'https://rpc.example',
        polymarketRpcUrl: null,
        privateKey: TEST_PRIVATE_KEY,
        profileId: null,
        profileFile: null,
        funder: '0x2222222222222222222222222222222222222222',
        usdc: TEST_USDC,
        polymarketHost: 'https://clob.polymarket.com',
        polymarketGammaUrl: null,
        polymarketGammaMockUrl: null,
        polymarketMockUrl: 'https://polymarket.example/mock',
        forceGate: false,
        skipGateChecks: [],
        trustDeploy: false,
        liquidityUsdc: 100,
        polymarketMarketId: 'poly-cond-1',
        polymarketSlug: null,
        manifestFile: null,
        withRules: false,
        includeSimilarity: false,
        fork: false,
        forkRpcUrl: null,
        forkChainId: null,
      }),
      buildMirrorPlan: async () => ({
        sourceMarket: {
          marketId: 'poly-cond-1',
          slug: 'poly-slug',
        },
      }),
      deployMirror: async () => ({
        pandora: {
          marketAddress: TEST_MARKET,
          pollAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      }),
      resolveTrustedDeployPair: () => {
        throw new Error('resolveTrustedDeployPair should not run without trustDeploy');
      },
      findMirrorPair: () => null,
      defaultMirrorManifestFile: () => null,
      hasContractCodeAtAddress: async () => true,
      verifyMirror: async () => ({
        pandora: { marketAddress: TEST_MARKET },
        sourceMarket: { marketId: 'poly-cond-1', slug: 'poly-slug' },
      }),
      selectHealthyPolymarketRpc: async () => ({
        selectedRpcUrl: 'https://polygon-rpc.example',
        fallbackUsed: false,
        attempts: [{ rpcUrl: 'https://polygon-rpc.example', ok: true, order: 1, chainId: 137 }],
        diagnostics: [],
      }),
      runLivePolymarketPreflightForMirror: async () => ({ ok: true }),
      runMirrorSync: async (_options, runtimeDeps) => {
        const result = await runtimeDeps.rebalanceFn({
          marketAddress: TEST_MARKET,
          side: 'no',
          amountUsdc: 15,
        });
        captured.rebalanceResult = result;
        return {
          mode: 'once',
          strategyHash: 'go-sync-hash',
          actionCount: 1,
          actions: [{ status: 'executed', rebalance: { result } }],
          snapshots: [],
          diagnostics: [],
          state: { tradesToday: 1, idempotencyKeys: [] },
        };
      },
      buildQuotePayload: async (_indexerUrl, tradeOptions) => {
        captured.callOrder.push('quote');
        captured.quoteTradeOptions = tradeOptions;
        return quotePayload;
      },
      enforceTradeRiskGuards: (tradeOptions, quote) => {
        captured.callOrder.push('guard');
        captured.guardTradeOptions = tradeOptions;
        captured.guardQuote = quote;
      },
      executeTradeOnchain: async (tradeOptions) => {
        captured.callOrder.push('execute');
        captured.executionTradeOptions = tradeOptions;
        return {
          ok: true,
          marketType: 'amm',
          tradeSignature: 'buy(bool,uint256,uint256,uint256)',
          ammDeadlineEpoch: '1710000905',
        };
      },
      assertLiveWriteAllowed: async () => {},
      renderMirrorSyncTickLine: () => {},
      coerceMirrorServiceError: (error) => error,
      renderMirrorGoTable: () => {},
    },
    mirrorGoUsage: 'pandora mirror go ...',
  });

  assert.deepEqual(captured.callOrder, ['quote', 'guard', 'execute']);
  assert.equal(captured.guardTradeOptions, captured.executionTradeOptions);
  assert.equal(captured.quoteTradeOptions, captured.executionTradeOptions);
  assert.equal(captured.executionTradeOptions.mode, 'buy');
  assert.equal(captured.executionTradeOptions.amount, null);
  assert.equal(captured.executionTradeOptions.minAmountOutRaw, null);
  assert.equal(captured.executionTradeOptions.allowUnquotedExecute, true);
  assert.equal(captured.executionTradeOptions.maxAmountUsdc, 15);
  assert.equal(captured.executionTradeOptions.fork, false);
  assert.equal(captured.executionTradeOptions.forkRpcUrl, null);
  assert.equal(captured.executionTradeOptions.forkChainId, null);
  assert.equal(captured.executionTradeOptions.deadlineSeconds, 900);
  assert.equal(captured.guardQuote, quotePayload);
  assert.equal(captured.rebalanceResult.quote, quotePayload);
  assert.equal(captured.rebalanceResult.ammDeadlineEpoch, '1710000905');
  assert.equal(emittedPayload.sync.actions[0].rebalance.result.quote, quotePayload);
});

test('runMirrorSync live mode prioritizes CLI hedge credentials over env defaults', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-live-creds-'));
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killSwitchFile = path.join(tempDir, 'STOP');
  const privateKey = `0x${'1'.repeat(64)}`;
  const funder = '0x2222222222222222222222222222222222222222';
  let capturedHedgeOptions = null;

  try {
    const payload = await runMirrorSync(
      {
        mode: 'once',
        indexerUrl: 'https://example.invalid/graphql',
        timeoutMs: 1000,
        pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        polymarketMarketId: 'poly-cond-1',
        polymarketSlug: null,
        executeLive: true,
        trustDeploy: false,
        hedgeEnabled: true,
        hedgeRatio: 1,
        intervalMs: 5000,
        driftTriggerBps: 150,
        hedgeTriggerUsdc: 1,
        maxRebalanceUsdc: 25,
        maxHedgeUsdc: 10,
        maxOpenExposureUsdc: 100,
        maxTradesPerDay: 10,
        cooldownMs: 1000,
        depthSlippageBps: 100,
        stateFile,
        killSwitchFile,
        rpcUrl: 'https://rpc.example',
        polymarketRpcUrl: 'https://primary-rpc.example,https://secondary-rpc.example',
        polymarketHost: 'https://clob.polymarket.com',
        polymarketMockUrl: null,
        privateKey,
        funder,
      },
      {
        verifyFn: async () => ({
          matchConfidence: 0.99,
          gateResult: {
            ok: true,
            failedChecks: [],
            checks: [{ code: 'CLOSE_TIME_DELTA', ok: true, meta: { closeDeltaHours: 0 } }],
          },
          sourceMarket: {
            source: 'polymarket',
            marketId: 'poly-cond-1',
            yesPct: 40,
            yesTokenId: 'yes-token',
            noTokenId: 'no-token',
            sourceFreshness: {
              observedAt: new Date().toISOString(),
            },
          },
          pandora: {
            yesPct: 40,
            reserveYes: 2,
            reserveNo: 8,
          },
          expiry: {
            minTimeToExpirySec: 7200,
          },
        }),
        depthFn: async () => ({
          depthWithinSlippageUsd: 1000,
          yesDepth: { midPrice: 0.4, worstPrice: 0.41 },
          noDepth: { midPrice: 0.6, worstPrice: 0.61 },
        }),
        readPandoraReserveContext: async () => ({
          source: 'onchain:outcome-token-balances',
          reserveYesUsdc: 2,
          reserveNoUsdc: 8,
          pandoraYesPct: 40,
          feeTier: 3000,
          readAt: '2026-03-01T10:00:00.000Z',
        }),
        hedgeFn: async (options) => {
          capturedHedgeOptions = options;
          return {
            ok: true,
            response: { status: 'simulated-post' },
          };
        },
        rebalanceFn: async () => ({ ok: true }),
      },
    );

    assert.equal(payload.actionCount, 1);
    assert.equal(payload.actions[0].status, 'executed');
    assert.equal(Boolean(capturedHedgeOptions), true);
    assert.equal(capturedHedgeOptions.rpcUrl, 'https://primary-rpc.example,https://secondary-rpc.example');
    assert.equal(capturedHedgeOptions.privateKey, privateKey);
    assert.equal(capturedHedgeOptions.funder, funder);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync paper mode uses on-chain reserves for atomic rebalance planning', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-onchain-paper-'));
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killSwitchFile = path.join(tempDir, 'STOP');

  try {
    const payload = await runMirrorSync(
      {
        mode: 'once',
        indexerUrl: 'https://example.invalid/graphql',
        timeoutMs: 1000,
        pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        polymarketMarketId: 'poly-cond-1',
        polymarketSlug: null,
        executeLive: false,
        trustDeploy: false,
        hedgeEnabled: false,
        hedgeRatio: 1,
        intervalMs: 5000,
        driftTriggerBps: 150,
        hedgeTriggerUsdc: 10_000,
        maxRebalanceUsdc: 40,
        maxHedgeUsdc: 10,
        maxOpenExposureUsdc: 100,
        maxTradesPerDay: 10,
        cooldownMs: 1000,
        depthSlippageBps: 100,
        stateFile,
        killSwitchFile,
        rpcUrl: 'https://rpc.example',
        polymarketHost: 'https://clob.polymarket.com',
      },
      {
        verifyFn: async () => ({
          matchConfidence: 0.99,
          gateResult: {
            ok: true,
            failedChecks: [],
            checks: [{ code: 'CLOSE_TIME_DELTA', ok: true, meta: { closeDeltaHours: 0 } }],
          },
          sourceMarket: {
            source: 'polymarket',
            marketId: 'poly-cond-1',
            yesPct: 60,
            yesTokenId: 'yes-token',
            noTokenId: 'no-token',
          },
          pandora: {
            yesPct: 60,
            reserveYes: 5,
            reserveNo: 5,
          },
          expiry: { minTimeToExpirySec: 7200 },
        }),
        readPandoraReserveContext: async () => ({
          source: 'onchain:outcome-token-balances',
          reserveYesUsdc: 8,
          reserveNoUsdc: 2,
          pandoraYesPct: 20,
          feeTier: 3000,
          readAt: '2026-03-01T10:00:00.000Z',
        }),
        depthFn: async () => ({
          depthWithinSlippageUsd: 1000,
          yesDepth: { depthUsd: 1000, midPrice: 0.4, worstPrice: 0.41 },
          noDepth: { depthUsd: 1000, midPrice: 0.6, worstPrice: 0.61 },
        }),
      },
    );

    assert.equal(payload.actionCount, 1);
    assert.equal(payload.actions[0].status, 'simulated');
    assert.equal(payload.snapshots[0].metrics.reserveSource, 'onchain:outcome-token-balances');
    assert.equal(payload.snapshots[0].metrics.reserveYesUsdc, 8);
    assert.equal(payload.snapshots[0].metrics.reserveNoUsdc, 2);
    assert.equal(payload.snapshots[0].metrics.reserveReadAt, '2026-03-01T10:00:00.000Z');
    assert.equal(payload.snapshots[0].metrics.pandoraYesPct, 20);
    assert.equal(payload.snapshots[0].metrics.driftTriggered, true);
    assert.equal(payload.snapshots[0].metrics.plannedRebalanceUsdc > 0, true);
    assert.equal(payload.actions[0].rebalance.amountUsdc > 0, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync live mode executes rebalance from on-chain reserve drift, not verify payload reserves', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-onchain-live-'));
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killSwitchFile = path.join(tempDir, 'STOP');
  let capturedRebalance = null;

  try {
    const payload = await runMirrorSync(
      {
        mode: 'once',
        indexerUrl: 'https://example.invalid/graphql',
        timeoutMs: 1000,
        pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        polymarketMarketId: 'poly-cond-1',
        polymarketSlug: null,
        executeLive: true,
        trustDeploy: false,
        hedgeEnabled: false,
        hedgeRatio: 1,
        intervalMs: 5000,
        driftTriggerBps: 150,
        hedgeTriggerUsdc: 10_000,
        maxRebalanceUsdc: 40,
        maxHedgeUsdc: 10,
        maxOpenExposureUsdc: 100,
        maxTradesPerDay: 10,
        cooldownMs: 1000,
        depthSlippageBps: 100,
        stateFile,
        killSwitchFile,
        rpcUrl: 'https://rpc.example',
        polymarketHost: 'https://clob.polymarket.com',
      },
      {
        verifyFn: async () => ({
          matchConfidence: 0.99,
          gateResult: {
            ok: true,
            failedChecks: [],
            checks: [{ code: 'CLOSE_TIME_DELTA', ok: true, meta: { closeDeltaHours: 0 } }],
          },
          sourceMarket: {
            source: 'polymarket',
            marketId: 'poly-cond-1',
            yesPct: 60,
            yesTokenId: 'yes-token',
            noTokenId: 'no-token',
          },
          pandora: {
            yesPct: 60,
            reserveYes: 5,
            reserveNo: 5,
          },
          expiry: { minTimeToExpirySec: 7200 },
        }),
        readPandoraReserveContext: async () => ({
          source: 'onchain:outcome-token-balances',
          reserveYesUsdc: 8,
          reserveNoUsdc: 2,
          pandoraYesPct: 20,
          feeTier: 3000,
          readAt: '2026-03-01T10:00:00.000Z',
        }),
        depthFn: async () => ({
          depthWithinSlippageUsd: 1000,
          yesDepth: { depthUsd: 1000, midPrice: 0.4, worstPrice: 0.41 },
          noDepth: { depthUsd: 1000, midPrice: 0.6, worstPrice: 0.61 },
        }),
        rebalanceFn: async (executionOptions) => {
          capturedRebalance = executionOptions;
          return { ok: true, txHash: '0xrebalance' };
        },
      },
    );

    assert.equal(payload.actionCount, 1);
    assert.equal(payload.actions[0].status, 'executed');
    assert.equal(payload.snapshots[0].metrics.reserveSource, 'onchain:outcome-token-balances');
    assert.equal(payload.snapshots[0].metrics.driftTriggered, true);
    assert.equal(Boolean(capturedRebalance), true);
    assert.equal(capturedRebalance.amountUsdc > 0, true);
    assert.equal(payload.actions[0].rebalance.amountUsdc, capturedRebalance.amountUsdc);
    assert.equal(payload.actions[0].rebalance.result.txHash, '0xrebalance');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync live mode fails closed when on-chain reserve refresh is unavailable', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-onchain-fail-'));
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killSwitchFile = path.join(tempDir, 'STOP');

  try {
    await assert.rejects(
      () =>
        runMirrorSync(
          {
            mode: 'once',
            indexerUrl: 'https://example.invalid/graphql',
            timeoutMs: 1000,
            pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            polymarketMarketId: 'poly-cond-1',
            executeLive: true,
            trustDeploy: false,
            hedgeEnabled: false,
            hedgeRatio: 1,
            intervalMs: 5000,
            driftTriggerBps: 150,
            hedgeTriggerUsdc: 10_000,
            maxRebalanceUsdc: 40,
            maxHedgeUsdc: 10,
            maxOpenExposureUsdc: 100,
            maxTradesPerDay: 10,
            cooldownMs: 1000,
            depthSlippageBps: 100,
            stateFile,
            killSwitchFile,
            rpcUrl: 'https://rpc.example',
            polymarketHost: 'https://clob.polymarket.com',
            priceSource: 'on-chain',
          },
          {
            verifyFn: async () => ({
              matchConfidence: 0.99,
              gateResult: { ok: true, failedChecks: [], checks: [] },
              sourceMarket: { source: 'polymarket:gamma', marketId: 'poly-cond-1', yesPct: 60 },
              pandora: { yesPct: 60, reserveYes: 5, reserveNo: 5 },
              expiry: { minTimeToExpirySec: 7200, pandoraTimeToExpirySec: 7200 },
            }),
            readPandoraReserveContext: async () => {
              throw new Error('rpc timeout');
            },
            rebalanceFn: async () => ({ ok: true, txHash: '0xrebalance' }),
          },
        ),
      (err) => {
        assert.equal(err.code, 'MIRROR_ONCHAIN_RESERVES_UNAVAILABLE');
        assert.match(err.message, /could not read Pandora reserves on-chain/i);
        return true;
      },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync live mode blocks stale polled sports source data before executing', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-stale-source-'));
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killSwitchFile = path.join(tempDir, 'STOP');
  let executed = false;

  try {
    const payload = await runMirrorSync(
      {
        mode: 'once',
        indexerUrl: 'https://example.invalid/graphql',
        timeoutMs: 1000,
        pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        polymarketMarketId: 'poly-cond-1',
        executeLive: true,
        trustDeploy: false,
        hedgeEnabled: false,
        hedgeRatio: 1,
        intervalMs: 5_000,
        driftTriggerBps: 150,
        hedgeTriggerUsdc: 10_000,
        maxRebalanceUsdc: 40,
        maxHedgeUsdc: 10,
        maxOpenExposureUsdc: 100,
        maxTradesPerDay: 10,
        cooldownMs: 1000,
        depthSlippageBps: 100,
        stateFile,
        killSwitchFile,
        rpcUrl: 'https://rpc.example',
        polymarketHost: 'https://clob.polymarket.com',
        priceSource: 'indexer',
      },
      {
        verifyFn: async () => ({
          matchConfidence: 0.99,
          gateResult: { ok: true, failedChecks: [], checks: [] },
          sourceMarket: {
            source: 'polymarket:gamma',
            marketId: 'poly-cond-1',
            yesPct: 60,
            yesTokenId: 'yes-token',
            noTokenId: 'no-token',
            timestampSource: 'game_start_time',
            eventStartTimestamp: Math.floor(Date.parse('2030-03-09T23:00:00Z') / 1000),
            sourceCloseTimestamp: Math.floor(Date.parse('2030-03-09T00:00:00Z') / 1000),
            sourceFreshness: {
              transport: 'poll',
              observedAt: new Date(Date.now() - 20_000).toISOString(),
            },
          },
          pandora: { yesPct: 20, reserveYes: 8, reserveNo: 2 },
          expiry: {
            minTimeToExpirySec: 7200,
            pandoraTimeToExpirySec: 7200,
            sourceTimeToExpirySec: 7200,
          },
        }),
        depthFn: async () => ({
          depthWithinSlippageUsd: 1000,
          yesDepth: { depthUsd: 1000, midPrice: 0.4, worstPrice: 0.41 },
          noDepth: { depthUsd: 1000, midPrice: 0.6, worstPrice: 0.61 },
        }),
        rebalanceFn: async () => {
          executed = true;
          return { ok: true, txHash: '0xrebalance' };
        },
      },
    );

    assert.equal(executed, false);
    assert.equal(payload.actionCount, 0);
    assert.equal(payload.actions.length, 0);
    assert.equal(payload.snapshots[0].action.status, 'blocked');
    assert.equal(payload.snapshots[0].action.failedChecks.includes('POLYMARKET_SOURCE_FRESH'), true);
    const freshnessCheck = payload.snapshots[0].strictGate.checks.find((check) => check.code === 'POLYMARKET_SOURCE_FRESH');
    assert.equal(Boolean(freshnessCheck), true);
    assert.equal(freshnessCheck.ok, false);
    assert.equal(freshnessCheck.details.freshness.streamPreferred, true);
    assert.equal(freshnessCheck.details.freshness.transport, 'poll');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync live mode blocks fresh polled sports source data when stream transport is still required', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-stream-required-'));
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killSwitchFile = path.join(tempDir, 'STOP');
  let executed = false;

  try {
    const payload = await runMirrorSync(
      {
        mode: 'once',
        indexerUrl: 'https://example.invalid/graphql',
        timeoutMs: 1000,
        pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        polymarketMarketId: 'poly-cond-1',
        executeLive: true,
        trustDeploy: false,
        hedgeEnabled: false,
        hedgeRatio: 1,
        intervalMs: 5_000,
        driftTriggerBps: 150,
        hedgeTriggerUsdc: 10_000,
        maxRebalanceUsdc: 40,
        maxHedgeUsdc: 10,
        maxOpenExposureUsdc: 100,
        maxTradesPerDay: 10,
        cooldownMs: 1000,
        depthSlippageBps: 100,
        stateFile,
        killSwitchFile,
        rpcUrl: 'https://rpc.example',
        polymarketHost: 'https://clob.polymarket.com',
        priceSource: 'indexer',
      },
      {
        verifyFn: async () => ({
          matchConfidence: 0.99,
          gateResult: { ok: true, failedChecks: [], checks: [] },
          sourceMarket: {
            source: 'polymarket:gamma',
            marketId: 'poly-cond-1',
            yesPct: 60,
            yesTokenId: 'yes-token',
            noTokenId: 'no-token',
            timestampSource: 'game_start_time',
            eventStartTimestamp: Math.floor(Date.parse('2030-03-09T23:00:00Z') / 1000),
            sourceCloseTimestamp: Math.floor(Date.parse('2030-03-09T00:00:00Z') / 1000),
            sourceFreshness: {
              transport: 'poll',
              observedAt: new Date(Date.now() - 5_000).toISOString(),
            },
          },
          pandora: { yesPct: 20, reserveYes: 8, reserveNo: 2 },
          expiry: {
            minTimeToExpirySec: 7200,
            pandoraTimeToExpirySec: 7200,
            sourceTimeToExpirySec: 7200,
          },
        }),
        depthFn: async () => ({
          depthWithinSlippageUsd: 1000,
          yesDepth: { depthUsd: 1000, midPrice: 0.4, worstPrice: 0.41 },
          noDepth: { depthUsd: 1000, midPrice: 0.6, worstPrice: 0.61 },
        }),
        rebalanceFn: async () => {
          executed = true;
          return { ok: true, txHash: '0xrebalance' };
        },
      },
    );

    assert.equal(executed, false);
    assert.equal(payload.actionCount, 0);
    assert.equal(payload.snapshots[0].action.status, 'blocked');
    assert.equal(payload.snapshots[0].action.failedChecks.includes('POLYMARKET_SOURCE_FRESH'), true);
    const freshnessCheck = payload.snapshots[0].strictGate.checks.find((check) => check.code === 'POLYMARKET_SOURCE_FRESH');
    assert.equal(Boolean(freshnessCheck), true);
    assert.equal(freshnessCheck.ok, false);
    assert.equal(freshnessCheck.details.freshness.fresh, true);
    assert.equal(freshnessCheck.details.freshness.reason, 'stream-recommended-for-short-interval-sports');
    assert.equal(freshnessCheck.details.requiresStream, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync leaves tradesToday unchanged when no sync legs are planned', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-no-exec-'));
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killSwitchFile = path.join(tempDir, 'STOP');

  try {
    const payload = await runMirrorSync(
      {
        mode: 'once',
        indexerUrl: 'https://example.invalid/graphql',
        timeoutMs: 1000,
        pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        polymarketMarketId: 'poly-cond-1',
        executeLive: true,
        trustDeploy: false,
        hedgeEnabled: false,
        hedgeRatio: 1,
        intervalMs: 5000,
        driftTriggerBps: 150,
        hedgeTriggerUsdc: 1,
        maxRebalanceUsdc: 25,
        maxHedgeUsdc: 10,
        maxOpenExposureUsdc: 100,
        maxTradesPerDay: 10,
        cooldownMs: 1000,
        depthSlippageBps: 100,
        stateFile,
        killSwitchFile,
        rpcUrl: 'https://rpc.example',
        polymarketHost: 'https://clob.polymarket.com',
        privateKey: `0x${'1'.repeat(64)}`,
        funder: '0x2222222222222222222222222222222222222222',
      },
      {
        verifyFn: async () => ({
          matchConfidence: 0.99,
          gateResult: {
            ok: true,
            failedChecks: [],
            checks: [{ code: 'CLOSE_TIME_DELTA', ok: true, meta: { closeDeltaHours: 0 } }],
          },
          sourceMarket: {
            source: 'polymarket',
            marketId: 'poly-cond-1',
            yesPct: 80,
            yesTokenId: 'yes-token',
            noTokenId: 'no-token',
            sourceFreshness: {
              transport: 'poll',
              observedAt: new Date().toISOString(),
            },
          },
          pandora: {
            yesPct: 80,
            reserveYes: 2,
            reserveNo: 8,
          },
          expiry: { minTimeToExpirySec: 7200 },
        }),
        depthFn: async () => ({
          depthWithinSlippageUsd: 1000,
          yesDepth: { midPrice: 0.4, worstPrice: 0.41 },
          noDepth: { midPrice: 0.6, worstPrice: 0.61 },
        }),
        readPandoraReserveContext: async () => ({
          source: 'onchain:outcome-token-balances',
          reserveYesUsdc: 2,
          reserveNoUsdc: 8,
          pandoraYesPct: 80,
          feeTier: 3000,
          readAt: '2026-03-01T10:00:00.000Z',
        }),
        rebalanceFn: async () => ({ ok: true }),
      },
    );

    assert.equal(payload.actionCount, 0);
    assert.equal(payload.state.tradesToday, 0);
    assert.equal(Array.isArray(payload.state.idempotencyKeys), true);
    assert.equal(payload.state.idempotencyKeys.length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync handles thrown hedgeFn errors without consuming idempotency', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-hedge-throw-'));
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killSwitchFile = path.join(tempDir, 'STOP');

  try {
    const payload = await runMirrorSync(
      {
        mode: 'once',
        indexerUrl: 'https://example.invalid/graphql',
        timeoutMs: 1000,
        pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        polymarketMarketId: 'poly-cond-1',
        executeLive: true,
        trustDeploy: false,
        hedgeEnabled: true,
        hedgeRatio: 1,
        intervalMs: 5000,
        driftTriggerBps: 10000,
        hedgeTriggerUsdc: 1,
        maxRebalanceUsdc: 25,
        maxHedgeUsdc: 10,
        maxOpenExposureUsdc: 100,
        maxTradesPerDay: 10,
        cooldownMs: 1000,
        depthSlippageBps: 100,
        stateFile,
        killSwitchFile,
        rpcUrl: 'https://rpc.example',
        polymarketHost: 'https://clob.polymarket.com',
        privateKey: `0x${'1'.repeat(64)}`,
        funder: '0x2222222222222222222222222222222222222222',
      },
      {
        verifyFn: async () => ({
          matchConfidence: 0.99,
          gateResult: {
            ok: true,
            failedChecks: [],
            checks: [{ code: 'CLOSE_TIME_DELTA', ok: true, meta: { closeDeltaHours: 0 } }],
          },
          sourceMarket: {
            source: 'polymarket',
            marketId: 'poly-cond-1',
            yesPct: 80,
            yesTokenId: 'yes-token',
            noTokenId: 'no-token',
            sourceFreshness: {
              transport: 'poll',
              observedAt: new Date().toISOString(),
            },
          },
          pandora: {
            yesPct: 40,
            reserveYes: 2,
            reserveNo: 8,
          },
          expiry: { minTimeToExpirySec: 7200 },
        }),
        depthFn: async () => ({
          depthWithinSlippageUsd: 1000,
          yesDepth: { depthUsd: 1000, midPrice: 0.4, worstPrice: 0.41 },
          noDepth: { depthUsd: 1000, midPrice: 0.6, worstPrice: 0.61 },
        }),
        readPandoraReserveContext: async () => ({
          source: 'onchain:outcome-token-balances',
          reserveYesUsdc: 2,
          reserveNoUsdc: 8,
          pandoraYesPct: 40,
          feeTier: 3000,
          readAt: '2026-03-01T10:00:00.000Z',
        }),
        rebalanceFn: async () => ({ ok: true }),
        hedgeFn: async () => {
          throw new Error('hedge transport failed');
        },
      },
    );

    assert.equal(payload.actionCount, 1);
    assert.equal(payload.actions[0].status, 'failed');
    assert.equal(payload.state.tradesToday, 0);
    assert.equal(payload.state.idempotencyKeys.length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync blocks live execution when the last action still requires manual review', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-manual-review-'));
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killSwitchFile = path.join(tempDir, 'STOP');
  let rebalanceCalls = 0;
  let hedgeCalls = 0;

  try {
    saveMirrorState(stateFile, {
      strategyHash: 'manual-review-hash',
      lastExecution: {
        mode: 'live',
        status: 'executed',
        idempotencyKey: 'prior-live-action',
        startedAt: '2026-03-09T10:00:00.000Z',
        completedAt: '2026-03-09T10:00:05.000Z',
        lockNonce: 'prior-live-lock',
        requiresManualReview: true,
      },
      tradesToday: 1,
      idempotencyKeys: [],
      alerts: [],
    });

    const payload = await runMirrorSync(
      {
        mode: 'once',
        indexerUrl: 'https://example.invalid/graphql',
        timeoutMs: 1000,
        pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        polymarketMarketId: 'poly-cond-1',
        executeLive: true,
        trustDeploy: false,
        hedgeEnabled: true,
        hedgeRatio: 1,
        intervalMs: 5000,
        driftTriggerBps: 10000,
        hedgeTriggerUsdc: 1,
        maxRebalanceUsdc: 25,
        maxHedgeUsdc: 10,
        maxOpenExposureUsdc: 100,
        maxTradesPerDay: 10,
        cooldownMs: 1000,
        depthSlippageBps: 100,
        stateFile,
        killSwitchFile,
        rpcUrl: 'https://rpc.example',
        polymarketHost: 'https://clob.polymarket.com',
        privateKey: `0x${'1'.repeat(64)}`,
        funder: '0x2222222222222222222222222222222222222222',
      },
      {
        verifyFn: async () => ({
          matchConfidence: 0.99,
          gateResult: {
            ok: true,
            failedChecks: [],
            checks: [{ code: 'CLOSE_TIME_DELTA', ok: true, meta: { closeDeltaHours: 0 } }],
          },
          sourceMarket: {
            source: 'polymarket',
            marketId: 'poly-cond-1',
            yesPct: 80,
            yesTokenId: 'yes-token',
            noTokenId: 'no-token',
            sourceFreshness: {
              transport: 'poll',
              observedAt: new Date().toISOString(),
            },
          },
          pandora: {
            yesPct: 40,
            reserveYes: 2,
            reserveNo: 8,
          },
          expiry: {
            pandoraTimeToExpirySec: 7200,
            sourceTimeToExpirySec: 7200,
            minTimeToExpirySec: 7200,
          },
        }),
        depthFn: async () => ({
          depthWithinSlippageUsd: 1000,
          yesDepth: { depthUsd: 1000, midPrice: 0.4, worstPrice: 0.41 },
          noDepth: { depthUsd: 1000, midPrice: 0.6, worstPrice: 0.61 },
        }),
        readPandoraReserveContext: async () => ({
          source: 'onchain:outcome-token-balances',
          reserveYesUsdc: 2,
          reserveNoUsdc: 8,
          pandoraYesPct: 40,
          feeTier: 3000,
          readAt: '2026-03-01T10:00:00.000Z',
        }),
        rebalanceFn: async () => {
          rebalanceCalls += 1;
          return { ok: true };
        },
        hedgeFn: async () => {
          hedgeCalls += 1;
          return { ok: true };
        },
      },
    );

    assert.equal(payload.actionCount, 0);
    assert.equal(payload.snapshots[0].action.status, 'blocked');
    assert.equal(payload.snapshots[0].action.code, 'LAST_ACTION_REQUIRES_REVIEW');
    assert.equal(rebalanceCalls, 0);
    assert.equal(hedgeCalls, 0);
    assert.equal(payload.state.lastExecution.requiresManualReview, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync blocks live execution when the persisted last action is still pending', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-pending-state-'));
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killSwitchFile = path.join(tempDir, 'STOP');
  let rebalanceCalls = 0;
  let hedgeCalls = 0;

  try {
    saveMirrorState(stateFile, {
      strategyHash: 'pending-state-hash',
      lastExecution: {
        mode: 'live',
        status: 'pending',
        idempotencyKey: 'prior-live-action',
        startedAt: '2026-03-09T10:00:00.000Z',
        lockNonce: 'prior-live-lock',
      },
      tradesToday: 1,
      idempotencyKeys: [],
      alerts: [],
    });

    const payload = await runMirrorSync(
      {
        mode: 'once',
        indexerUrl: 'https://example.invalid/graphql',
        timeoutMs: 1000,
        pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        polymarketMarketId: 'poly-cond-1',
        executeLive: true,
        trustDeploy: false,
        hedgeEnabled: true,
        hedgeRatio: 1,
        intervalMs: 5000,
        driftTriggerBps: 10000,
        hedgeTriggerUsdc: 1,
        maxRebalanceUsdc: 25,
        maxHedgeUsdc: 10,
        maxOpenExposureUsdc: 100,
        maxTradesPerDay: 10,
        cooldownMs: 1000,
        depthSlippageBps: 100,
        stateFile,
        killSwitchFile,
        rpcUrl: 'https://rpc.example',
        polymarketHost: 'https://clob.polymarket.com',
        privateKey: `0x${'1'.repeat(64)}`,
        funder: '0x2222222222222222222222222222222222222222',
      },
      {
        verifyFn: async () => ({
          matchConfidence: 0.99,
          gateResult: {
            ok: true,
            failedChecks: [],
            checks: [{ code: 'CLOSE_TIME_DELTA', ok: true, meta: { closeDeltaHours: 0 } }],
          },
          sourceMarket: {
            source: 'polymarket',
            marketId: 'poly-cond-1',
            yesPct: 80,
            yesTokenId: 'yes-token',
            noTokenId: 'no-token',
            sourceFreshness: {
              transport: 'poll',
              observedAt: new Date().toISOString(),
            },
          },
          pandora: {
            yesPct: 40,
            reserveYes: 2,
            reserveNo: 8,
          },
          expiry: {
            pandoraTimeToExpirySec: 7200,
            sourceTimeToExpirySec: 7200,
            minTimeToExpirySec: 7200,
          },
        }),
        depthFn: async () => ({
          depthWithinSlippageUsd: 1000,
          yesDepth: { depthUsd: 1000, midPrice: 0.4, worstPrice: 0.41 },
          noDepth: { depthUsd: 1000, midPrice: 0.6, worstPrice: 0.61 },
        }),
        readPandoraReserveContext: async () => ({
          source: 'onchain:outcome-token-balances',
          reserveYesUsdc: 2,
          reserveNoUsdc: 8,
          pandoraYesPct: 40,
          feeTier: 3000,
          readAt: '2026-03-01T10:00:00.000Z',
        }),
        rebalanceFn: async () => {
          rebalanceCalls += 1;
          return { ok: true };
        },
        hedgeFn: async () => {
          hedgeCalls += 1;
          return { ok: true };
        },
      },
    );

    assert.equal(payload.actionCount, 0);
    assert.equal(payload.snapshots[0].action.status, 'blocked');
    assert.equal(payload.snapshots[0].action.code, 'PENDING_ACTION_STATE');
    assert.equal(rebalanceCalls, 0);
    assert.equal(hedgeCalls, 0);
    assert.equal(payload.state.lastExecution.requiresManualReview, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync treats orphaned pending-action locks as zombie manual-review blocks', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-zombie-lock-'));
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killSwitchFile = path.join(tempDir, 'STOP');
  const lockFile = buildPendingActionFilePath(stateFile);

  try {
    saveMirrorState(stateFile, {
      strategyHash: 'zombie-lock-hash',
      tradesToday: 0,
      idempotencyKeys: [],
      alerts: [],
    });
    fs.writeFileSync(
      lockFile,
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          status: 'pending',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          pid: 99999999,
          idempotencyKey: 'prior-live-action',
          lockNonce: 'zombie-lock-nonce',
        },
        null,
        2,
      ),
    );

    const payload = await runMirrorSync(
      {
        mode: 'once',
        indexerUrl: 'https://example.invalid/graphql',
        timeoutMs: 1000,
        pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        polymarketMarketId: 'poly-cond-1',
        executeLive: true,
        trustDeploy: false,
        hedgeEnabled: true,
        hedgeRatio: 1,
        intervalMs: 5000,
        driftTriggerBps: 10000,
        hedgeTriggerUsdc: 1,
        maxRebalanceUsdc: 25,
        maxHedgeUsdc: 10,
        maxOpenExposureUsdc: 100,
        maxTradesPerDay: 10,
        cooldownMs: 1000,
        depthSlippageBps: 100,
        stateFile,
        killSwitchFile,
        rpcUrl: 'https://rpc.example',
        polymarketHost: 'https://clob.polymarket.com',
        privateKey: `0x${'1'.repeat(64)}`,
        funder: '0x2222222222222222222222222222222222222222',
      },
      {
        verifyFn: async () => ({
          matchConfidence: 0.99,
          gateResult: {
            ok: true,
            failedChecks: [],
            checks: [{ code: 'CLOSE_TIME_DELTA', ok: true, meta: { closeDeltaHours: 0 } }],
          },
          sourceMarket: {
            source: 'polymarket',
            marketId: 'poly-cond-1',
            yesPct: 80,
            yesTokenId: 'yes-token',
            noTokenId: 'no-token',
            sourceFreshness: {
              transport: 'poll',
              observedAt: new Date().toISOString(),
            },
          },
          pandora: {
            yesPct: 40,
            reserveYes: 2,
            reserveNo: 8,
          },
          expiry: {
            pandoraTimeToExpirySec: 7200,
            sourceTimeToExpirySec: 7200,
            minTimeToExpirySec: 7200,
          },
        }),
        depthFn: async () => ({
          depthWithinSlippageUsd: 1000,
          yesDepth: { depthUsd: 1000, midPrice: 0.4, worstPrice: 0.41 },
          noDepth: { depthUsd: 1000, midPrice: 0.6, worstPrice: 0.61 },
        }),
        readPandoraReserveContext: async () => ({
          source: 'onchain:outcome-token-balances',
          reserveYesUsdc: 2,
          reserveNoUsdc: 8,
          pandoraYesPct: 40,
          feeTier: 3000,
          readAt: '2026-03-01T10:00:00.000Z',
        }),
        rebalanceFn: async () => {
          throw new Error('rebalanceFn should not run while zombie lock is present');
        },
        hedgeFn: async () => {
          throw new Error('hedgeFn should not run while zombie lock is present');
        },
      },
    );

    const pendingLock = readPendingActionLock(stateFile);
    assert.equal(payload.actionCount, 0);
    assert.equal(payload.snapshots[0].action.status, 'blocked');
    assert.equal(payload.snapshots[0].action.code, 'PENDING_ACTION_LOCK_ZOMBIE');
    assert.equal(pendingLock.status, 'zombie');
    assert.equal(pendingLock.requiresManualReview, true);
    assert.equal(pendingLock.lockNonce, 'zombie-lock-nonce');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync retains manual review when pending-action nonce changes during live completion', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-lock-conflict-'));
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killSwitchFile = path.join(tempDir, 'STOP');
  const lockFile = buildPendingActionFilePath(stateFile);
  let hedgeCalls = 0;

  try {
    const firstPayload = await runMirrorSync(
      {
        mode: 'once',
        indexerUrl: 'https://example.invalid/graphql',
        timeoutMs: 1000,
        pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        polymarketMarketId: 'poly-cond-1',
        executeLive: true,
        trustDeploy: false,
        hedgeEnabled: true,
        hedgeRatio: 1,
        intervalMs: 5000,
        driftTriggerBps: 10000,
        hedgeTriggerUsdc: 1,
        maxRebalanceUsdc: 25,
        maxHedgeUsdc: 10,
        maxOpenExposureUsdc: 100,
        maxTradesPerDay: 10,
        cooldownMs: 1000,
        depthSlippageBps: 100,
        stateFile,
        killSwitchFile,
        rpcUrl: 'https://rpc.example',
        polymarketHost: 'https://clob.polymarket.com',
        privateKey: `0x${'1'.repeat(64)}`,
        funder: '0x2222222222222222222222222222222222222222',
      },
      {
        verifyFn: async () => ({
          matchConfidence: 0.99,
          gateResult: {
            ok: true,
            failedChecks: [],
            checks: [{ code: 'CLOSE_TIME_DELTA', ok: true, meta: { closeDeltaHours: 0 } }],
          },
          sourceMarket: {
            source: 'polymarket',
            marketId: 'poly-cond-1',
            yesPct: 80,
            yesTokenId: 'yes-token',
            noTokenId: 'no-token',
            sourceFreshness: {
              transport: 'poll',
              observedAt: new Date().toISOString(),
            },
          },
          pandora: {
            yesPct: 40,
            reserveYes: 2,
            reserveNo: 8,
          },
          expiry: {
            pandoraTimeToExpirySec: 7200,
            sourceTimeToExpirySec: 7200,
            minTimeToExpirySec: 7200,
          },
        }),
        depthFn: async () => ({
          depthWithinSlippageUsd: 1000,
          yesDepth: { depthUsd: 1000, midPrice: 0.4, worstPrice: 0.41 },
          noDepth: { depthUsd: 1000, midPrice: 0.6, worstPrice: 0.61 },
        }),
        readPandoraReserveContext: async () => ({
          source: 'onchain:outcome-token-balances',
          reserveYesUsdc: 2,
          reserveNoUsdc: 8,
          pandoraYesPct: 40,
          feeTier: 3000,
          readAt: '2026-03-01T10:00:00.000Z',
        }),
        rebalanceFn: async () => {
          throw new Error('rebalanceFn should not run in the hedge-only conflict scenario');
        },
        hedgeFn: async () => {
          hedgeCalls += 1;
          fs.writeFileSync(
            lockFile,
            JSON.stringify(
              {
                schemaVersion: '1.0.0',
                status: 'reconciliation-required',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                pid: process.pid,
                idempotencyKey: 'foreign-live-action',
                lockNonce: 'foreign-lock-nonce',
                requiresManualReview: true,
              },
              null,
              2,
            ),
          );
          return { ok: true };
        },
      },
    );

    assert.equal(hedgeCalls, 1);
    assert.equal(firstPayload.actionCount, 1);
    assert.equal(firstPayload.actions[0].status, 'executed');
    assert.equal(firstPayload.actions[0].requiresManualReview, true);
    assert.equal(firstPayload.actions[0].lockConflict.code, 'PENDING_ACTION_LOCK_CONFLICT');
    assert.equal(firstPayload.state.lastExecution.requiresManualReview, true);
    assert.equal(readPendingActionLock(stateFile).lockNonce, 'foreign-lock-nonce');
    saveMirrorState(stateFile, {
      ...firstPayload.state,
      currentHedgeUsdc: 0,
      tradesToday: 0,
      idempotencyKeys: [],
    });

    const secondPayload = await runMirrorSync(
      {
        mode: 'once',
        indexerUrl: 'https://example.invalid/graphql',
        timeoutMs: 1000,
        pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        polymarketMarketId: 'poly-cond-1',
        executeLive: true,
        trustDeploy: false,
        hedgeEnabled: true,
        hedgeRatio: 1,
        intervalMs: 5000,
        driftTriggerBps: 10000,
        hedgeTriggerUsdc: 1,
        maxRebalanceUsdc: 25,
        maxHedgeUsdc: 10,
        maxOpenExposureUsdc: 100,
        maxTradesPerDay: 10,
        cooldownMs: 1000,
        depthSlippageBps: 100,
        stateFile,
        killSwitchFile,
        rpcUrl: 'https://rpc.example',
        polymarketHost: 'https://clob.polymarket.com',
        privateKey: `0x${'1'.repeat(64)}`,
        funder: '0x2222222222222222222222222222222222222222',
      },
      {
        verifyFn: async () => ({
          matchConfidence: 0.99,
          gateResult: {
            ok: true,
            failedChecks: [],
            checks: [{ code: 'CLOSE_TIME_DELTA', ok: true, meta: { closeDeltaHours: 0 } }],
          },
          sourceMarket: {
            source: 'polymarket',
            marketId: 'poly-cond-1',
            yesPct: 80,
            yesTokenId: 'yes-token',
            noTokenId: 'no-token',
          },
          pandora: {
            yesPct: 40,
            reserveYes: 2,
            reserveNo: 8,
          },
          expiry: {
            pandoraTimeToExpirySec: 7200,
            sourceTimeToExpirySec: 7200,
            minTimeToExpirySec: 7200,
          },
        }),
        depthFn: async () => ({
          depthWithinSlippageUsd: 1000,
          yesDepth: { depthUsd: 1000, midPrice: 0.4, worstPrice: 0.41 },
          noDepth: { depthUsd: 1000, midPrice: 0.6, worstPrice: 0.61 },
        }),
        readPandoraReserveContext: async () => ({
          source: 'onchain:outcome-token-balances',
          reserveYesUsdc: 2,
          reserveNoUsdc: 8,
          pandoraYesPct: 40,
          feeTier: 3000,
          readAt: '2026-03-01T10:00:00.000Z',
        }),
        rebalanceFn: async () => {
          throw new Error('rebalanceFn should not run while conflicting pending action remains');
        },
        hedgeFn: async () => {
          throw new Error('hedgeFn should not run while conflicting pending action remains');
        },
      },
    );

    assert.equal(secondPayload.actionCount, 0);
    assert.equal(secondPayload.snapshots[0].action.status, 'blocked');
    assert.equal(secondPayload.snapshots[0].action.code, 'PENDING_ACTION_LOCK_REVIEW');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync run mode continues after transient tick verification failures', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-sync-tick-retry-'));
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killSwitchFile = path.join(tempDir, 'STOP');

  const verifyPayload = {
    matchConfidence: 0.99,
    gateResult: {
      ok: true,
      failedChecks: [],
      checks: [{ code: 'CLOSE_TIME_DELTA', ok: true, meta: { closeDeltaHours: 0 } }],
    },
    sourceMarket: {
      source: 'polymarket',
      marketId: 'poly-cond-1',
      yesPct: 60,
      yesTokenId: 'yes-token',
      noTokenId: 'no-token',
    },
    pandora: {
      yesPct: 55,
      reserveYes: 5,
      reserveNo: 5,
    },
    expiry: { minTimeToExpirySec: 7200 },
  };

  let verifyCallCount = 0;

  try {
    const payload = await runMirrorSync(
      {
        mode: 'run',
        iterations: 3,
        indexerUrl: 'https://example.invalid/graphql',
        timeoutMs: 1000,
        pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        polymarketMarketId: 'poly-cond-1',
        executeLive: false,
        trustDeploy: false,
        hedgeEnabled: false,
        hedgeRatio: 1,
        intervalMs: 1,
        driftTriggerBps: 10000,
        hedgeTriggerUsdc: 1000,
        maxRebalanceUsdc: 25,
        maxHedgeUsdc: 10,
        maxOpenExposureUsdc: 100,
        maxTradesPerDay: 10,
        cooldownMs: 1000,
        depthSlippageBps: 100,
        stateFile,
        killSwitchFile,
        rpcUrl: 'https://rpc.example',
        polymarketHost: 'https://clob.polymarket.com',
      },
      {
        verifyFn: async () => {
          verifyCallCount += 1;
          if (verifyCallCount === 2) {
            const error = new Error('temporary indexer timeout');
            error.code = 'INDEXER_TIMEOUT';
            throw error;
          }
          return verifyPayload;
        },
        depthFn: async () => ({
          depthWithinSlippageUsd: 1000,
          yesDepth: { depthUsd: 1000, midPrice: 0.4, worstPrice: 0.41 },
          noDepth: { depthUsd: 1000, midPrice: 0.6, worstPrice: 0.61 },
        }),
        readPandoraReserveContext: async () => ({
          source: 'onchain:outcome-token-balances',
          reserveYesUsdc: 4.5,
          reserveNoUsdc: 5.5,
          pandoraYesPct: 55,
          feeTier: 3000,
          readAt: '2026-03-01T10:00:00.000Z',
        }),
        sleep: async () => {},
      },
    );

    assert.equal(payload.iterationsCompleted, 3);
    assert.equal(payload.snapshots.length, 3);
    assert.equal(payload.diagnostics.length, 1);
    assert.equal(payload.diagnostics[0].code, 'INDEXER_TIMEOUT');
    assert.equal(payload.diagnostics[0].scope, 'tick');
    assert.equal(payload.snapshots[1].action.status, 'error');
    assert.equal(payload.snapshots[1].error.code, 'INDEXER_TIMEOUT');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync once mode still fails fast on tick errors', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-sync-once-fail-'));
  const stateFile = path.join(tempDir, 'mirror-state.json');
  const killSwitchFile = path.join(tempDir, 'STOP');

  const verifyPayload = {
    matchConfidence: 0.99,
    gateResult: {
      ok: true,
      failedChecks: [],
      checks: [{ code: 'CLOSE_TIME_DELTA', ok: true, meta: { closeDeltaHours: 0 } }],
    },
    sourceMarket: {
      source: 'polymarket',
      marketId: 'poly-cond-1',
      yesPct: 60,
      yesTokenId: 'yes-token',
      noTokenId: 'no-token',
    },
    pandora: {
      yesPct: 55,
      reserveYes: 5,
      reserveNo: 5,
    },
    expiry: { minTimeToExpirySec: 7200 },
  };

  try {
    await assert.rejects(
      runMirrorSync(
        {
          mode: 'once',
          indexerUrl: 'https://example.invalid/graphql',
          timeoutMs: 1000,
          pandoraMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          polymarketMarketId: 'poly-cond-1',
          executeLive: false,
          trustDeploy: false,
          hedgeEnabled: false,
          hedgeRatio: 1,
          intervalMs: 1,
          driftTriggerBps: 10000,
          hedgeTriggerUsdc: 1000,
          maxRebalanceUsdc: 25,
          maxHedgeUsdc: 10,
          maxOpenExposureUsdc: 100,
          maxTradesPerDay: 10,
          cooldownMs: 1000,
          depthSlippageBps: 100,
          stateFile,
          killSwitchFile,
          polymarketHost: 'https://clob.polymarket.com',
        },
        {
          verifyFn: async () => verifyPayload,
          depthFn: async () => {
            const error = new Error('depth fetch unavailable');
            error.code = 'DEPTH_FETCH_FAILED';
            throw error;
          },
          sleep: async () => {},
        },
      ),
      (error) => {
        assert.equal(error.code, 'DEPTH_FETCH_FAILED');
        return true;
      },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runAutopilot does not consume budget/idempotency when executeFn throws', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-autopilot-failure-'));
  const stateFile = path.join(tempDir, 'autopilot-state.json');
  const killSwitchFile = path.join(tempDir, 'STOP');

  try {
    const payload = await runAutopilot(
      {
        mode: 'once',
        marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        side: 'yes',
        amountUsdc: 10,
        triggerYesBelow: 90,
        triggerYesAbove: null,
        executeLive: true,
        cooldownMs: 60_000,
        maxOpenExposureUsdc: 100,
        maxTradesPerDay: 10,
        intervalMs: 1000,
        stateFile,
        killSwitchFile,
        yesPct: null,
        slippageBps: 100,
      },
      {
        quoteFn: async () => ({
          quoteAvailable: true,
          odds: { yesPct: 25 },
        }),
        executeFn: async () => {
          throw new Error('execution failed');
        },
      },
    );

    assert.equal(payload.actionCount, 1);
    assert.equal(payload.actions[0].status, 'failed');
    assert.equal(payload.state.tradesToday, 0);
    assert.equal(payload.state.dailySpendUsdc, 0);
    assert.equal(Array.isArray(payload.state.idempotencyKeys), true);
    assert.equal(payload.state.idempotencyKeys.length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createParseWatchFlags supports --amount alias with wallet target', () => {
  const parseWatchFlags = createParseWatchFlags(buildParserDeps());

  const options = parseWatchFlags(['--wallet', TEST_WALLET, '--amount', '2.5']);

  assert.equal(options.wallet, TEST_WALLET);
  assert.equal(options.amountUsdc, 2.5);
  assert.equal(options.marketAddress, null);
});

test('createParseAutopilotFlags applies default state files and paper-mode limits', () => {
  let capturedDefaultStateInput = null;
  const parseAutopilotFlags = createParseAutopilotFlags(
    buildParserDeps({
      defaultAutopilotStateFile: (input) => {
        capturedDefaultStateInput = input;
        return '/tmp/autopilot-state.json';
      },
      defaultAutopilotKillSwitchFile: () => '/tmp/autopilot-stop',
    }),
  );

  const options = parseAutopilotFlags([
    'run',
    '--market-address',
    TEST_MARKET,
    '--side',
    'yes',
    '--amount-usdc',
    '5',
    '--trigger-yes-below',
    '40',
  ]);

  assert.equal(options.stateFile, '/tmp/autopilot-state.json');
  assert.equal(options.killSwitchFile, '/tmp/autopilot-stop');
  assert.equal(options.maxOpenExposureUsdc, Number.POSITIVE_INFINITY);
  assert.equal(options.maxTradesPerDay, Number.MAX_SAFE_INTEGER);
  assert.equal(capturedDefaultStateInput.marketAddress, TEST_MARKET);
});

test('createParseTradeFlags enforces secure --rpc-url and drops dead funder field', () => {
  const parseTradeFlags = createParseTradeFlags(
    buildParserDeps({
      parseBigIntString: (value) => value,
    }),
  );

  const options = parseTradeFlags([
    '--market-address',
    TEST_MARKET,
    '--side',
    'yes',
    '--amount-usdc',
    '3',
    '--dry-run',
    '--rpc-url',
    'https://rpc.example',
  ]);

  assert.equal(options.rpcUrl, 'https://rpc.example');
  assert.equal(Object.prototype.hasOwnProperty.call(options, 'funder'), false);

  assert.throws(
    () =>
      parseTradeFlags([
        '--market-address',
        TEST_MARKET,
        '--side',
        'yes',
        '--amount-usdc',
        '3',
        '--dry-run',
        '--rpc-url',
        'http://evil.example',
      ]),
    (error) => {
      assert.equal(error.code, 'INVALID_FLAG_VALUE');
      assert.match(error.message, /https:\/\//i);
      return true;
    },
  );
});

test('createParseTradeFlags supports sell mode with share-based inputs', () => {
  const parseTradeFlags = createParseTradeFlags(
    buildParserDeps({
      parseBigIntString: (value) => value,
    }),
  );

  const options = parseTradeFlags([
    '--market-address',
    TEST_MARKET,
    '--side',
    'no',
    '--mode',
    'sell',
    '--shares',
    '12.5',
    '--dry-run',
    '--min-amount-out-raw',
    '42',
  ]);

  assert.equal(options.mode, 'sell');
  assert.equal(options.amount, 12.5);
  assert.equal(options.amountUsdc, null);
  assert.equal(options.minAmountOutRaw, '42');
});

test('createParseMirrorBrowseFlags parses relative end-date windows and new browse selectors', () => {
  const parseMirrorBrowseFlags = createParseMirrorBrowseFlags(
    buildParserDeps({
      parseDateLikeFlag: parserParseDateLikeFlag,
    }),
  );

  const startedAt = Date.now();
  const options = parseMirrorBrowseFlags([
    '--end-date-after',
    '1h',
    '--end-date-before',
    '72h',
    '--keyword',
    'bitcoin',
    '--slug',
    'etf',
    '--category',
    'crypto,politics',
    '--sort-by',
    'liquidity',
    '--limit',
    '7',
  ]);

  assert.equal(options.keyword, 'bitcoin');
  assert.equal(options.slug, 'etf');
  assert.deepEqual(options.categories, ['crypto', 'politics']);
  assert.equal(options.sortBy, 'liquidity');
  assert.equal(options.limit, 7);
  assert.ok(Number.isFinite(Date.parse(options.closesAfter)));
  assert.ok(Number.isFinite(Date.parse(options.closesBefore)));
  assert.ok(Date.parse(options.closesAfter) >= startedAt + 45 * 60 * 1000);
  assert.ok(Date.parse(options.closesBefore) >= startedAt + 70 * 60 * 60 * 1000);
});

test('createParseMirrorBrowseFlags rejects contradictory sports filters', () => {
  const parseMirrorBrowseFlags = createParseMirrorBrowseFlags(
    buildParserDeps({
      parseDateLikeFlag: parserParseDateLikeFlag,
    }),
  );

  assert.throws(
    () => parseMirrorBrowseFlags(['--category', 'sports', '--exclude-sports']),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGS');
      assert.match(error.message, /cannot be combined/i);
      return true;
    },
  );
});

test('createParseMirrorTraceFlags accepts explicit blocks and range sampling selectors', () => {
  const parseMirrorTraceFlags = createParseMirrorTraceFlags(buildParserDeps());

  const explicitBlocks = parseMirrorTraceFlags([
    '--market-address',
    TEST_MARKET,
    '--rpc-url',
    'https://primary-rpc.example, https://backup-rpc.example,https://primary-rpc.example',
    '--blocks',
    '0,19000002, 19000005',
    '--limit',
    '2',
  ]);
  assert.equal(explicitBlocks.pandoraMarketAddress, TEST_MARKET);
  assert.equal(explicitBlocks.rpcUrl, 'https://primary-rpc.example,https://backup-rpc.example');
  assert.deepEqual(explicitBlocks.blocks, [0, 19000002, 19000005]);
  assert.equal(explicitBlocks.fromBlock, null);
  assert.equal(explicitBlocks.toBlock, null);
  assert.equal(explicitBlocks.step, 1);
  assert.equal(explicitBlocks.limit, 2);

  const range = parseMirrorTraceFlags([
    '--market-address',
    TEST_MARKET,
    '--rpc-url',
    'https://trace-rpc.example',
    '--from-block',
    '19000010',
    '--to-block',
    '19000000',
    '--step',
    '5',
  ]);
  assert.equal(range.rpcUrl, 'https://trace-rpc.example');
  assert.equal(range.blocks, null);
  assert.equal(range.fromBlock, 19000010);
  assert.equal(range.toBlock, 19000000);
  assert.equal(range.step, 5);
  assert.equal(range.limit, null);
});

test('createParseMirrorTraceFlags rejects missing or contradictory historical selectors', () => {
  const parseMirrorTraceFlags = createParseMirrorTraceFlags(buildParserDeps());

  assert.throws(
    () => parseMirrorTraceFlags(['--market-address', TEST_MARKET, '--rpc-url', 'https://trace-rpc.example']),
    (error) => {
      assert.equal(error.code, 'MISSING_REQUIRED_FLAG');
      assert.match(error.message, /--blocks/i);
      assert.match(error.message, /--from-block/i);
      return true;
    },
  );

  assert.throws(
    () =>
      parseMirrorTraceFlags([
        '--market-address',
        TEST_MARKET,
        '--rpc-url',
        'https://trace-rpc.example',
        '--blocks',
        '19000000,19000001',
        '--from-block',
        '19000000',
        '--to-block',
        '19000001',
      ]),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGS');
      assert.match(error.message, /cannot be combined/i);
      return true;
    },
  );
});

test('resolveForkRuntime supports attach-only fork mode with strict env/flag precedence', () => {
  const live = resolveForkRuntime(
    { chainId: 146 },
    {
      env: {},
      isSecureHttpUrlOrLocal: parserIsSecureHttpUrlOrLocal,
      defaultChainId: 1,
    },
  );
  assert.equal(live.mode, 'live');
  assert.equal(live.chainId, 146);

  const fork = resolveForkRuntime(
    {
      fork: true,
      forkRpcUrl: 'http://127.0.0.1:8545',
      forkChainId: 137,
      chainId: 1,
    },
    {
      env: {},
      isSecureHttpUrlOrLocal: parserIsSecureHttpUrlOrLocal,
      defaultChainId: 1,
    },
  );
  assert.equal(fork.mode, 'fork');
  assert.equal(fork.rpcUrl, 'http://127.0.0.1:8545');
  assert.equal(fork.chainId, 137);

  assert.throws(
    () =>
      resolveForkRuntime(
        { fork: true },
        {
          env: {},
          isSecureHttpUrlOrLocal: parserIsSecureHttpUrlOrLocal,
          defaultChainId: 1,
        },
      ),
    (error) => {
      assert.equal(error.code, 'MISSING_REQUIRED_FLAG');
      return true;
    },
  );
});

test('createParseMirrorDeployFlags rejects --allow-rule-mismatch', () => {
  const parseMirrorDeployFlags = createParseMirrorDeployFlags(buildParserDeps());

  assert.throws(
    () =>
      parseMirrorDeployFlags([
        '--plan-file',
        '/tmp/plan.json',
        '--dry-run',
        '--allow-rule-mismatch',
      ]),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGS');
      assert.match(error.message, /not supported/i);
      return true;
    },
  );
});

test('createParseMirrorDeployFlags parses min-close and gamma flags', () => {
  const parseMirrorDeployFlags = createParseMirrorDeployFlags(buildParserDeps());

  const options = parseMirrorDeployFlags([
    '--plan-file',
    '/tmp/plan.json',
    '--execute',
    '--min-close-lead-seconds',
    '600',
    '--polymarket-gamma-url',
    'https://gamma.example',
    '--polymarket-gamma-mock-url',
    'http://localhost:4010/gamma',
  ]);

  assert.equal(options.execute, true);
  assert.equal(options.minCloseLeadSeconds, 600);
  assert.equal(options.polymarketGammaUrl, 'https://gamma.example');
  assert.equal(options.polymarketGammaMockUrl, 'http://localhost:4010/gamma');
});

test('createParseMirrorDeployFlags parses explicit --target-timestamp from ISO values', () => {
  const parseMirrorDeployFlags = createParseMirrorDeployFlags(buildParserDeps());

  const options = parseMirrorDeployFlags([
    '--plan-file',
    '/tmp/plan.json',
    '--dry-run',
    '--target-timestamp',
    '2030-03-10T04:00:00Z',
  ]);

  assert.equal(options.targetTimestamp, Math.floor(Date.parse('2030-03-10T04:00:00Z') / 1000));
});

test('createParseMirrorDeployFlags enforces secure --rpc-url and drops dead allowRuleMismatch field', () => {
  const parseMirrorDeployFlags = createParseMirrorDeployFlags(buildParserDeps());

  const options = parseMirrorDeployFlags([
    '--plan-file',
    '/tmp/plan.json',
    '--execute',
    '--rpc-url',
    'https://rpc.example',
  ]);
  assert.equal(options.rpcUrl, 'https://rpc.example');
  assert.equal(Object.prototype.hasOwnProperty.call(options, 'allowRuleMismatch'), false);

  assert.throws(
    () =>
      parseMirrorDeployFlags([
        '--plan-file',
        '/tmp/plan.json',
        '--execute',
        '--rpc-url',
        'http://remote.example',
      ]),
    (error) => {
      assert.equal(error.code, 'INVALID_FLAG_VALUE');
      assert.match(error.message, /https:\/\//i);
      return true;
    },
  );
});

test('createParseMirrorDeployFlags rejects explicit empty or underspecified --sources early', () => {
  const parseMirrorDeployFlags = createParseMirrorDeployFlags(buildParserDeps());

  assert.throws(
    () =>
      parseMirrorDeployFlags([
        '--plan-file',
        '/tmp/plan.json',
        '--dry-run',
        '--sources',
        '',
      ]),
    (error) => {
      assert.equal(error.code, 'INVALID_FLAG_VALUE');
      assert.match(error.message, /at least two non-empty urls/i);
      return true;
    },
  );

  assert.throws(
    () =>
      parseMirrorDeployFlags([
        '--plan-file',
        '/tmp/plan.json',
        '--dry-run',
        '--sources',
        'https://example.com/one',
      ]),
    (error) => {
      assert.equal(error.code, 'INVALID_FLAG_VALUE');
      return true;
    },
  );
});

test('mirror sync gates normalize and selectively bypass failed checks', () => {
  assert.deepEqual(
    normalizeSkipGateChecks([' depth_coverage ', 'unknown_check', 'MAX_TRADES_PER_DAY', 'DEPTH_COVERAGE']),
    ['DEPTH_COVERAGE', 'MAX_TRADES_PER_DAY'],
  );

  const gated = applyGateBypassPolicy(
    {
      ok: false,
      failedChecks: ['DEPTH_COVERAGE', 'MAX_OPEN_EXPOSURE'],
      checks: [],
    },
    {
      forceGate: false,
      skipGateChecks: ['DEPTH_COVERAGE'],
    },
  );
  assert.equal(gated.ok, false);
  assert.deepEqual(gated.failedChecks, ['MAX_OPEN_EXPOSURE']);
  assert.deepEqual(gated.bypassedFailedChecks, ['DEPTH_COVERAGE']);
  assert.deepEqual(gated.skipGateChecksApplied, ['DEPTH_COVERAGE']);
});

test('mirror sync close-time delta is diagnostic by default and strict only when requested', () => {
  const baseContext = {
    verifyPayload: {
      gateResult: {
        ok: false,
        failedChecks: ['CLOSE_TIME_DELTA'],
        checks: [{ code: 'CLOSE_TIME_DELTA', ok: false, meta: { closeDeltaSeconds: 14_400 } }],
      },
      sourceMarket: { source: 'polymarket' },
    },
    executeLive: false,
    state: {
      currentHedgeUsdc: 0,
      tradesToday: 0,
    },
    plannedHedgeUsdc: 0,
    plannedSpendUsdc: 0,
    plannedHedgeSignedUsdc: 0,
    tradingTimeToExpirySec: 300,
    pandoraTimeToExpirySec: 300,
    sourceTimeToExpirySec: 120,
    minTimeToExpirySec: 120,
    minimumTimeToCloseSec: 30,
    depthWithinSlippageUsd: 0,
    hedgeDepthWithinSlippageUsd: null,
    depthSlippageBps: 100,
    maxOpenExposureUsdc: null,
    maxTradesPerDay: 1,
  };

  const diagnosticGate = evaluateStrictGates({
    ...baseContext,
    strictCloseTimeDelta: false,
  });
  assert.equal(diagnosticGate.ok, true);
  assert.deepEqual(diagnosticGate.failedChecks, []);
  assert.equal(
    diagnosticGate.checks.find((item) => item.code === 'MATCH_AND_RULES').ok,
    true,
  );
  assert.equal(
    diagnosticGate.checks.find((item) => item.code === 'CLOSE_TIME_DELTA').details.diagnosticOnly,
    true,
  );

  const strictGate = evaluateStrictGates({
    ...baseContext,
    strictCloseTimeDelta: true,
  });
  assert.equal(strictGate.ok, false);
  assert.deepEqual(strictGate.failedChecks, ['CLOSE_TIME_DELTA']);
  assert.equal(
    strictGate.checks.find((item) => item.code === 'CLOSE_TIME_DELTA').details.strictCloseTimeDelta,
    true,
  );
});

test('mirror sync startup verify uses the effective trading window with small configured minimums', async () => {
  assert.equal(
    resolveMinimumTimeToCloseSec({
      minTimeToCloseSec: 5,
      intervalMs: 1_000,
    }),
    5,
  );

  const createServiceError = (code, message, details) => Object.assign(new Error(message), { code, details });
  const buildVerifyRequest = () => ({});

  await assert.rejects(
    runStartupVerify({
      verifyFn: async () => ({
        expiry: {
          pandoraTimeToExpirySec: 4,
          sourceTimeToExpirySec: 300,
          minTimeToExpirySec: 4,
        },
      }),
      options: {},
      minimumTimeToCloseSec: 5,
      buildVerifyRequest,
      createServiceError,
    }),
    (error) => {
      assert.equal(error.code, 'MIRROR_EXPIRY_TOO_CLOSE');
      assert.equal(error.details.startupPandoraTimeToExpirySec, 4);
      assert.equal(error.details.startupSourceTimeToExpirySec, 300);
      return true;
    },
  );

  await assert.rejects(
    runStartupVerify({
      verifyFn: async () => ({
        expiry: {
          pandoraTimeToExpirySec: 300,
          sourceTimeToExpirySec: 4,
          minTimeToExpirySec: 4,
        },
      }),
      options: {},
      minimumTimeToCloseSec: 5,
      buildVerifyRequest,
      createServiceError,
    }),
    (error) => {
      assert.equal(error.code, 'MIRROR_EXPIRY_TOO_CLOSE');
      assert.equal(error.details.startupPandoraTimeToExpirySec, 300);
      assert.equal(error.details.startupSourceTimeToExpirySec, 4);
      assert.equal(error.details.startupMinTimeToExpirySec, 4);
      return true;
    },
  );

  await assert.doesNotReject(() =>
    runStartupVerify({
      verifyFn: async () => ({
        expiry: {
          pandoraTimeToExpirySec: 300,
          sourceTimeToExpirySec: 300,
          minTimeToExpirySec: 300,
        },
      }),
      options: {},
      minimumTimeToCloseSec: 5,
      buildVerifyRequest,
      createServiceError,
    }),
  );
});

test('buildVerifyRequest keeps sports close-lead default independent from min-time-to-close', () => {
  const payload = buildVerifyRequest({
    executeLive: true,
    stream: false,
    minTimeToCloseSec: 1800,
  });

  assert.equal(payload.minCloseLeadSeconds, DEFAULT_MIRROR_MIN_CLOSE_LEAD_SECONDS);
});

test('readPandoraOnchainReserveContext fails closed when reserve metadata is unavailable', async () => {
  await assert.rejects(
    () =>
      readPandoraOnchainReserveContext(
        {
          rpcUrl: 'https://primary-rpc.example',
          marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        {
          publicClient: {
            readContract: async ({ functionName }) => {
              if (functionName === 'yesToken') return '0x1111111111111111111111111111111111111111';
              if (functionName === 'noToken') return '0x2222222222222222222222222222222222222222';
              if (functionName === 'decimals' || functionName === 'tradingFee') {
                throw Object.assign(new Error('unavailable'), { code: 'RPC_FAIL' });
              }
              if (functionName === 'balanceOf') return 1_000_000n;
              throw new Error(`unexpected function ${functionName}`);
            },
          },
          viemRuntime: {
            formatUnits: (value, decimals) => Number(value) / 10 ** decimals,
          },
        },
      ),
    (error) => {
      assert.equal(error.code, 'MIRROR_ONCHAIN_RESERVES_UNAVAILABLE');
      assert.equal(Array.isArray(error.details.attempts), true);
      assert.equal(error.details.attempts[0].code, 'MIRROR_ONCHAIN_RESERVE_METADATA_UNAVAILABLE');
      return true;
    },
  );
});

test('readPandoraOnchainReserveContext marks fallback only when a secondary rpc succeeds', async () => {
  const primaryRpcUrl = 'https://primary-rpc.example';
  const secondaryRpcUrl = 'https://secondary-rpc.example';
  let currentRpcUrl = null;
  const context = await readPandoraOnchainReserveContext(
    {
      rpcUrl: `${primaryRpcUrl},${secondaryRpcUrl}`,
      marketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    {
      viemRuntime: {
        createPublicClient: ({ transport }) => {
          currentRpcUrl = transport.url;
          return {
            readContract: async ({ functionName }) => {
              if (currentRpcUrl === primaryRpcUrl) {
                throw Object.assign(new Error('primary down'), { code: 'RPC_DOWN' });
              }
              if (functionName === 'yesToken') return '0x1111111111111111111111111111111111111111';
              if (functionName === 'noToken') return '0x2222222222222222222222222222222222222222';
              if (functionName === 'decimals') return 6;
              if (functionName === 'tradingFee') return 3000;
              if (functionName === 'balanceOf') return 5_000_000n;
              throw new Error(`unexpected function ${functionName}`);
            },
          };
        },
        http: (url) => ({ url }),
        formatUnits: (value, decimals) => Number(value) / 10 ** decimals,
      },
    },
  );

  assert.equal(context.rpcUrl, secondaryRpcUrl);
  assert.equal(context.fallbackUsed, true);
  assert.equal(context.source, 'onchain:outcome-token-balances:fallback');
});

test('readPandoraOnchainReserveContext rejects unsupported named block tags instead of reading latest state', async () => {
  await assert.rejects(
    () =>
      readPandoraOnchainReserveContext(
        {
          rpcUrl: 'https://primary-rpc.example',
          marketAddress: TEST_MARKET,
          blockTag: 'earliest',
        },
        {
          publicClient: {
            readContract: async () => {
              throw new Error('should not reach RPC');
            },
          },
        },
      ),
    (error) => {
      assert.equal(error.code, 'MIRROR_TRACE_INVALID_BLOCK_TAG');
      assert.match(String(error.message), /latest|safe|finalized|pending/i);
      return true;
    },
  );
});

test('readPandoraOnchainReserveTrace returns structured historical snapshots with fallback rpc provenance', async () => {
  const primaryRpcUrl = 'https://primary-rpc.example';
  const secondaryRpcUrl = 'https://secondary-rpc.example';
  const blockNumbers = [19000000, 19000005];
  const observedBalanceReads = [];

  const payload = await readPandoraOnchainReserveTrace(
    {
      rpcUrl: `${primaryRpcUrl},${secondaryRpcUrl}`,
      marketAddress: TEST_MARKET,
      blocks: blockNumbers,
    },
    {
      viemRuntime: {
        createPublicClient({ transport }) {
          const rpcUrl = transport && transport.url ? String(transport.url) : '';
          return {
            async getBlock({ blockNumber }) {
              return {
                number: blockNumber,
                hash: `0x${Number(blockNumber).toString(16).padStart(64, '0')}`,
                timestamp: BigInt(1_710_000_000 + Number(blockNumber)),
              };
            },
            async readContract({ functionName, address, blockNumber }) {
              if (rpcUrl === primaryRpcUrl) {
                throw Object.assign(new Error(`primary unavailable for ${blockNumber}`), { code: 'RPC_DOWN' });
              }
              if (functionName === 'yesToken') return '0x1111111111111111111111111111111111111111';
              if (functionName === 'noToken') return '0x2222222222222222222222222222222222222222';
              if (functionName === 'decimals') return 6;
              if (functionName === 'tradingFee') return 3000;
              if (functionName === 'balanceOf') {
                observedBalanceReads.push([String(address).toLowerCase(), Number(blockNumber)]);
                return String(address).toLowerCase() === '0x1111111111111111111111111111111111111111'
                  ? BigInt((Number(blockNumber) - 18_999_990) * 1_000_000)
                  : BigInt((19_000_010 - Number(blockNumber)) * 1_000_000);
              }
              throw new Error(`unexpected function ${functionName}`);
            },
          };
        },
        http: (url) => ({ url }),
        formatUnits: (value, decimals) => Number(value) / 10 ** decimals,
      },
    },
  );

  assert.equal(payload.summary.snapshotCount, 2);
  assert.equal(payload.selector.selectionMode, 'blocks');
  assert.deepEqual(payload.selector.blocks, blockNumbers);
  assert.equal(payload.selector.fromBlock, null);
  assert.equal(payload.selector.toBlock, null);
  assert.equal(payload.selector.step, null);
  assert.equal(payload.summary.archiveRequired, null);
  assert.equal(payload.summary.archiveRequirement, 'depends-on-history-depth');
  assert.deepEqual(
    payload.snapshots.map((entry) => entry.blockNumber),
    blockNumbers,
  );
  assert.equal(payload.snapshots[0].rpcUrl, secondaryRpcUrl);
  assert.equal(payload.snapshots[0].fallbackUsed, true);
  assert.equal(typeof payload.snapshots[0].blockHash, 'string');
  assert.equal(typeof payload.snapshots[0].blockTimestamp, 'string');
  assert.equal(payload.snapshots[0].feeTier, 3000);
  assert.equal(payload.snapshots[0].reserveYesUsdc, 10);
  assert.equal(payload.snapshots[0].reserveNoUsdc, 10);
  assert.equal(payload.snapshots[0].pandoraYesPct, 50);
  assert.deepEqual(observedBalanceReads, [
    ['0x1111111111111111111111111111111111111111', 19000000],
    ['0x2222222222222222222222222222222222222222', 19000000],
    ['0x1111111111111111111111111111111111111111', 19000005],
    ['0x2222222222222222222222222222222222222222', 19000005],
  ]);
});

test('readPandoraOnchainReserveTrace applies range limits before the snapshot expansion cap and preserves range selectors', async () => {
  const payload = await readPandoraOnchainReserveTrace(
    {
      rpcUrl: 'https://trace-rpc.example',
      marketAddress: TEST_MARKET,
      fromBlock: 0,
      toBlock: 5_000,
      step: 1,
      limit: 2,
    },
    {
      viemRuntime: {
        createPublicClient() {
          return {
            async getBlock({ blockNumber }) {
              return {
                number: blockNumber,
                hash: `0x${Number(blockNumber).toString(16).padStart(64, '0')}`,
                timestamp: BigInt(1_710_000_000 + Number(blockNumber)),
              };
            },
            async readContract({ functionName, address, blockNumber }) {
              if (functionName === 'yesToken') return '0x1111111111111111111111111111111111111111';
              if (functionName === 'noToken') return '0x2222222222222222222222222222222222222222';
              if (functionName === 'decimals') return 6;
              if (functionName === 'tradingFee') return 3000;
              if (functionName === 'balanceOf') {
                return String(address).toLowerCase() === '0x1111111111111111111111111111111111111111'
                  ? BigInt((Number(blockNumber) + 1) * 1_000_000)
                  : BigInt((Number(blockNumber) + 2) * 1_000_000);
              }
              throw new Error(`unexpected function ${functionName}`);
            },
          };
        },
        http: (url) => ({ url }),
        formatUnits: (value, decimals) => Number(value) / 10 ** decimals,
      },
    },
  );

  assert.equal(payload.selector.selectionMode, 'range');
  assert.equal(payload.selector.fromBlock, 0);
  assert.equal(payload.selector.toBlock, 5000);
  assert.equal(payload.selector.step, 1);
  assert.deepEqual(payload.selector.blocks, []);
  assert.deepEqual(payload.snapshots.map((entry) => entry.blockNumber), [0, 1]);
});

test('readPandoraOnchainReserveTrace maps archive-state failures to a distinct operator error', async () => {
  await assert.rejects(
    () =>
      readPandoraOnchainReserveTrace(
        {
          rpcUrl: 'https://archive-missing-rpc.example',
          marketAddress: TEST_MARKET,
          blocks: [19000000],
        },
        {
          viemRuntime: {
            createPublicClient() {
              return {
                async getBlock({ blockNumber }) {
                  return {
                    number: blockNumber,
                    hash: `0x${Number(blockNumber).toString(16).padStart(64, '0')}`,
                    timestamp: BigInt(1_710_000_000 + Number(blockNumber)),
                  };
                },
                async readContract({ functionName }) {
                  if (functionName === 'yesToken') return '0x1111111111111111111111111111111111111111';
                  if (functionName === 'noToken') return '0x2222222222222222222222222222222222222222';
                  throw Object.assign(new Error('missing trie node for historical state'), { code: -32000 });
                },
              };
            },
            http: (url) => ({ url }),
            formatUnits: (value, decimals) => Number(value) / 10 ** decimals,
          },
        },
      ),
    (error) => {
      assert.equal(error.code, 'MIRROR_ONCHAIN_ARCHIVE_STATE_UNAVAILABLE');
      assert.equal(Array.isArray(error.details.attempts), true);
      assert.match(String(error.message), /archive|histor/i);
      return true;
    },
  );
});

test('readPandoraOnchainReserveTrace preserves generic rpc failures instead of misclassifying them as archive errors', async () => {
  await assert.rejects(
    () =>
      readPandoraOnchainReserveTrace(
        {
          rpcUrl: 'https://generic-rpc-failure.example',
          marketAddress: TEST_MARKET,
          blocks: [19000000],
        },
        {
          viemRuntime: {
            createPublicClient() {
              return {
                async getBlock({ blockNumber }) {
                  return {
                    number: blockNumber,
                    hash: `0x${Number(blockNumber).toString(16).padStart(64, '0')}`,
                    timestamp: BigInt(1_710_000_000 + Number(blockNumber)),
                  };
                },
                async readContract({ functionName }) {
                  if (functionName === 'yesToken') return '0x1111111111111111111111111111111111111111';
                  if (functionName === 'noToken') return '0x2222222222222222222222222222222222222222';
                  throw Object.assign(new Error('connection reset by peer'), { code: 'RPC_DOWN' });
                },
              };
            },
            http: (url) => ({ url }),
            formatUnits: (value, decimals) => Number(value) / 10 ** decimals,
          },
        },
      ),
    (error) => {
      assert.equal(error.code, 'MIRROR_ONCHAIN_RESERVES_UNAVAILABLE');
      assert.notEqual(error.code, 'MIRROR_ONCHAIN_ARCHIVE_STATE_UNAVAILABLE');
      return true;
    },
  );
});

test('mirror sync planning helpers build deterministic strategy payloads', () => {
  const verifyRequest = buildVerifyRequest({
    indexerUrl: 'https://indexer.example',
    timeoutMs: 5000,
    pandoraMarketAddress: TEST_MARKET,
    polymarketMarketId: 'poly-1',
    polymarketSlug: 'arsenal',
    trustDeploy: true,
  });
  assert.equal(verifyRequest.allowRuleMismatch, false);
  assert.equal(verifyRequest.includeSimilarity, false);

  const metrics = evaluateSnapshot(
    {
      sourceMarket: { yesPct: 62.5 },
      pandora: { yesPct: 55, reserveYes: 12.25, reserveNo: 7.75 },
      expiry: { minTimeToExpirySec: 7200 },
    },
    { driftTriggerBps: 150 },
  );
  assert.equal(metrics.driftBps, 750);
  assert.equal(metrics.reserveTotalUsdc, 20);
  assert.equal(metrics.targetHedgeUsdc, -4.5);

  const plan = buildTickPlan({
    snapshotMetrics: metrics,
    state: { currentHedgeUsdc: -1 },
    options: {
      hedgeEnabled: true,
      hedgeTriggerUsdc: 0.5,
      hedgeRatio: 1,
      maxHedgeUsdc: 20,
      maxRebalanceUsdc: 15,
    },
  });
  assert.equal(plan.hedgeTriggered, true);
  assert.equal(plan.plannedHedgeUsdc, 3.5);
  assert.equal(plan.hedgeTokenSide, 'no');

  const snapshot = buildTickSnapshot({
    iteration: 2,
    tickAt: new Date('2026-03-01T10:00:00.000Z'),
    verifyPayload: { matchConfidence: 0.99, gateResult: { ok: true } },
    options: { hedgeEnabled: true, hedgeRatio: 1 },
    snapshotMetrics: metrics,
    plan,
    depth: { depthWithinSlippageUsd: 1000, yesDepth: { depthUsd: 900 }, noDepth: { depthUsd: 800 } },
    gate: { ok: true, failedChecks: [] },
  });
  assert.equal(snapshot.iteration, 2);
  assert.equal(snapshot.actionPlan.hedgeUsdc, 3.5);
  assert.equal(snapshot.metrics.reserveTotalUsdc, 20);
});

test('mirror sync execution/state helpers keep deterministic ids and identity merge', () => {
  const keyA = buildIdempotencyKey(
    {
      pandoraMarketAddress: TEST_MARKET,
      polymarketMarketId: 'poly-1',
      cooldownMs: 60_000,
    },
    {
      metrics: { driftTriggered: true, hedgeTriggered: false },
      actionPlan: { rebalanceSide: 'yes', hedgeTokenSide: null, rebalanceUsdc: 2, hedgeUsdc: 0 },
    },
    1_700_000_000_000,
  );
  const keyB = buildIdempotencyKey(
    {
      pandoraMarketAddress: TEST_MARKET,
      polymarketMarketId: 'poly-1',
      cooldownMs: 60_000,
    },
    {
      metrics: { driftTriggered: true, hedgeTriggered: false },
      actionPlan: { rebalanceSide: 'yes', hedgeTokenSide: null, rebalanceUsdc: 2, hedgeUsdc: 0 },
    },
    1_700_000_000_010,
  );
  assert.equal(keyA, keyB);

  const state = {
    pandoraMarketAddress: null,
    polymarketMarketId: null,
    polymarketSlug: null,
  };
  ensureStateIdentity(state, {
    pandoraMarketAddress: TEST_MARKET,
    polymarketMarketId: 'poly-1',
    polymarketSlug: 'arsenal',
  });
  assert.equal(state.pandoraMarketAddress, TEST_MARKET);
  assert.equal(state.polymarketMarketId, 'poly-1');
  assert.equal(state.polymarketSlug, 'arsenal');
});

test('MIRROR_SYNC_GATE_CODES remains stable and complete', () => {
  assert.equal(Array.isArray(MIRROR_SYNC_GATE_CODES), true);
  assert.equal(MIRROR_SYNC_GATE_CODES.includes('DEPTH_COVERAGE'), true);
  assert.equal(MIRROR_SYNC_GATE_CODES.includes('MAX_TRADES_PER_DAY'), true);
});

test('createParseMirrorGoFlags parses selective --skip-gate lists', () => {
  const parseMirrorGoFlags = createParseMirrorGoFlags(buildParserDeps());

  const options = parseMirrorGoFlags([
    '--polymarket-market-id',
    'poly-1',
    '--skip-gate',
    'close_time_delta,oracle_price_drift',
  ]);

  assert.equal(options.forceGate, false);
  assert.deepEqual(options.skipGateChecks, ['CLOSE_TIME_DELTA', 'ORACLE_PRICE_DRIFT']);
});

test('createParseMirrorGoFlags treats bare --skip-gate as force gate mode', () => {
  const parseMirrorGoFlags = createParseMirrorGoFlags(buildParserDeps());

  const options = parseMirrorGoFlags([
    '--polymarket-market-id',
    'poly-1',
    '--skip-gate',
  ]);

  assert.equal(options.forceGate, true);
  assert.deepEqual(options.skipGateChecks, []);
});

test('createParseMirrorGoFlags rejects explicit empty or underspecified --sources early', () => {
  const parseMirrorGoFlags = createParseMirrorGoFlags(buildParserDeps());

  assert.throws(
    () =>
      parseMirrorGoFlags([
        '--polymarket-market-id',
        'poly-1',
        '--sources',
        '',
      ]),
    (error) => {
      assert.equal(error.code, 'INVALID_FLAG_VALUE');
      assert.match(error.message, /at least two non-empty urls/i);
      return true;
    },
  );

  assert.throws(
    () =>
      parseMirrorGoFlags([
        '--polymarket-market-id',
        'poly-1',
        '--sources',
        'https://example.com/one',
      ]),
    (error) => {
      assert.equal(error.code, 'INVALID_FLAG_VALUE');
      return true;
    },
  );
});

test('createParseMirrorGoFlags parses explicit --target-timestamp overrides', () => {
  const parseMirrorGoFlags = createParseMirrorGoFlags(buildParserDeps());

  const options = parseMirrorGoFlags([
    '--polymarket-market-id',
    'poly-1',
    '--target-timestamp',
    '2030-03-10T04:00:00Z',
  ]);

  assert.equal(options.targetTimestamp, Math.floor(Date.parse('2030-03-10T04:00:00Z') / 1000));
});

test('createParseLifecycleFlags validates start|status|resolve contracts', () => {
  const parseLifecycleFlags = createParseLifecycleFlags({
    CliError: ParserCliError,
    requireFlagValue: parserRequireFlagValue,
  });

  const startOptions = parseLifecycleFlags(['start', '--config', './lifecycle.json']);
  assert.equal(startOptions.action, 'start');
  assert.equal(startOptions.configPath, './lifecycle.json');
  assert.equal(startOptions.id, null);

  const statusOptions = parseLifecycleFlags(['status', '--id', 'lc-123']);
  assert.equal(statusOptions.action, 'status');
  assert.equal(statusOptions.id, 'lc-123');
  assert.equal(statusOptions.confirm, false);

  const resolveOptions = parseLifecycleFlags(['resolve', '--id', 'lc-123', '--confirm']);
  assert.equal(resolveOptions.action, 'resolve');
  assert.equal(resolveOptions.id, 'lc-123');
  assert.equal(resolveOptions.confirm, true);
});

test('createParseLifecycleFlags requires explicit --confirm on resolve', () => {
  const parseLifecycleFlags = createParseLifecycleFlags({
    CliError: ParserCliError,
    requireFlagValue: parserRequireFlagValue,
  });

  assert.throws(
    () => parseLifecycleFlags(['resolve', '--id', 'lc-123']),
    (error) => {
      assert.equal(error.code, 'MISSING_REQUIRED_FLAG');
      assert.match(error.message, /requires --confirm/i);
      return true;
    },
  );
});

test('createParseOddsFlags rejects insecure remote URLs for connector hosts', () => {
  const parseOddsFlags = createParseOddsFlags({
    CliError: ParserCliError,
    requireFlagValue: parserRequireFlagValue,
    parsePositiveInteger: parserParsePositiveInteger,
    parseCsvList: (value) => String(value).split(',').map((item) => item.trim()).filter(Boolean),
    isSecureHttpUrlOrLocal: parserIsSecureHttpUrlOrLocal,
  });

  assert.throws(
    () => parseOddsFlags([
      'record',
      '--competition',
      'soccer_epl',
      '--interval',
      '60',
      '--polymarket-host',
      'http://example.com',
    ]),
    (error) => {
      assert.equal(error.code, 'INVALID_FLAG_VALUE');
      assert.match(error.message, /--polymarket-host must use https/i);
      return true;
    },
  );
});

test('createParseOddsFlags accepts secure/localhost connector URLs', () => {
  const parseOddsFlags = createParseOddsFlags({
    CliError: ParserCliError,
    requireFlagValue: parserRequireFlagValue,
    parsePositiveInteger: parserParsePositiveInteger,
    parseCsvList: (value) => String(value).split(',').map((item) => item.trim()).filter(Boolean),
    isSecureHttpUrlOrLocal: parserIsSecureHttpUrlOrLocal,
  });

  const parsed = parseOddsFlags([
    'record',
    '--competition',
    'soccer_epl',
    '--interval',
    '60',
    '--polymarket-host',
    'https://clob.polymarket.com',
    '--polymarket-mock-url',
    'http://127.0.0.1:7777',
  ]);

  assert.equal(parsed.action, 'record');
  assert.equal(parsed.options.polymarketHost, 'https://clob.polymarket.com');
  assert.equal(parsed.options.polymarketMockUrl, 'http://127.0.0.1:7777');
});

test('arb scan helpers parse ndjson options and emit deterministic spread math', () => {
  const options = parseArbScanFlags(
    [
      'scan',
      '--markets',
      'm1,m2,m3',
      '--output',
      'ndjson',
      '--min-net-spread-pct',
      '3',
      '--fee-pct-per-leg',
      '0.5',
      '--amount-usdc',
      '200',
      '--iterations',
      '2',
      '--interval-ms',
      '1000',
    ],
    {
      CliError: ParserCliError,
      requireFlagValue: parserRequireFlagValue,
      parseCsvList: (value) => value.split(',').map((item) => item.trim()).filter(Boolean),
      parseNumber: parserParseNumber,
      parsePositiveNumber: parserParsePositiveNumber,
      parsePositiveInteger: parserParsePositiveInteger,
    },
  );

  assert.deepEqual(options.markets, ['m1', 'm2', 'm3']);
  assert.equal(options.output, 'ndjson');
  assert.equal(options.minNetSpreadPct, 3);
  assert.equal(options.feePctPerLeg, 0.5);

  const opportunities = buildArbOpportunities({
    marketSnapshots: [
      { id: 'm1', yesPct: 40 },
      { id: 'm2', yesPct: 52 },
      { id: 'm3', yesPct: 49 },
    ],
    minNetSpreadPct: 3,
    feePctPerLeg: 0.5,
    amountUsdc: 200,
  });

  assert.equal(opportunities.length, 2);
  assert.equal(opportunities[0].pair, 'm1|m2');
  assert.equal(opportunities[0].grossSpreadPct, 12);
  assert.equal(opportunities[0].netSpreadPct, 11);
  assert.equal(opportunities[0].profitUsdc, 22);
});

test('createParseMirrorSyncFlags supports --market-address alias, small close windows, and strict close delta mode', () => {
  let capturedDefaultStateInput = null;
  const parseMirrorSyncFlags = createParseMirrorSyncFlags(
    buildParserDeps({
      defaultMirrorStateFile: (input) => {
        capturedDefaultStateInput = input;
        return '/tmp/mirror-state.json';
      },
      defaultMirrorKillSwitchFile: () => '/tmp/mirror-stop',
    }),
  );

  const options = parseMirrorSyncFlags([
    'run',
    '--market-address',
    TEST_MARKET,
    '--polymarket-market-id',
    'poly-1',
    '--min-time-to-close-sec',
    '5',
    '--strict-close-time-delta',
    '--skip-gate',
    'close_time_delta,oracle_price_drift',
  ]);

  assert.equal(options.pandoraMarketAddress, TEST_MARKET);
  assert.equal(options.minTimeToCloseSec, 5);
  assert.equal(options.strictCloseTimeDelta, true);
  assert.equal(options.forceGate, false);
  assert.deepEqual(options.skipGateChecks, ['CLOSE_TIME_DELTA', 'ORACLE_PRICE_DRIFT']);
  assert.equal(options.stateFile, '/tmp/mirror-state.json');
  assert.equal(options.killSwitchFile, '/tmp/mirror-stop');
  assert.equal(capturedDefaultStateInput.strictCloseTimeDelta, true);
  assert.equal(capturedDefaultStateInput.forceGate, false);
  assert.deepEqual(capturedDefaultStateInput.skipGateChecks, ['CLOSE_TIME_DELTA', 'ORACLE_PRICE_DRIFT']);
});

test('createParseMirrorSyncFlags defaults to atomic on-chain pricing and accepts explicit sizing controls', () => {
  const parseMirrorSyncFlags = createParseMirrorSyncFlags(
    buildParserDeps({
      defaultMirrorStateFile: () => '/tmp/mirror-state.json',
      defaultMirrorKillSwitchFile: () => '/tmp/mirror-stop',
    }),
  );

  const defaults = parseMirrorSyncFlags([
    'once',
    '--market-address',
    TEST_MARKET,
    '--polymarket-market-id',
    'poly-1',
    '--paper',
  ]);
  assert.equal(defaults.rebalanceSizingMode, 'atomic');
  assert.equal(defaults.priceSource, 'on-chain');

  const explicit = parseMirrorSyncFlags([
    'once',
    '--market-address',
    TEST_MARKET,
    '--polymarket-market-id',
    'poly-1',
    '--paper',
    '--rebalance-mode',
    'incremental',
    '--price-source',
    'indexer',
  ]);
  assert.equal(explicit.rebalanceSizingMode, 'incremental');
  assert.equal(explicit.priceSource, 'indexer');
});

test('createParseMirrorGoFlags defaults to atomic on-chain pricing and accepts explicit sizing controls', () => {
  const parseMirrorGoFlags = createParseMirrorGoFlags(buildParserDeps());

  const defaults = parseMirrorGoFlags([
    '--polymarket-market-id',
    'poly-1',
    '--paper',
  ]);
  assert.equal(defaults.rebalanceSizingMode, 'atomic');
  assert.equal(defaults.priceSource, 'on-chain');

  const explicit = parseMirrorGoFlags([
    '--polymarket-market-id',
    'poly-1',
    '--paper',
    '--rebalance-mode',
    'incremental',
    '--price-source',
    'indexer',
  ]);
  assert.equal(explicit.rebalanceSizingMode, 'incremental');
  assert.equal(explicit.priceSource, 'indexer');

  const safety = parseMirrorGoFlags([
    '--polymarket-market-id',
    'poly-1',
    '--paper',
    '--depth-slippage-bps',
    '250',
    '--min-time-to-close-sec',
    '5',
    '--strict-close-time-delta',
  ]);
  assert.equal(safety.depthSlippageBps, 250);
  assert.equal(safety.minTimeToCloseSec, 5);
  assert.equal(safety.strictCloseTimeDelta, true);
});

test('createParseMirrorSyncFlags accepts comma-delimited --rpc-url fallback lists', () => {
  const parseMirrorSyncFlags = createParseMirrorSyncFlags(
    buildParserDeps({
      defaultMirrorStateFile: () => '/tmp/mirror-state.json',
      defaultMirrorKillSwitchFile: () => '/tmp/mirror-stop',
    }),
  );

  const options = parseMirrorSyncFlags([
    'run',
    '--market-address',
    TEST_MARKET,
    '--polymarket-market-id',
    'poly-1',
    '--paper',
    '--rpc-url',
    'https://mainnet.example, https://backup.example,https://mainnet.example',
  ]);

  assert.equal(options.rpcUrl, 'https://mainnet.example,https://backup.example');
});

test('createParseMirrorSyncDaemonSelectorFlags normalizes strategy hash', () => {
  const parseMirrorSyncDaemonSelectorFlags = createParseMirrorSyncDaemonSelectorFlags(
    buildParserDeps(),
  );

  const options = parseMirrorSyncDaemonSelectorFlags(
    ['--strategy-hash', 'ABCDEF0123456789'],
    'status',
  );

  assert.equal(options.strategyHash, 'abcdef0123456789');
  assert.equal(options.pidFile, null);
});

test('createRunMirrorCommand routes status through shared parser output', async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-status-unit-home-'));
  const previousHome = process.env.HOME;
  const observed = {
    parseIndexerArgs: null,
    parseStatusArgs: null,
    maybeLoadIndexerEnvCalls: 0,
    maybeLoadTradeEnvCalls: 0,
    emitted: [],
  };
  const shared = {
    envFile: '/tmp/.env',
    envFileExplicit: true,
    useEnvFile: true,
    indexerUrl: 'https://indexer.test',
    timeoutMs: 4321,
    rest: ['--strategy-hash', '0123456789abcdef'],
  };
  const runMirrorCommand = createRunMirrorCommand({
    CliError: ParserCliError,
    emitSuccess: (...args) => observed.emitted.push(args),
    commandHelpPayload: (usage) => ({ usage }),
    parseIndexerSharedFlags: (args) => {
      observed.parseIndexerArgs = args;
      return shared;
    },
    includesHelpFlag: () => false,
    maybeLoadIndexerEnv: (value) => {
      observed.maybeLoadIndexerEnvCalls += 1;
      assert.equal(value, shared);
    },
    maybeLoadTradeEnv: () => {
      observed.maybeLoadTradeEnvCalls += 1;
    },
    parseMirrorStatusFlags: (args) => {
      observed.parseStatusArgs = args;
      return {
        stateFile: null,
        strategyHash: '0123456789abcdef',
        withLive: false,
        trustDeploy: false,
        manifestFile: null,
        pandoraMarketAddress: null,
        polymarketMarketId: null,
        polymarketSlug: null,
        driftTriggerBps: 150,
        hedgeTriggerUsdc: 10,
        indexerUrl: null,
        timeoutMs: 0,
        polymarketHost: null,
        polymarketGammaUrl: null,
        polymarketGammaMockUrl: null,
        polymarketMockUrl: null,
      };
    },
    resolveTrustedDeployPair: () => {
      throw new Error('resolveTrustedDeployPair should not be called in this test.');
    },
    resolveIndexerUrl: (url) => url || 'https://default-indexer.test',
    verifyMirror: async () => {
      throw new Error('verifyMirror should not be called in this test.');
    },
    coerceMirrorServiceError: (error) => error,
    toMirrorStatusLivePayload: async () => {
      throw new Error('toMirrorStatusLivePayload should not be called in this test.');
    },
    renderMirrorStatusTable: () => {},
  });

  try {
    process.env.HOME = tempHome;
    await runMirrorCommand(
      ['status', '--dotenv-path', '/tmp/.env', '--strategy-hash', '0123456789abcdef'],
      { outputMode: 'json' },
    );

    assert.deepEqual(observed.parseIndexerArgs, [
      '--dotenv-path',
      '/tmp/.env',
      '--strategy-hash',
      '0123456789abcdef',
    ]);
    assert.deepEqual(observed.parseStatusArgs, shared.rest);
    assert.equal(observed.maybeLoadIndexerEnvCalls, 1);
    assert.equal(observed.maybeLoadTradeEnvCalls, 0);
    assert.equal(observed.emitted.length, 1);
    assert.equal(observed.emitted[0][1], 'mirror.status');
    assert.equal(observed.emitted[0][2].runtime.health.status, 'idle');
    assert.equal(observed.emitted[0][2].runtime.daemon.found, false);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('buildMirrorRuntimeTelemetry reads daemon metadata for mirror status dashboard', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-runtime-home-'));
  const previousHome = process.env.HOME;
  const strategyHash = 'feedfacecafebeef';
  const stateFile = path.join(tempHome, '.pandora', 'mirror', `${strategyHash}.json`);
  const pidFile = path.join(tempHome, '.pandora', 'mirror', 'daemon', `${strategyHash}.json`);

  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(
    pidFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash,
        pid: process.pid,
        pidAlive: true,
        status: 'running',
        checkedAt: '2026-03-09T00:00:00.000Z',
        startedAt: '2026-03-08T23:55:00.000Z',
        stateFile,
        logFile: path.join(tempHome, '.pandora', 'mirror', 'logs', `${strategyHash}.log`),
      },
      null,
      2,
    ),
  );

  try {
    process.env.HOME = tempHome;
    const telemetry = buildMirrorRuntimeTelemetry({
      stateFile,
      state: {
        strategyHash,
        lastTickAt: new Date().toISOString(),
      },
    });

    assert.equal(telemetry.health.status, 'running');
    assert.equal(telemetry.daemon.found, true);
    assert.equal(telemetry.daemon.alive, true);
    assert.equal(telemetry.daemon.strategyHash, strategyHash);
    assert.equal(telemetry.daemon.pid, process.pid);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('buildMirrorRuntimeTelemetry exposes direct operator health fields for daemon status', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-runtime-summary-'));
  const stateFile = path.join(tempDir, 'mirror-state.json');

  try {
    const telemetry = buildMirrorRuntimeTelemetry({
      stateFile,
      now: new Date('2026-03-09T00:05:20.000Z'),
      daemonStatus: {
        found: true,
        alive: true,
        status: 'running',
        strategyHash: 'summary-hash',
        pid: process.pid,
        metadata: {
          checkedAt: '2026-03-09T00:05:10.000Z',
          startedAt: '2026-03-08T22:05:10.000Z',
          stateFile,
        },
      },
      state: {
        strategyHash: 'summary-hash',
        lastTickAt: '2026-03-09T00:05:15.000Z',
        lastExecution: {
          mode: 'live',
          status: 'executed',
          idempotencyKey: 'live-trade-1',
          startedAt: '2026-03-09T00:04:00.000Z',
          completedAt: '2026-03-09T00:04:30.000Z',
          rebalance: {
            side: 'yes',
            amountUsdc: 125,
          },
          hedge: {
            tokenSide: 'no',
            amountUsdc: 80,
          },
        },
        alerts: [
          {
            level: 'warn',
            code: 'HEARTBEAT_SLOW',
            message: 'Heartbeat lagged once.',
            count: 2,
            timestamp: '2026-03-09T00:04:45.000Z',
          },
          {
            level: 'error',
            code: 'HEDGE_EXECUTION_FAILED',
            message: 'Most recent hedge failed.',
            count: 3,
            timestamp: '2026-03-09T00:05:00.000Z',
          },
        ],
      },
    });

    assert.equal(telemetry.health.status, 'degraded');
    assert.equal(telemetry.errorCount, 3);
    assert.equal(telemetry.warningCount, 2);
    assert.equal(telemetry.summary.errorCount, 3);
    assert.equal(telemetry.summary.warningCount, 2);
    assert.equal(telemetry.nextAction.code, 'INSPECT_LAST_ERROR');
    assert.equal(telemetry.summary.nextAction.code, 'INSPECT_LAST_ERROR');
    assert.equal(telemetry.lastTrade.status, 'executed');
    assert.equal(telemetry.lastTrade.completedAt, '2026-03-09T00:04:30.000Z');
    assert.equal(telemetry.summary.lastTradeAt, '2026-03-09T00:04:30.000Z');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('handleMirrorDashboard summarizes actionable markets while degrading per-market live failures', async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pandora-mirror-dashboard-home-'));
  const previousHome = process.env.HOME;
  const stateDir = path.join(tempHome, '.pandora', 'mirror');
  const alphaMarket = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const betaMarket = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const alphaStateFile = path.join(stateDir, 'alpha.json');
  const betaStateFile = path.join(stateDir, 'beta.json');
  const observed = {
    emitted: [],
    verifiedSelectors: [],
  };

  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    alphaStateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'alpha-hash',
        pandoraMarketAddress: alphaMarket,
        polymarketMarketId: 'poly-alpha',
        currentHedgeUsdc: 5,
        alerts: [
          {
            level: 'warn',
            code: 'SOURCE_STALE',
            message: 'Source feed lagged once.',
            count: 1,
            timestamp: '2026-03-09T00:04:00.000Z',
          },
        ],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    betaStateFile,
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        strategyHash: 'beta-hash',
        pandoraMarketAddress: betaMarket,
        polymarketMarketId: 'poly-beta',
        alerts: [
          {
            level: 'error',
            code: 'MANUAL_REVIEW_REQUIRED',
            message: 'Previous sync requires manual review.',
            count: 1,
            timestamp: '2026-03-09T00:05:00.000Z',
          },
        ],
        lastExecution: {
          mode: 'live',
          status: 'failed',
          requiresManualReview: true,
          startedAt: '2026-03-09T00:04:30.000Z',
          completedAt: '2026-03-09T00:05:00.000Z',
        },
      },
      null,
      2,
    ),
  );

  try {
    process.env.HOME = tempHome;
    await handleMirrorDashboard({
      actionArgs: ['--with-live'],
      shared: {
        timeoutMs: 5000,
        indexerUrl: 'https://indexer.example',
      },
      context: {
        outputMode: 'json',
      },
      deps: {
        CliError: ParserCliError,
        includesHelpFlag: () => false,
        emitSuccess: (...args) => observed.emitted.push(args),
        commandHelpPayload: () => {
          throw new Error('commandHelpPayload should not run in live dashboard mode');
        },
        maybeLoadIndexerEnv: () => {},
        maybeLoadTradeEnv: () => {},
        resolveIndexerUrl: (value) => value || 'https://indexer.example',
        resolveTrustedDeployPair: () => {
          throw new Error('resolveTrustedDeployPair should not run without --trust-deploy');
        },
        verifyMirror: async (options) => {
          observed.verifiedSelectors.push([options.pandoraMarketAddress, options.polymarketMarketId]);
          if (options.polymarketMarketId === 'poly-beta') {
            const error = new Error('source unavailable');
            error.code = 'MIRROR_VERIFY_FAILED';
            throw error;
          }
          return {
            sourceMarket: {
              marketId: options.polymarketMarketId,
              question: 'Alpha mirror market',
            },
            pandora: {
              marketAddress: options.pandoraMarketAddress,
            },
          };
        },
        toMirrorStatusLivePayload: async (verifyPayload, state) => ({
          crossVenue: {
            status: 'attention',
          },
          actionability: {
            status: 'action-needed',
            recommendedAction: 'rebalance-yes',
          },
          netPnlApproxUsdc: 1.25,
          pnlApprox: 9.5,
          driftBps: 1900,
          driftTriggerBps: 150,
          targetHedgeUsdc: 0,
          currentHedgeUsdc: Number(state.currentHedgeUsdc || 0),
          hedgeGapUsdc: -5,
          hedgeTriggerUsdc: 10,
          hedgeStatus: {
            hedgeGapUsdc: -5,
            triggered: false,
          },
          sourceMarket: {
            marketId: verifyPayload.sourceMarket.marketId,
            question: verifyPayload.sourceMarket.question,
          },
          pandoraMarket: {
            marketAddress: verifyPayload.pandora.marketAddress,
          },
        }),
      },
    });

    assert.equal(observed.emitted.length, 1);
    assert.equal(observed.emitted[0][1], 'mirror.dashboard');
    assert.deepEqual(observed.verifiedSelectors, [
      [alphaMarket, 'poly-alpha'],
      [betaMarket, 'poly-beta'],
    ]);

    const payload = observed.emitted[0][2];
    assert.equal(payload.summary.marketCount, 2);
    assert.equal(payload.summary.liveCount, 1);
    assert.equal(payload.summary.actionNeededCount, 1);
    assert.equal(payload.summary.manualReviewCount, 1);
    assert.equal(payload.summary.alertCount, 2);
    assert.equal(payload.summary.totalNetPnlApproxUsdc, 1.25);

    const alphaItem = payload.items.find((item) => item.strategyHash === 'alpha-hash');
    const betaItem = payload.items.find((item) => item.strategyHash === 'beta-hash');

    assert.equal(alphaItem.liveAvailable, true);
    assert.equal(alphaItem.question, 'Alpha mirror market');
    assert.equal(alphaItem.actionability.recommendedAction, 'rebalance-yes');
    assert.equal(betaItem.liveAvailable, false);
    assert.equal(betaItem.alertSummary.requiresManualReview, true);
    assert.equal(
      betaItem.diagnostics.some((entry) => String(entry).includes('MIRROR_VERIFY_FAILED: source unavailable')),
      true,
    );
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('createRunMirrorCommand sync help reports full usage and daemon selectors', async () => {
  const observed = {
    emitted: [],
  };
  const runMirrorCommand = createRunMirrorCommand({
    CliError: ParserCliError,
    emitSuccess: (...args) => observed.emitted.push(args),
    commandHelpPayload: (usage) => ({ usage }),
    parseIndexerSharedFlags: (args) => ({
      envFile: '/tmp/.env',
      envFileExplicit: false,
      useEnvFile: true,
      indexerUrl: null,
      timeoutMs: 12000,
      rest: args,
    }),
    includesHelpFlag: (args) => Array.isArray(args) && args.includes('--help'),
  });

  await runMirrorCommand(['sync', '--help'], { outputMode: 'json' });

  assert.equal(observed.emitted.length, 1);
  assert.equal(observed.emitted[0][1], 'mirror.sync.help');
  const payload = observed.emitted[0][2];
  assert.match(payload.usage, /mirror sync once\|run\|start/);
  assert.match(payload.usage, /--telegram-chat-id <id>/);
  assert.match(payload.daemonLifecycle.stop, /--pid-file <path>\|--strategy-hash <hash>/);
  assert.match(payload.daemonLifecycle.status, /--pid-file <path>\|--strategy-hash <hash>/);
});

test('createRunMirrorCommand trace help reports historical block selectors and archive guidance', async () => {
  const observed = {
    emitted: [],
  };
  const runMirrorCommand = createRunMirrorCommand({
    CliError: ParserCliError,
    emitSuccess: (...args) => observed.emitted.push(args),
    commandHelpPayload: (usage, notes) => ({ usage, notes }),
    parseIndexerSharedFlags: (args) => ({
      envFile: '/tmp/.env',
      envFileExplicit: false,
      useEnvFile: true,
      indexerUrl: null,
      timeoutMs: 12000,
      rest: args,
    }),
    includesHelpFlag: (args) => Array.isArray(args) && args.includes('--help'),
    parseMirrorTraceFlags: () => {
      throw new Error('parseMirrorTraceFlags should not run for --help');
    },
  });

  await runMirrorCommand(['trace', '--help'], { outputMode: 'json' });

  assert.equal(observed.emitted.length, 1);
  assert.equal(observed.emitted[0][1], 'mirror.trace.help');
  const payload = observed.emitted[0][2];
  assert.match(payload.usage, /mirror trace/);
  assert.match(payload.usage, /--blocks <csv>/);
  assert.match(payload.usage, /--from-block <n> --to-block <n>/);
  assert.equal(Array.isArray(payload.notes), true);
  assert.equal(payload.notes.some((line) => /archive/i.test(String(line))), true);
});

test('createRunMirrorCommand help lists trace, drift, and hedge-check read surfaces', async () => {
  const observed = {
    emitted: [],
  };
  const runMirrorCommand = createRunMirrorCommand({
    CliError: ParserCliError,
    emitSuccess: (...args) => observed.emitted.push(args),
    commandHelpPayload: (usage, notes) => ({ usage, notes }),
    parseIndexerSharedFlags: (args) => ({
      envFile: '/tmp/.env',
      envFileExplicit: false,
      useEnvFile: true,
      indexerUrl: null,
      timeoutMs: 12000,
      rest: args,
    }),
    includesHelpFlag: (args) => Array.isArray(args) && args.includes('--help'),
  });

  await runMirrorCommand(['--help'], { outputMode: 'json' });

  assert.equal(observed.emitted.length, 1);
  assert.equal(observed.emitted[0][1], 'mirror.help');
  const payload = observed.emitted[0][2];
  assert.match(payload.usage, /sync\|trace\|dashboard\|status\|health\|panic\|drift\|hedge-check\|pnl/);
  assert.equal(Array.isArray(payload.notes), true);
  assert.equal(
    payload.notes.some((line) => /mirror trace/i.test(String(line))),
    true,
  );
  assert.equal(
    payload.notes.some((line) => /mirror drift and mirror hedge-check/.test(String(line))),
    true,
  );
  assert.equal(
    payload.notes.some((line) => /mirror health is the machine-usable daemon\/runtime status shell/i.test(String(line))),
    true,
  );
});

test('createParsePolymarketPositionsFlags parses selectors and shared runtime flags', () => {
  const parseShared = createParsePolymarketSharedFlags({
    CliError: ParserCliError,
    requireFlagValue: parserRequireFlagValue,
    parseAddressFlag: parserParseAddressFlag,
    parseInteger: parserParseInteger,
    isValidPrivateKey: (value) => /^0x[a-fA-F0-9]{64}$/.test(String(value || '').trim()),
    isSecureHttpUrlOrLocal: parserIsSecureHttpUrlOrLocal,
  });
  const parsePositions = createParsePolymarketPositionsFlags({
    CliError: ParserCliError,
    parsePolymarketSharedFlags: parseShared,
    requireFlagValue: parserRequireFlagValue,
    parseAddressFlag: parserParseAddressFlag,
    parsePositiveInteger: parserParsePositiveInteger,
    isSecureHttpUrlOrLocal: parserIsSecureHttpUrlOrLocal,
    defaultTimeoutMs: 12000,
  });

  const payload = parsePositions([
    '--wallet',
    '0x1111111111111111111111111111111111111111',
    '--token-id',
    '101,102',
    '--source',
    'on-chain',
    '--polymarket-data-api-url',
    'https://data-api.example',
    '--polymarket-host',
    'https://clob.example',
    '--polymarket-gamma-url',
    'https://gamma.example',
    '--timeout-ms',
    '3000',
    '--fork',
    '--fork-rpc-url',
    'http://127.0.0.1:8545',
    '--private-key',
    `0x${'1'.repeat(64)}`,
    '--funder',
    '0x2222222222222222222222222222222222222222',
  ]);

  assert.equal(payload.wallet, '0x1111111111111111111111111111111111111111');
  assert.equal(payload.conditionId, null);
  assert.deepEqual(payload.tokenIds, ['101', '102']);
  assert.equal(payload.source, 'on-chain');
  assert.equal(payload.dataApiUrl, 'https://data-api.example');
  assert.equal(payload.host, 'https://clob.example');
  assert.equal(payload.gammaUrl, 'https://gamma.example');
  assert.equal(payload.timeoutMs, 3000);
  assert.equal(payload.fork, true);
  assert.equal(payload.forkRpcUrl, 'http://127.0.0.1:8545');
  assert.equal(payload.funder, '0x2222222222222222222222222222222222222222');
});

test('fetchPolymarketPositionInventory normalizes mock API rows with provenance', async () => {
  const conditionId = `0x${'b'.repeat(64)}`;
  const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      positions: [
        {
          asset: '101',
          conditionId,
          size: 1.5,
          curPrice: 0.62,
          outcome: 'YES',
          question: 'Will BTC close above $100k?',
        },
        {
          asset: '102',
          conditionId,
          size: 0.25,
          curPrice: 0.38,
          outcome: 'NO',
          question: 'Will BTC close above $100k?',
        },
      ],
      openOrders: [
        {
          id: 'ord-1',
          market: conditionId,
          asset_id: '101',
          side: 'buy',
          price: 0.61,
          size: 1.2,
        },
      ],
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const mockUrl = `http://127.0.0.1:${address.port}`;

  try {
    const payload = await fetchPolymarketPositionInventory({
      walletAddress: '0x3333333333333333333333333333333333333333',
      market: {
        marketId: conditionId,
        slug: 'btc-above-100k',
        question: 'Will BTC close above $100k?',
        yesTokenId: '101',
        noTokenId: '102',
        yesPct: 62,
        noPct: 38,
      },
      source: 'api',
      mockUrl,
      timeoutMs: 3000,
    });

    assert.equal(payload.source, 'api');
    assert.equal(payload.market.marketId, conditionId);
    assert.equal(payload.summary.yesBalance, 1.5);
    assert.equal(payload.summary.noBalance, 0.25);
    assert.equal(payload.summary.openOrdersCount, 1);
    assert.equal(payload.summary.estimatedValueUsd, 1.025);
    assert.equal(payload.positions.length, 2);
    assert.equal(payload.positions[0].fieldSources.balance, 'api');
    assert.equal(payload.openOrders[0].tokenId, '101');
    assert.equal(payload.diagnostics.includes('Loaded Polymarket position inventory from mock payload.'), true);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('createRunPolymarketCommand routes positions through the ops service payload', async () => {
  const observed = { emitted: [] };
  const runPolymarketCommand = createRunPolymarketCommand({
    CliError: ParserCliError,
    includesHelpFlag: (args) => Array.isArray(args) && args.includes('--help'),
    emitSuccess: (...args) => observed.emitted.push(args),
    commandHelpPayload: (usage, notes) => ({ usage, notes }),
    loadEnvIfPresent: () => {},
    parsePolymarketSharedFlags: () => ({}),
    parsePolymarketApproveFlags: () => {
      throw new Error('not used');
    },
    parsePolymarketPositionsFlags: () => ({
      wallet: '0x1111111111111111111111111111111111111111',
      conditionId: `0x${'c'.repeat(64)}`,
      slug: null,
      tokenIds: ['101', '102'],
      source: 'auto',
      dataApiUrl: null,
      rpcUrl: null,
      privateKey: null,
      funder: null,
      host: 'https://clob.example',
      gammaUrl: null,
      polymarketMockUrl: 'https://mock.example',
      timeoutMs: 12000,
      fork: false,
      forkRpcUrl: null,
      forkChainId: null,
    }),
    parsePolymarketTradeFlags: () => {
      throw new Error('not used');
    },
    resolveForkRuntime: () => ({ mode: 'live', chainId: 137, rpcUrl: null }),
    isSecureHttpUrlOrLocal: parserIsSecureHttpUrlOrLocal,
    runPolymarketCheck: async () => ({}),
    runPolymarketApprove: async () => ({}),
    runPolymarketPreflight: async () => ({}),
    runPolymarketPositions: async () => ({
      action: 'positions',
      summary: { yesBalance: 2, noBalance: 1, openOrdersCount: 0, estimatedValueUsd: 1.62 },
      positions: [{ tokenId: '101', outcome: 'yes', balance: 2 }],
      openOrders: [],
      runtime: {},
      diagnostics: [],
    }),
    resolvePolymarketMarket: async () => ({}),
    readTradingCredsFromEnv: () => ({}),
    placeHedgeOrder: async () => ({}),
    renderPolymarketCheckTable: () => {},
    renderPolymarketApproveTable: () => {},
    renderPolymarketPreflightTable: () => {},
    renderSingleEntityTable: () => {},
    defaultEnvFile: '/tmp/.env',
  });

  await runPolymarketCommand(['positions', '--wallet', '0x1111111111111111111111111111111111111111'], { outputMode: 'json' });

  assert.equal(observed.emitted.length, 1);
  assert.equal(observed.emitted[0][1], 'polymarket.positions');
  assert.equal(observed.emitted[0][2].action, 'positions');
  assert.equal(observed.emitted[0][2].summary.yesBalance, 2);
  assert.equal(observed.emitted[0][2].runtime.mode, 'live');
});

test('error recovery service returns hints for all mapped codes', () => {
  const recovery = createErrorRecoveryService({ cliName: 'pandora' });
  const mappedCodes = [
    'TRADE_RISK_GUARD',
    'ALLOWANCE_READ_FAILED',
    'APPROVE_SIMULATION_FAILED',
    'APPROVE_EXECUTION_FAILED',
    'TRADE_EXECUTION_FAILED',
    'POLYMARKET_APPROVE_FAILED',
    'POLYMARKET_PROXY_APPROVAL_REQUIRES_MANUAL_EXECUTION',
    'POLYMARKET_TRADE_FAILED',
    'POLYMARKET_PREFLIGHT_FAILED',
    'POLYMARKET_CHECK_FAILED',
    'POLYMARKET_MARKET_RESOLUTION_FAILED',
    'MIRROR_DEPLOY_FAILED',
    'MIRROR_GO_VERIFY_PENDING',
    'MIRROR_SYNC_FAILED',
    'LIFECYCLE_EXISTS',
    'LIFECYCLE_NOT_FOUND',
    'CONFIG_FILE_NOT_FOUND',
    'ODDS_RECORD_FAILED',
    'ODDS_HISTORY_FAILED',
    'ARB_SCAN_FAILED',
    'SIMULATE_MC_FAILED',
    'SIMULATE_PARTICLE_FILTER_FAILED',
    'SIMULATE_AGENTS_FAILED',
    'MODEL_SCORE_BRIER_FAILED',
    'MODEL_CALIBRATE_FAILED',
    'MODEL_CORRELATION_FAILED',
    'MODEL_DIAGNOSE_FAILED',
    'FORECAST_READ_FAILED',
    'FORECAST_WRITE_FAILED',
    'BRIER_INVALID_INPUT',
    'MCP_FILE_ACCESS_BLOCKED',
    'MCP_EXECUTE_INTENT_REQUIRED',
    'MCP_LONG_RUNNING_MODE_BLOCKED',
    'MCP_TOOL_FAILED',
    'UNKNOWN_TOOL',
    'ERR_RISK_LIMIT',
    'RISK_PANIC_ACTIVE',
    'RISK_KILL_SWITCH_ACTIVE',
    'RISK_GUARDRAIL_BLOCKED',
    'RISK_STATE_READ_FAILED',
    'RISK_STATE_WRITE_FAILED',
    'RISK_STATE_INVALID',
    'MISSING_REQUIRED_FLAG',
    'MISSING_FLAG_VALUE',
    'INVALID_FLAG_VALUE',
    'UNKNOWN_FLAG',
    'INVALID_ARGS',
    'INVALID_USAGE',
    'INVALID_OUTPUT_MODE',
    'UNSUPPORTED_OUTPUT_MODE',
    'UNKNOWN_COMMAND',
  ];

  for (const code of mappedCodes) {
    const result = recovery.getRecoveryForError({ code });
    assert.equal(Boolean(result), true, `Expected recovery hint for ${code}`);
    assert.equal(typeof result.action, 'string');
    assert.equal(result.action.length > 0, true);
    assert.equal(typeof result.command, 'string');
    assert.equal(result.command.length > 0, true);
    assert.equal(typeof result.retryable, 'boolean');
  }
});

test('error recovery service falls through to null for unmapped codes', () => {
  const recovery = createErrorRecoveryService({ cliName: 'pandora' });
  assert.equal(recovery.getRecoveryForError({ code: 'SOME_NEW_CODE' }), null);
  assert.equal(recovery.getRecoveryForError({ code: '' }), null);
  assert.equal(recovery.getRecoveryForError(null), null);
});

test('error recovery service builds deterministic command hints for key flows', () => {
  const recovery = createErrorRecoveryService({ cliName: 'pandora' });

  const tradeRetry = recovery.getRecoveryForError({
    code: 'TRADE_RISK_GUARD',
    details: {
      marketAddress: TEST_MARKET,
      side: 'no',
      amountUsdc: 12.5,
    },
  });
  assert.equal(tradeRetry.command.includes(`--market-address ${TEST_MARKET}`), true);
  assert.equal(tradeRetry.command.includes('--side no'), true);
  assert.equal(tradeRetry.command.includes('--amount-usdc 12.5'), true);

  const mirrorSyncRetry = recovery.getRecoveryForError({ code: 'MIRROR_SYNC_FAILED' });
  assert.equal(mirrorSyncRetry.command, 'pandora mirror sync once --paper --pandora-market-address <address> --polymarket-market-id <id>');

  const mcpRetry = recovery.getRecoveryForError({ code: 'MCP_EXECUTE_INTENT_REQUIRED' });
  assert.equal(mcpRetry.command, 'pandora mcp');

  const lifecycleExists = recovery.getRecoveryForError({
    code: 'LIFECYCLE_EXISTS',
    details: { id: 'lc-abc' },
  });
  assert.equal(lifecycleExists.command, 'pandora lifecycle status --id lc-abc');

  const configMissing = recovery.getRecoveryForError({
    code: 'CONFIG_FILE_NOT_FOUND',
    details: { configPath: '/tmp/lifecycle.json' },
  });
  assert.equal(configMissing.command, 'pandora lifecycle start --config /tmp/lifecycle.json');

  const invalidLifecyclePhase = recovery.getRecoveryForError({
    code: 'LIFECYCLE_INVALID_PHASE',
    details: { id: 'lc-abc' },
  });
  assert.equal(invalidLifecyclePhase.command, 'pandora lifecycle status --id lc-abc');
  assert.equal(invalidLifecyclePhase.retryable, false);

  const oddsHistory = recovery.getRecoveryForError({
    code: 'ODDS_HISTORY_FAILED',
    details: { eventId: 'evt-1' },
  });
  assert.equal(oddsHistory.command, 'pandora odds history --event-id evt-1 --output json');

  const arbRetry = recovery.getRecoveryForError({ code: 'ARB_SCAN_FAILED' });
  assert.equal(arbRetry.command, 'pandora arb scan --markets <market-a>,<market-b> --output json --iterations 1');

  const mirrorSourcesRetry = recovery.getRecoveryForError({
    code: 'MIRROR_SOURCES_REQUIRED',
    details: { planFile: '/tmp/mirror-plan.json', requiredMinimum: 2 },
  });
  assert.equal(
    mirrorSourcesRetry.command,
    'pandora mirror deploy --dry-run --plan-file /tmp/mirror-plan.json --sources <url1> <url2>',
  );
});
