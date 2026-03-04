const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { computeLiquidityRecommendation, computeDistributionHint, normalizeProbability } = require('./mirror_sizing_service.cjs');
const { resolvePolymarketMarket, fetchDepthForMarket, browsePolymarketMarkets } = require('./polymarket_trade_adapter.cjs');
const { findBestPandoraMatch, fetchPandoraMarketContext, verifyMirrorPair, hashRules } = require('./mirror_verify_service.cjs');
const { deployPandoraAmmMarket } = require('./pandora_deploy_service.cjs');
const { defaultManifestFile, upsertPair } = require('./mirror_manifest_store.cjs');
const { round } = require('./shared/utils.cjs');

const MIRROR_PLAN_SCHEMA_VERSION = '1.0.0';
const MIRROR_DEPLOY_SCHEMA_VERSION = '1.0.0';
const MIRROR_BROWSE_SCHEMA_VERSION = '1.0.0';

function createServiceError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

function normalizeSources(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return String(value)
    .split(/[\n,]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildRuleTemplate(sourceMarket) {
  const diagnostics = [];
  const sourceDescription = String(sourceMarket && sourceMarket.description ? sourceMarket.description : '').trim();
  if (sourceDescription) {
    return {
      rulesText: sourceDescription,
      diagnostics,
    };
  }

  diagnostics.push('Source market description/rules missing; generated fallback rule template.');
  return {
    rulesText: `Resolves YES if \"${String(sourceMarket && sourceMarket.question ? sourceMarket.question : 'the source condition').trim()}\" is true by the deadline. Resolves NO otherwise; canceled/postponed/abandoned/unresolved => NO.`,
    diagnostics,
  };
}

function buildPlanDigest(planData) {
  const digest = crypto.createHash('sha256');
  digest.update(JSON.stringify({
    sourceMarket: {
      marketId: planData.sourceMarket && planData.sourceMarket.marketId,
      slug: planData.sourceMarket && planData.sourceMarket.slug,
      question: planData.sourceMarket && planData.sourceMarket.question,
      description: planData.sourceMarket && planData.sourceMarket.description,
      yesPct: planData.sourceMarket && planData.sourceMarket.yesPct,
      closeTimestamp: planData.sourceMarket && planData.sourceMarket.closeTimestamp,
    },
    rules: planData.rules
      ? {
          sourceRules: planData.rules.sourceRules || null,
          proposedPandoraRules: planData.rules.proposedPandoraRules || null,
          sourceCount: planData.rules.sourceCount || null,
        }
      : null,
    liquidityRecommendation: planData.liquidityRecommendation,
    distributionHint: planData.distributionHint,
  }));
  return digest.digest('hex');
}

async function buildMirrorPlan(options = {}) {
  const diagnostics = [];

  const sourceMarket = await resolvePolymarketMarket({
    host: options.polymarketHost,
    gammaUrl: options.polymarketGammaUrl,
    gammaMockUrl: options.polymarketGammaMockUrl,
    mockUrl: options.polymarketMockUrl,
    timeoutMs: options.timeoutMs,
    marketId: options.polymarketMarketId,
    slug: options.polymarketSlug,
  });

  const depth = await fetchDepthForMarket(sourceMarket, {
    host: options.polymarketHost,
    mockUrl: options.polymarketMockUrl,
    slippageBps: options.depthSlippageBps || 100,
  });

  const sourceYesProbability = normalizeProbability(sourceMarket.yesPct);
  if (sourceYesProbability === null) {
    diagnostics.push('Source YES probability unavailable; using 50/50 fallback for distribution hint.');
  }

  const sizing = computeLiquidityRecommendation({
    volume24hUsd: sourceMarket.volume24hUsd,
    depthWithinSlippageUsd: depth.depthWithinSlippageUsd,
    targetSlippageBps: options.targetSlippageBps || 150,
    turnoverTarget: options.turnoverTarget || 1.25,
    depthUtilization: 0.6,
    safetyMultiplier: options.safetyMultiplier || 1.2,
    minLiquidityUsd: options.minLiquidityUsdc || 100,
    maxLiquidityUsd: options.maxLiquidityUsdc || 50_000,
    beta: 0.003,
    qMin: 25,
    qMax: 2000,
  });

  const distribution = computeDistributionHint(sourceYesProbability === null ? 0.5 : sourceYesProbability);
  const rules = buildRuleTemplate(sourceMarket);

  let match = { best: null, diagnostics: [] };
  try {
    match = await findBestPandoraMatch({
      indexerUrl: options.indexerUrl,
      timeoutMs: options.timeoutMs,
      chainId: options.chainId,
      sourceQuestion: sourceMarket.question,
      limit: 150,
    });
  } catch (err) {
    diagnostics.push(`Duplicate-check fallback: ${err && err.message ? err.message : String(err)}`);
  }

  if (Number.isFinite(sourceMarket.closeTimestamp)) {
    const nowSec = Math.floor(Date.now() / 1000);
    const timeToCloseSec = sourceMarket.closeTimestamp - nowSec;
    if (timeToCloseSec <= 24 * 60 * 60) {
      diagnostics.push(`Source market closes soon (${timeToCloseSec}s). Consider higher monitoring cadence.`);
    }
  }

  for (const item of sourceMarket.diagnostics || []) diagnostics.push(item);
  for (const item of depth.diagnostics || []) diagnostics.push(item);
  for (const item of sizing.diagnostics || []) diagnostics.push(item);
  for (const item of distribution.diagnostics || []) diagnostics.push(item);
  for (const item of rules.diagnostics || []) diagnostics.push(item);
  for (const item of match.diagnostics || []) diagnostics.push(item);

  const topMatch = match.best
    ? {
        marketAddress: match.best.marketAddress,
        pollAddress: match.best.pollAddress,
        question: match.best.question,
        similarity: match.best.similarity,
        status: match.best.status,
        chainId: match.best.chainId,
        marketType: match.best.marketType,
        yesPct: match.best.yesPct,
      }
    : null;

  const data = {
    schemaVersion: MIRROR_PLAN_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: 'polymarket',
    sourceMarket: {
      marketId: sourceMarket.marketId,
      slug: sourceMarket.slug,
      question: sourceMarket.question,
      description: options.withRules ? sourceMarket.description : undefined,
      closeTimestamp: sourceMarket.closeTimestamp,
      yesPct: sourceMarket.yesPct,
      noPct: sourceMarket.noPct,
      volume24hUsd: round(sourceMarket.volume24hUsd, 6),
      volumeTotalUsd: round(sourceMarket.volumeTotalUsd, 6),
      liquidityUsd: round(sourceMarket.liquidityUsd, 6),
      yesTokenId: sourceMarket.yesTokenId,
      noTokenId: sourceMarket.noTokenId,
      url: sourceMarket.url,
      sourceHost: sourceMarket.host,
      sourceType: sourceMarket.source,
    },
    match: topMatch,
    rules: {
      sourceRules: options.withRules ? sourceMarket.description || null : undefined,
      proposedPandoraRules: rules.rulesText,
      sourceCount: normalizeSources(options.sources).length,
    },
    similarity: topMatch ? topMatch.similarity : null,
    sizingInputs: {
      V24: round(sourceMarket.volume24hUsd, 6),
      D_eps: round(depth.depthWithinSlippageUsd, 6),
      p: sourceYesProbability === null ? null : round(sourceYesProbability, 6),
      targetSlippageBps: options.targetSlippageBps || 150,
      turnoverTarget: options.turnoverTarget || 1.25,
      safetyMultiplier: options.safetyMultiplier || 1.2,
      minLiquidityUsdc: options.minLiquidityUsdc || 100,
      maxLiquidityUsdc: options.maxLiquidityUsdc || 50_000,
    },
    liquidityRecommendation: {
      liquidityUsdc: sizing.recommendation.liquidityUsd,
      components: sizing.derived,
      boundedByMin: sizing.recommendation.boundedByMin,
      boundedByMax: sizing.recommendation.boundedByMax,
      depth: {
        slippageBps: depth.slippageBps,
        depthWithinSlippageUsd: depth.depthWithinSlippageUsd,
        yesDepth: depth.yesDepth,
        noDepth: depth.noDepth,
      },
    },
    distributionHint: {
      distributionYes: distribution.distributionYes,
      distributionNo: distribution.distributionNo,
      probabilityYes: distribution.probabilityYes,
      probabilityNo: distribution.probabilityNo,
    },
    diagnostics,
  };

  if (options.includeSimilarity && topMatch && topMatch.similarity) {
    data.similarityChecks = [topMatch.similarity];
  }

  data.planDigest = buildPlanDigest(data);
  return data;
}

function resolveDeployPlanInput(options = {}) {
  if (!options.planFile) return null;
  const resolved = path.resolve(options.planFile);
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = JSON.parse(raw);

  if (parsed && parsed.ok && parsed.data && parsed.command === 'mirror.plan') {
    return parsed.data;
  }
  if (parsed && parsed.schemaVersion && parsed.sourceMarket) {
    return parsed;
  }

  throw new Error('Plan file does not contain a valid mirror plan payload.');
}

async function deployMirror(options = {}) {
  let planData = options.planData || resolveDeployPlanInput(options);
  if (!planData) {
    planData = await buildMirrorPlan(options);
  }

  const diagnostics = [];
  const sourceRulesText =
    String(
      (planData.rules && (planData.rules.proposedPandoraRules || planData.rules.sourceRules)) ||
        (planData.sourceMarket && planData.sourceMarket.description) ||
        '',
    ).trim();

  const question = String(planData.sourceMarket && planData.sourceMarket.question ? planData.sourceMarket.question : '').trim();
  const targetTimestamp = Number(planData.sourceMarket && planData.sourceMarket.closeTimestamp);

  const liquidityUsdc =
    options.liquidityUsdc !== null && options.liquidityUsdc !== undefined
      ? Number(options.liquidityUsdc)
      : Number(planData.liquidityRecommendation && planData.liquidityRecommendation.liquidityUsdc);

  const distributionYes =
    options.distributionYes !== null && options.distributionYes !== undefined
      ? Number(options.distributionYes)
      : Number(planData.distributionHint && planData.distributionHint.distributionYes);
  const distributionNo =
    options.distributionNo !== null && options.distributionNo !== undefined
      ? Number(options.distributionNo)
      : Number(planData.distributionHint && planData.distributionHint.distributionNo);

  const sources = normalizeSources(options.sources);
  if (options.sourcesProvided && sources.length < 2) {
    throw createServiceError(
      'INVALID_FLAG_VALUE',
      '--sources requires at least two non-empty URLs when explicitly provided.',
      {
        providedCount: Array.isArray(options.sources) ? options.sources.length : 0,
        normalizedCount: sources.length,
      },
    );
  }
  if (!options.sourcesProvided && sources.length < 2) {
    diagnostics.push('Using fallback source URLs because explicit --sources were not provided.');
  }

  let deployPayload;
  try {
    deployPayload = await deployPandoraAmmMarket({
      execute: Boolean(options.execute),
      chainId: options.chainId,
      rpcUrl: options.rpcUrl,
      privateKey: options.privateKey,
      oracle: options.oracle,
      factory: options.factory,
      usdc: options.usdc,
      question,
      rules: sourceRulesText,
      sources: sources.length >= 2 ? sources : ['https://polymarket.com', 'https://clob.polymarket.com'],
      targetTimestamp,
      minCloseLeadSeconds: Number.isFinite(Number(options.minCloseLeadSeconds))
        ? Number(options.minCloseLeadSeconds)
        : 3600,
      liquidityUsdc,
      distributionYes,
      distributionNo,
      feeTier: options.feeTier || 3000,
      maxImbalance: options.maxImbalance || 10_000,
      arbiter: options.arbiter,
      category: options.category,
    });
  } catch (err) {
    throw createServiceError(
      err && err.code ? err.code : 'MIRROR_DEPLOY_FAILED',
      err && err.message ? err.message : String(err),
      err && err.details ? err.details : undefined,
    );
  }

  let trustManifest = null;
  if (options.execute && deployPayload.pandora && deployPayload.pandora.marketAddress) {
    const manifestFile = options.manifestFile || defaultManifestFile();
    try {
      const manifestUpdate = upsertPair(manifestFile, {
        trusted: true,
        pandoraMarketAddress: deployPayload.pandora.marketAddress,
        pandoraPollAddress: deployPayload.pandora.pollAddress,
        polymarketMarketId: planData.sourceMarket && planData.sourceMarket.marketId ? String(planData.sourceMarket.marketId) : options.polymarketMarketId || null,
        polymarketSlug: planData.sourceMarket && planData.sourceMarket.slug ? String(planData.sourceMarket.slug) : options.polymarketSlug || null,
        sourceQuestion: planData.sourceMarket && planData.sourceMarket.question ? planData.sourceMarket.question : null,
        sourceRuleHash: hashRules(sourceRulesText),
      });
      trustManifest = {
        filePath: manifestUpdate.filePath,
        pair: manifestUpdate.pair,
      };
    } catch (err) {
      throw createServiceError(
        'MIRROR_MANIFEST_WRITE_FAILED',
        `Failed to persist mirror trust manifest: ${err && err.message ? err.message : String(err)}`,
      );
    }
  }

  const postDeployChecks = {
    seedOddsMatch: null,
    yesPctSource: planData.sourceMarket && Number.isFinite(Number(planData.sourceMarket.yesPct))
      ? Number(planData.sourceMarket.yesPct)
      : null,
    yesPctPandora: null,
    diffPct: null,
    blockedLiveSync: false,
    code: null,
    message: null,
  };

  if (deployPayload.pandora && deployPayload.pandora.marketAddress && options.indexerUrl) {
    try {
      const pandoraMarket = await fetchPandoraMarketContext({
        indexerUrl: options.indexerUrl,
        timeoutMs: options.timeoutMs,
        marketAddress: deployPayload.pandora.marketAddress,
      });
      postDeployChecks.yesPctPandora = pandoraMarket.yesPct;

      if (postDeployChecks.yesPctSource !== null && postDeployChecks.yesPctPandora !== null) {
        const diff = Math.abs(postDeployChecks.yesPctSource - postDeployChecks.yesPctPandora);
        postDeployChecks.diffPct = round(diff, 6);
        postDeployChecks.seedOddsMatch = diff <= 2;

        if (!postDeployChecks.seedOddsMatch) {
          postDeployChecks.blockedLiveSync = true;
          postDeployChecks.code = 'SEED_ODDS_MISMATCH';
          postDeployChecks.message = `Seed odds mismatch exceeds ±2% (${postDeployChecks.diffPct}%).`;
        }
      }
    } catch (err) {
      diagnostics.push(`Post-deploy seed check unavailable: ${err && err.message ? err.message : String(err)}`);
    }
  } else {
    diagnostics.push('Post-deploy seed check skipped (market address or indexer URL unavailable).');
  }

  return {
    schemaVersion: MIRROR_DEPLOY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    planDigest: planData.planDigest || buildPlanDigest(planData),
    deploymentArgs: deployPayload.deploymentArgs,
    dryRun: deployPayload.mode === 'dry-run',
    tx: deployPayload.tx,
    pandora: deployPayload.pandora,
    postDeployChecks,
    trustManifest,
    diagnostics: diagnostics.concat(deployPayload.diagnostics || []),
  };
}

async function verifyMirror(options = {}) {
  return verifyMirrorPair(options);
}

async function browseMirrorMarkets(options = {}) {
  const diagnostics = [];
  const polymarket = await browsePolymarketMarkets({
    gammaUrl: options.polymarketGammaUrl,
    gammaMockUrl: options.polymarketGammaMockUrl,
    mockUrl: options.polymarketMockUrl,
    polymarketTagIds: Array.isArray(options.polymarketTagIds) ? options.polymarketTagIds : [],
    timeoutMs: options.timeoutMs,
    minYesPct: options.minYesPct,
    maxYesPct: options.maxYesPct,
    minVolume24h: options.minVolume24h,
    closesAfter: options.closesAfter,
    closesBefore: options.closesBefore,
    questionContains: options.questionContains,
    keyword: options.keyword,
    slug: options.slug,
    categories: Array.isArray(options.categories) ? options.categories : [],
    excludeSports: Boolean(options.excludeSports),
    sortBy: options.sortBy,
    limit: options.limit,
  });

  const items = [];
  for (const entry of polymarket.items || []) {
    let existingMirror = null;
    if (options.indexerUrl) {
      try {
        const match = await findBestPandoraMatch({
          indexerUrl: options.indexerUrl,
          timeoutMs: options.timeoutMs,
          chainId: options.chainId,
          sourceQuestion: entry.question,
          limit: 100,
        });
        if (match.best && match.best.similarity && Number(match.best.similarity.score) >= 0.86) {
          existingMirror = {
            marketAddress: match.best.marketAddress,
            similarity: match.best.similarity.score,
          };
        }
        diagnostics.push(...(match.diagnostics || []));
      } catch (err) {
        diagnostics.push(`Duplicate-check skipped for "${entry.slug || entry.marketId || entry.question || 'market'}": ${err && err.message ? err.message : String(err)}`);
      }
    }

    items.push({
      ...entry,
      existingMirror,
    });
  }

  return {
    schemaVersion: MIRROR_BROWSE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: polymarket.source,
    gammaApiError: polymarket.gammaApiError || null,
    filters: polymarket.filters,
    count: items.length,
    items,
    diagnostics: (polymarket.diagnostics || []).concat(diagnostics),
  };
}

module.exports = {
  MIRROR_PLAN_SCHEMA_VERSION,
  MIRROR_DEPLOY_SCHEMA_VERSION,
  MIRROR_BROWSE_SCHEMA_VERSION,
  buildMirrorPlan,
  deployMirror,
  verifyMirror,
  browseMirrorMarkets,
  buildPlanDigest,
};
