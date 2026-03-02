const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

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
  normalizePolymarketPositionSummary,
} = require('../../cli/lib/polymarket_trade_adapter.cjs');
const { buildPlanDigest } = require('../../cli/lib/mirror_service.cjs');
const {
  computeApprovalDiff,
  runPolymarketCheck,
  runPolymarketPreflight,
  POLYMARKET_OPS_SCHEMA_VERSION,
} = require('../../cli/lib/polymarket_ops_service.cjs');
const { runMirrorSync } = require('../../cli/lib/mirror_sync_service.cjs');
const { createRunMirrorCommand } = require('../../cli/lib/mirror_command_service.cjs');
const { resolveForkRuntime } = require('../../cli/lib/fork_runtime_service.cjs');
const { createErrorRecoveryService } = require('../../cli/lib/error_recovery_service.cjs');
const { createParseTradeFlags } = require('../../cli/lib/parsers/trade_flags.cjs');
const { createParseWatchFlags } = require('../../cli/lib/parsers/watch_flags.cjs');
const { createParseAutopilotFlags } = require('../../cli/lib/parsers/autopilot_flags.cjs');
const { createParseMirrorDeployFlags } = require('../../cli/lib/parsers/mirror_deploy_flags.cjs');
const { createParseMirrorGoFlags } = require('../../cli/lib/parsers/mirror_go_flags.cjs');
const { createParseLifecycleFlags } = require('../../cli/lib/parsers/lifecycle_flags.cjs');
const { createParseOddsFlags } = require('../../cli/lib/parsers/odds_flags.cjs');
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
} = require('../../cli/lib/mirror_sync/gates.cjs');
const { buildIdempotencyKey } = require('../../cli/lib/mirror_sync/execution.cjs');
const { ensureStateIdentity } = require('../../cli/lib/mirror_sync/state.cjs');

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
    parseOutcomeSide: parserParseOutcomeSide,
    parseNumber: parserParseNumber,
    parseWebhookFlagIntoOptions: () => null,
    isSecureHttpUrlOrLocal: parserIsSecureHttpUrlOrLocal,
    parseMirrorSyncGateSkipList: parserParseMirrorSyncGateSkipList,
    mergeMirrorSyncGateSkipLists: parserMergeMirrorSyncGateSkipLists,
    ...overrides,
  };
}

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const TEST_MARKET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

test('normalizeQuestion strips punctuation and stopwords', () => {
  const value = normalizeQuestion('Will, the Arsenal win the PL?!');
  assert.equal(value, 'arsenal win pl');
});

test('questionSimilarity is high for equivalent phrasing', () => {
  const score = questionSimilarity('Will Arsenal win the PL?', 'Arsenal to win Premier League');
  assert.ok(score > 0.6);
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
    assert.equal(capturedHedgeOptions.privateKey, privateKey);
    assert.equal(capturedHedgeOptions.funder, funder);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runMirrorSync does not increment tradesToday when no legs execute', async () => {
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
          expiry: { minTimeToExpirySec: 7200 },
        }),
        depthFn: async () => ({
          depthWithinSlippageUsd: 1000,
          yesDepth: { midPrice: 0.4, worstPrice: 0.41 },
          noDepth: { midPrice: 0.6, worstPrice: 0.61 },
        }),
        rebalanceFn: async () => {
          throw new Error('simulated rebalance failure');
        },
      },
    );

    assert.equal(payload.actionCount, 1);
    assert.equal(payload.state.tradesToday, 0);
    assert.equal(Array.isArray(payload.state.idempotencyKeys), true);
    assert.equal(payload.state.idempotencyKeys.length, 0);
    assert.equal(payload.actions[0].status, 'failed');
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
          expiry: { minTimeToExpirySec: 7200 },
        }),
        depthFn: async () => ({
          depthWithinSlippageUsd: 1000,
          yesDepth: { depthUsd: 1000, midPrice: 0.4, worstPrice: 0.41 },
          noDepth: { depthUsd: 1000, midPrice: 0.6, worstPrice: 0.61 },
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

test('createParseMirrorSyncFlags supports --market-address alias and default files', () => {
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
    '--skip-gate',
    'close_time_delta,oracle_price_drift',
  ]);

  assert.equal(options.pandoraMarketAddress, TEST_MARKET);
  assert.equal(options.forceGate, false);
  assert.deepEqual(options.skipGateChecks, ['CLOSE_TIME_DELTA', 'ORACLE_PRICE_DRIFT']);
  assert.equal(options.stateFile, '/tmp/mirror-state.json');
  assert.equal(options.killSwitchFile, '/tmp/mirror-stop');
  assert.equal(capturedDefaultStateInput.forceGate, false);
  assert.deepEqual(capturedDefaultStateInput.skipGateChecks, ['CLOSE_TIME_DELTA', 'ORACLE_PRICE_DRIFT']);
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
        stateFile: '/tmp/mirror-status.json',
        strategyHash: null,
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
    loadMirrorState: () => ({
      filePath: '/tmp/mirror-status.json',
      state: {
        schemaVersion: '1.0.0',
        strategyHash: '0123456789abcdef',
      },
    }),
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
});

test('createRunMirrorCommand sync help reports run|once|start usage and daemon selectors', async () => {
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
  assert.match(payload.usage, /mirror sync run\|once\|start/);
  assert.equal(/run\|once\|start\|stop\|status/.test(payload.usage), false);
  assert.match(payload.usage, /--telegram-chat-id <id>/);
  assert.match(payload.daemonLifecycle.stop, /--pid-file <path>\|--strategy-hash <hash>/);
  assert.match(payload.daemonLifecycle.status, /--pid-file <path>\|--strategy-hash <hash>/);
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
    'MIRROR_SYNC_FAILED',
    'LIFECYCLE_EXISTS',
    'LIFECYCLE_NOT_FOUND',
    'CONFIG_FILE_NOT_FOUND',
    'ODDS_RECORD_FAILED',
    'ODDS_HISTORY_FAILED',
    'ARB_SCAN_FAILED',
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

  const oddsHistory = recovery.getRecoveryForError({
    code: 'ODDS_HISTORY_FAILED',
    details: { eventId: 'evt-1' },
  });
  assert.equal(oddsHistory.command, 'pandora odds history --event-id evt-1 --output json');

  const arbRetry = recovery.getRecoveryForError({ code: 'ARB_SCAN_FAILED' });
  assert.equal(arbRetry.command, 'pandora arb scan --markets <market-a>,<market-b> --output json --iterations 1');
});
