'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { privateKeyToAccount } = require('viem/accounts');

const pkg = require('../../package.json');
const {
  DEFAULT_FACTORY,
  DEFAULT_MAINNET_RPC_URL = 'https://ethereum.publicnode.com',
  DEFAULT_ORACLE,
  DEFAULT_RPC_BY_CHAIN_ID,
  DEFAULT_USDC,
} = (() => {
  const constants = require('../../cli/lib/shared/constants.cjs');
  return {
    ...constants,
    DEFAULT_MAINNET_RPC_URL: constants.DEFAULT_RPC_BY_CHAIN_ID && constants.DEFAULT_RPC_BY_CHAIN_ID[1],
  };
})();
const { createLocalPandoraAgentClient } = require('../../sdk/typescript');
const { createIsolatedPandoraEnv } = require('../../tests/helpers/contract_parity_assertions.cjs');
const {
  DOCTOR_ENV_KEYS,
  CLI_PATH,
  REPO_ROOT,
  createTempDir,
  removeDir,
  runCliAsync,
} = require('../../tests/helpers/cli_runner.cjs');

const REPORT_SCHEMA_VERSION = '1.0.0';
const REPORT_KIND = 'user-journey-report';
const DEFAULT_SCENARIOS = Object.freeze(['deployer', 'mcp-parimutuel']);
const ADDITIONAL_SCENARIOS = Object.freeze([
  'amm-mirror-zero-prereqs',
  'bootstrap-readonly-discovery',
  'policy-profile-audit',
  'hype-no-ai-keys',
  'research-trader-dry-run',
  'portfolio-empty-wallet',
  'watch-risk-observer',
  'sports-no-provider',
  'mirror-sync-paper-existing-market',
  'operations-empty-ledger',
]);
const SUPPORTED_SCENARIOS = Object.freeze([...DEFAULT_SCENARIOS, ...ADDITIONAL_SCENARIOS]);
const SCENARIO_SET = new Set(SUPPORTED_SCENARIOS);
const FIXED_FUTURE_TIMESTAMP = '1893456000'; // 2030-01-01T00:00:00Z
const BASE_UNSET_ENV_KEYS = Array.from(new Set([...DOCTOR_ENV_KEYS, 'ARBITER', 'PANDORA_WALLET', 'WALLET']));
const STRICT_EXTERNAL_UNSET_ENV_KEYS = Array.from(
  new Set([
    ...BASE_UNSET_ENV_KEYS,
    ...Object.keys(process.env).filter((key) =>
      ['POLYMARKET_', 'SPORTSBOOK_', 'ODDS_', 'OPENAI_', 'ANTHROPIC_'].some((prefix) => key.startsWith(prefix))),
  ]),
);
const HYPE_QUERY = 'Suggest sharp parimutuel ideas for major 2026 headlines';
const HYPE_FALLBACK_QUERY = 'suggest ideas';
const KNOWN_PANDORA_MARKET_ID = '0x1009948a17f4d50d85064f1da90e048b54a39583';
const KNOWN_POLYMARKET_SLUG = 'will-the-los-angeles-clippers-win-the-2026-nba-finals';
const MIRROR_RESOLUTION_SOURCES = Object.freeze(['https://www.nba.com/', 'https://www.espn.com/nba/']);
const EMPTY_WALLET = '0x1111111111111111111111111111111111111111';

const ADDRESSES = Object.freeze({
  oracle: DEFAULT_ORACLE,
  factory: DEFAULT_FACTORY,
  usdc: DEFAULT_USDC,
});

const AMM_MARKET = Object.freeze({
  marketType: 'amm',
  question: 'Will ETH close above $8k by end of 2026?',
  rules:
    'Resolves Yes if condition is true. Resolves No if false. If canceled/postponed/abandoned/unresolved, resolve No.',
  sources: ['https://example.com/a', 'https://example.com/b'],
  targetTimestamp: FIXED_FUTURE_TIMESTAMP,
  liquidityUsdc: 100,
  feeTier: 3000,
  txRoute: 'flashbots-bundle',
});

const PARIMUTUEL_MARKET = Object.freeze({
  marketType: 'parimutuel',
  question: 'Will BTC close above $120k by end of 2026?',
  rules:
    'Resolves Yes if condition is true. Resolves No if false. If canceled/postponed/abandoned/unresolved, resolve No.',
  sources: ['https://example.com/a', 'https://example.com/b'],
  targetTimestamp: FIXED_FUTURE_TIMESTAMP,
  liquidityUsdc: 100,
  curveFlattener: 7,
  curveOffset: 30000,
});

const SKEWED_PARIMUTUEL_DISTRIBUTION = Object.freeze({
  yesPct: 99.9,
  noPct: 0.1,
});
const DEFAULT_JOURNEY_CLASSIFICATION = Object.freeze({
  kind: 'product-state',
  guidanceQuality: 'unspecified',
  externallyBlocked: false,
});

function compareStableStrings(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function parseScenarioList(value) {
  const raw = String(value || '').trim();
  if (!raw) return [...DEFAULT_SCENARIOS];
  if (raw === 'all') return [...SUPPORTED_SCENARIOS];
  const requested = raw
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  if (!requested.length) return [...DEFAULT_SCENARIOS];
  for (const scenario of requested) {
    if (!SCENARIO_SET.has(scenario)) {
      throw new Error(`Unknown scenario: ${scenario}`);
    }
  }
  return Array.from(new Set(requested));
}

function safeParseJson(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function truncateText(value, maxLength = 1200) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  switch (payload.command) {
    case 'setup':
      return {
        envStatus: payload.data && payload.data.envStep && payload.data.envStep.status,
        doctorOk: Boolean(payload.data && payload.data.doctor && payload.data.doctor.summary && payload.data.doctor.summary.ok),
      };
    case 'bootstrap':
      return {
        recommendedBootstrapFlow:
          payload.data && Array.isArray(payload.data.recommendedBootstrapFlow)
            ? payload.data.recommendedBootstrapFlow
            : [],
        warningCodes:
          payload.data && Array.isArray(payload.data.warnings)
            ? payload.data.warnings.map((warning) => warning && warning.code).filter(Boolean)
            : [],
      };
    case 'profile.explain':
      return {
        usable: Boolean(payload.data && payload.data.explanation && payload.data.explanation.usable),
        blockerCount:
          payload.data && payload.data.explanation && Array.isArray(payload.data.explanation.blockers)
            ? payload.data.explanation.blockers.length
            : 0,
        remediationCodes:
          payload.data && payload.data.explanation && Array.isArray(payload.data.explanation.remediation)
            ? payload.data.explanation.remediation.map((item) => item && item.code).filter(Boolean)
            : [],
      };
    case 'profile.recommend':
      return {
        recommendedProfileId: payload.data && payload.data.recommendedProfileId,
        bestTool:
          payload.data
          && payload.data.decision
          && payload.data.decision.bestTool,
        companionProfileId:
          payload.data
          && payload.data.onboardingGuidance
          && payload.data.onboardingGuidance.companionProfileId,
        mentionsIndependentSourcesRequirement:
          Boolean(
            payload.data
            && payload.data.onboardingGuidance
            && payload.data.onboardingGuidance.sourceRequirement
            && payload.data.onboardingGuidance.sourceRequirement.minimumSources >= 2,
          ),
      };
    case 'profile.list':
      return {
        count: payload.data && payload.data.count,
        builtInCount: payload.data && payload.data.builtInCount,
      };
    case 'policy.list':
      return {
        count: payload.data && payload.data.count,
        builtInCount: payload.data && payload.data.builtinCount,
      };
    case 'policy.recommend':
      return {
        recommendedPolicyId: payload.data && payload.data.recommendedPolicyId,
        recommendedNextTool:
          payload.data
          && payload.data.recommended
          && payload.data.recommended.recommendedNextTool,
      };
    case 'markets.hype.plan':
      return {
        candidateCount:
          payload.data && Array.isArray(payload.data.candidates)
            ? payload.data.candidates.length
            : 0,
        providerName:
          payload.data
          && payload.data.provider
          && payload.data.provider.name,
        mockProviderTestOnly:
          Boolean(
            payload.data
            && payload.data.guidance
            && payload.data.guidance.mockProviderTestOnly,
          ),
        selectedCandidateId: payload.data && payload.data.selectedCandidateId,
        selectedQuestion:
          payload.data
          && payload.data.selectedCandidate
          && payload.data.selectedCandidate.question,
      };
    case 'markets.create.plan':
    case 'markets.create.run':
      return {
        marketType:
          payload.data
          && payload.data.marketTemplate
          && payload.data.marketTemplate.marketType,
        distributionYes:
          payload.data
          && payload.data.marketTemplate
          && payload.data.marketTemplate.distributionYes,
        distributionNo:
          payload.data
          && payload.data.marketTemplate
          && payload.data.marketTemplate.distributionNo,
        mode: payload.data && payload.data.mode,
        validationTicket: payload.data && payload.data.requiredValidation && payload.data.requiredValidation.ticket,
        deploymentMode: payload.data && payload.data.deployment && payload.data.deployment.mode,
        txRouteResolved: payload.data && payload.data.deployment && payload.data.deployment.txRouteResolved,
        preflightReady: payload.data && payload.data.preflight && payload.data.preflight.ready,
        preflightBlockerCount:
          payload.data && payload.data.preflight && Array.isArray(payload.data.preflight.blockers)
            ? payload.data.preflight.blockers.length
            : 0,
      };
    case 'agent.market.validate':
      return {
        ticket: payload.data && payload.data.ticket,
        promptVersion: payload.data && payload.data.promptVersion,
      };
    case 'agent.market.hype':
      return {
        promptVersion: payload.data && payload.data.promptVersion,
        hasPrompt: Boolean(payload.data && payload.data.prompt),
      };
    case 'mirror.browse':
      return {
        count: payload.data && payload.data.count,
        firstSlug:
          payload.data && Array.isArray(payload.data.items) && payload.data.items[0]
            ? payload.data.items[0].slug
            : null,
      };
    case 'mirror.plan':
      return {
        slug:
          payload.data
          && payload.data.sourceMarket
          && payload.data.sourceMarket.slug,
        similarityScore:
          payload.data
          && payload.data.similarity
          && payload.data.similarity.score,
        sourceCount:
          payload.data
          && payload.data.rules
          && payload.data.rules.sourceCount,
      };
    case 'mirror.go':
      return {
        mode: payload.data && payload.data.mode,
        hasPlan: Boolean(payload.data && payload.data.plan),
        hasDeploy: Boolean(payload.data && payload.data.deploy),
        hasVerify: Boolean(payload.data && payload.data.verify),
        diagnosticCount:
          payload.data && Array.isArray(payload.data.diagnostics)
            ? payload.data.diagnostics.length
            : 0,
        firstDeployDiagnostic:
          payload.data
          && payload.data.deploy
          && Array.isArray(payload.data.deploy.diagnostics)
          && payload.data.deploy.diagnostics[0]
            ? payload.data.deploy.diagnostics[0]
            : null,
      };
    case 'mirror.sync':
      return {
        mode: payload.data && payload.data.mode,
        actionCount: payload.data && payload.data.actionCount,
        strategyHash: payload.data && payload.data.strategyHash,
        stoppedReason: payload.data && payload.data.stoppedReason,
        diagnosticCount:
          payload.data && Array.isArray(payload.data.diagnostics)
            ? payload.data.diagnostics.length
            : 0,
        firstDiagnosticMessage:
          payload.data
          && Array.isArray(payload.data.diagnostics)
          && payload.data.diagnostics[0]
          && payload.data.diagnostics[0].message,
      };
    case 'quote':
      return {
        marketType: payload.data && payload.data.marketType,
        quoteAvailable: Boolean(payload.data && payload.data.quoteAvailable),
        yesPct:
          payload.data
          && payload.data.odds
          && payload.data.odds.yesPct,
      };
    case 'trade':
      return {
        mode: payload.data && payload.data.mode,
        selectedProbabilityPct: payload.data && payload.data.selectedProbabilityPct,
        stepCount:
          payload.data
          && payload.data.executionPlan
          && Array.isArray(payload.data.executionPlan.steps)
            ? payload.data.executionPlan.steps.length
            : 0,
      };
    case 'portfolio':
      return {
        positionCount:
          payload.data
          && payload.data.summary
          && payload.data.summary.positionCount,
        totalPositionMarkValueUsdc:
          payload.data
          && payload.data.summary
          && payload.data.summary.totalPositionMarkValueUsdc,
      };
    case 'positions.list':
      return {
        count: payload.data && payload.data.count,
      };
    case 'sports.books.list':
      return {
        activeProvider:
          payload.data
          && payload.data.health
          && payload.data.health.activeProvider,
        configuredProviderCount:
          payload.data
          && payload.data.health
          && Array.isArray(payload.data.health.providers)
            ? payload.data.health.providers.filter((provider) => provider && provider.configured === true).length
            : 0,
      };
    case 'recipe.list':
      return {
        count: payload.data && payload.data.count,
        builtinCount: payload.data && payload.data.builtinCount,
      };
    case 'recipe.get':
      return {
        tool:
          payload.data
          && payload.data.recipe
          && payload.data.recipe.tool,
      };
    case 'recipe.validate':
      return {
        ok: Boolean(payload.data && payload.data.ok),
        command:
          payload.data
          && Array.isArray(payload.data.compiledCommand)
            ? payload.data.compiledCommand.join(' ')
            : null,
      };
    case 'recipe.run':
      return {
        ok: Boolean(payload.data && payload.data.ok),
        nestedOk: Boolean(payload.data && payload.data.result && payload.data.result.ok),
        nestedErrorCode:
          payload.data
          && payload.data.result
          && payload.data.result.error
          && payload.data.result.error.code,
      };
    case 'operations.list':
      return {
        count: payload.data && payload.data.count,
      };
    default:
      return null;
  }
}

function summarizeSdkValue(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value.canonicalTools) && Array.isArray(value.recommendedBootstrapFlow)) {
    return {
      canonicalToolCount: value.canonicalTools.length,
      recommendedBootstrapFlow: value.recommendedBootstrapFlow,
    };
  }
  if (value.ok === true) {
    return summarizePayload(value) || {
      command: value.command || null,
    };
  }
  return null;
}

function redactArgs(args) {
  const redacted = [];
  const secretFlags = new Set(['--private-key', '--flashbots-auth-key']);
  let redactNext = false;
  for (const arg of Array.isArray(args) ? args : []) {
    const text = String(arg);
    if (redactNext) {
      redacted.push('<redacted>');
      redactNext = false;
      continue;
    }
    redacted.push(text);
    if (secretFlags.has(text)) {
      redactNext = true;
    }
  }
  return redacted;
}

function buildValidEnv(rpcUrl, privateKey, overrides = {}) {
  const entries = {
    CHAIN_ID: '1',
    RPC_URL: rpcUrl,
    PANDORA_PRIVATE_KEY: privateKey,
    PRIVATE_KEY: privateKey,
    ORACLE: ADDRESSES.oracle,
    FACTORY: ADDRESSES.factory,
    USDC: ADDRESSES.usdc,
    ...overrides,
  };

  return Object.entries(entries)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

async function callJsonRpc(rpcUrl, method, params = []) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });
  const payload = await response.json();
  if (payload && payload.error) {
    throw new Error(`RPC ${method} failed: ${payload.error.message || 'unknown error'}`);
  }
  return payload.result;
}

async function generateFreshZeroBalanceSigner(rpcUrl, maxAttempts = 10) {
  const upstreamUrl = rpcUrl || DEFAULT_MAINNET_RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[1];
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const privateKey = `0x${crypto.randomBytes(32).toString('hex')}`;
    const account = privateKeyToAccount(privateKey);
    const [balanceHex, nonceHex] = await Promise.all([
      callJsonRpc(upstreamUrl, 'eth_getBalance', [account.address, 'latest']),
      callJsonRpc(upstreamUrl, 'eth_getTransactionCount', [account.address, 'latest']),
    ]);
    if (BigInt(balanceHex) === 0n && BigInt(nonceHex) === 0n) {
      return {
        privateKey,
        address: account.address,
        nativeBalanceWei: balanceHex,
        nonce: nonceHex,
      };
    }
  }
  throw new Error(`Unable to generate an unfunded signer after ${maxAttempts} attempts.`);
}

function buildStepRecord(base, outcome) {
  return {
    id: base.id,
    title: base.title,
    surface: base.surface,
    expectedOutcome: base.expectFailure ? 'failure' : 'success',
    passed: outcome.passed,
    status: outcome.status,
    durationMs: outcome.durationMs,
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut === true,
    command: base.command || null,
    toolName: base.toolName || null,
    args: base.args ? redactArgs(base.args) : null,
    input: base.input ? JSON.parse(JSON.stringify(base.input)) : null,
    outputSnippet: outcome.outputSnippet || null,
    payloadSummary: outcome.payloadSummary || null,
    errorCode: outcome.errorCode || null,
    errorMessage: outcome.errorMessage || null,
    notes: Array.isArray(base.notes) ? [...base.notes] : [],
  };
}

async function runCliJsonStep(definition) {
  const startedAt = Date.now();
  const result = await runCliAsync(definition.args, {
    cwd: definition.cwd || REPO_ROOT,
    env: definition.env,
    unsetEnvKeys: definition.unsetEnvKeys || BASE_UNSET_ENV_KEYS,
    timeoutMs: definition.timeoutMs || 120_000,
  });
  const durationMs = Date.now() - startedAt;
  const payload = safeParseJson(result.stdout || result.output);
  const success = result.status === 0 && Boolean(!payload || payload.ok !== false);
  const passed = definition.expectFailure ? !success : success;
  const outputText = result.stdout || result.output || result.stderr || '';
  const errorCode = payload && payload.error && payload.error.code ? payload.error.code : null;
  const errorMessage = payload && payload.error && payload.error.message
    ? payload.error.message
    : truncateText(outputText, 600);

  return {
    step: buildStepRecord(definition, {
      passed,
      status: definition.expectFailure
        ? (success ? 'unexpected-success' : 'expected-blocker')
        : (success ? 'ok' : 'failed'),
      durationMs,
      exitCode: result.status,
      timedOut: result.timedOut,
      outputSnippet: truncateText(outputText),
      payloadSummary:
        (typeof definition.summarize === 'function' ? definition.summarize(payload, result) : summarizePayload(payload)),
      errorCode,
      errorMessage,
    }),
    payload,
    result,
    success,
  };
}

async function runSdkStep(definition, execute) {
  const startedAt = Date.now();
  try {
    const value = await execute();
    const durationMs = Date.now() - startedAt;
    const success = Boolean(!value || value.ok !== false);
    const passed = definition.expectFailure ? !success : success;
    return {
      step: buildStepRecord(definition, {
        passed,
        status: definition.expectFailure
          ? (success ? 'unexpected-success' : 'expected-blocker')
          : (success ? 'ok' : 'failed'),
        durationMs,
        exitCode: success ? 0 : 1,
        timedOut: false,
        outputSnippet: truncateText(JSON.stringify(value, null, 2)),
        payloadSummary:
          typeof definition.summarize === 'function' ? definition.summarize(value) : summarizeSdkValue(value),
        errorCode: value && value.error && value.error.code ? value.error.code : null,
        errorMessage: value && value.error && value.error.message ? value.error.message : null,
      }),
      value,
      success,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const passed = definition.expectFailure === true;
    return {
      step: buildStepRecord(definition, {
        passed,
        status: definition.expectFailure ? 'expected-blocker' : 'failed',
        durationMs,
        exitCode: 1,
        timedOut: false,
        outputSnippet: truncateText(error && error.stack ? error.stack : String(error)),
        payloadSummary: null,
        errorCode:
          (error && error.toolError && error.toolError.code)
          || (error && error.code)
          || (error && error.sdkCode)
          || 'SDK_STEP_FAILED',
        errorMessage:
          (error && error.toolError && error.toolError.message)
          || (error && error.message)
          || String(error),
      }),
      error,
      success: false,
    };
  }
}

async function withRawMcpClient(options, fn) {
  const client = new Client({ name: 'pandora-user-journey-mcp', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI_PATH, 'mcp'],
    cwd: options && options.cwd ? options.cwd : REPO_ROOT,
    stderr: 'pipe',
    env: options && options.env ? options.env : process.env,
  });

  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function runMcpStep(definition, client, toolName, input) {
  const startedAt = Date.now();
  try {
    const result = await client.callTool({
      name: toolName,
      arguments: input || {},
    });
    const envelope = result && result.structuredContent ? result.structuredContent : null;
    const success = Boolean(result && result.isError !== true && envelope && envelope.ok === true);
    const passed = definition.expectFailure ? !success : success;
    return {
      step: buildStepRecord(definition, {
        passed,
        status: definition.expectFailure
          ? (success ? 'unexpected-success' : 'expected-blocker')
          : (success ? 'ok' : 'failed'),
        durationMs: Date.now() - startedAt,
        exitCode: success ? 0 : 1,
        timedOut: false,
        outputSnippet: truncateText(JSON.stringify(envelope || result, null, 2)),
        payloadSummary: summarizeSdkValue(envelope),
        errorCode: envelope && envelope.error && envelope.error.code ? envelope.error.code : null,
        errorMessage: envelope && envelope.error && envelope.error.message ? envelope.error.message : null,
      }),
      envelope,
      success,
    };
  } catch (error) {
    const passed = definition.expectFailure === true;
    return {
      step: buildStepRecord(definition, {
        passed,
        status: definition.expectFailure ? 'expected-blocker' : 'failed',
        durationMs: Date.now() - startedAt,
        exitCode: 1,
        timedOut: false,
        outputSnippet: truncateText(error && error.stack ? error.stack : String(error)),
        payloadSummary: null,
        errorCode: error && error.code ? error.code : 'MCP_STEP_FAILED',
        errorMessage: error && error.message ? error.message : String(error),
      }),
      error,
      success: false,
    };
  }
}

function collectStepMap(steps) {
  return new Map((Array.isArray(steps) ? steps : []).map((step) => [step.id, step]));
}

function deriveDeployerAssessment(steps) {
  const byId = collectStepMap(steps);
  const frictionPoints = [];
  const strengths = [];

  const defaultSetup = byId.get('cli.setup.default');
  if (defaultSetup && defaultSetup.status === 'expected-blocker') {
    frictionPoints.push({
      severity: 'high',
      stepId: defaultSetup.id,
      area: 'onboarding',
      title: 'Default setup writes a broken starter env for fresh users',
      detail:
        'A clean `pandora setup` writes `.env` from the bundled example, then immediately fails because the template still contains a placeholder private key.',
      recommendation:
        'Split template generation from readiness checks, or make setup interactive so the first run never writes a file that is guaranteed to fail doctor validation.',
    });
    if ((defaultSetup.errorMessage || '').includes('placeholder')) {
      frictionPoints.push({
        severity: 'medium',
        stepId: defaultSetup.id,
        area: 'onboarding',
        title: 'Setup error text focuses on placeholder keys, not the next usable path',
        detail:
          'The first-run error is accurate, but it does not immediately redirect the user into the profile-based or env-based mutable setup flow.',
        recommendation:
          'After placeholder detection, print the exact next command or doc link for a working deployer setup path.',
      });
    }
  } else if (defaultSetup && defaultSetup.status === 'ok') {
    strengths.push({
      stepId: defaultSetup.id,
      title: 'Default setup now guides fresh deployers past placeholder secrets',
      detail:
        'A clean `pandora setup` writes the starter env and points directly at the deployer-profile path instead of failing the first run on placeholder keys.',
    });
  }

  const guidedSetup = byId.get('cli.setup.guided');
  if (guidedSetup && guidedSetup.status === 'ok') {
    strengths.push({
      stepId: guidedSetup.id,
      title: 'Setup succeeds cleanly with an explicit env example',
      detail:
        'Once valid env values are supplied, `setup` and `doctor` complete without surprises. The deterministic happy path is stable.',
    });
  }

  const cliBootstrap = byId.get('cli.bootstrap');
  const mcpBootstrap = byId.get('mcp.bootstrap');
  const sdkBootstrap = byId.get('sdk.bootstrap');
  if (
    cliBootstrap && cliBootstrap.status === 'ok'
    && mcpBootstrap && mcpBootstrap.status === 'ok'
    && sdkBootstrap && sdkBootstrap.status === 'ok'
  ) {
    strengths.push({
      stepId: mcpBootstrap.id,
      title: 'CLI, raw MCP, and SDK bootstrap surfaces stay aligned',
      detail:
        'Discovery worked across all three external entry points without special casing or extra setup glue.',
    });
  }

  const profileExplain = byId.get('cli.profile.explain.deployer');
  if (
    profileExplain
    && Array.isArray(profileExplain.payloadSummary && profileExplain.payloadSummary.remediationCodes)
    && profileExplain.payloadSummary.remediationCodes.includes('PROFILE_TOOL_FAMILY_NOT_ALLOWED')
  ) {
    frictionPoints.push({
      severity: 'high',
      stepId: profileExplain.id,
      area: 'signer-profiles',
      title: 'Built-in mutable profiles are not compatible with market deployment',
      detail:
        'The recommended mutable profile path currently rejects `markets.create.run` because the built-in signer profiles do not allow the `markets` tool family.',
      recommendation:
        'Ship at least one canonical deployer profile or adjust sample profile allowlists so market creation is supported out of the box.',
    });
  } else if (profileExplain && profileExplain.status === 'ok') {
    strengths.push({
      stepId: profileExplain.id,
      title: 'Built-in deployer profile is compatible with market deployment',
      detail:
        'The profile explain path can now validate deploy-ready market creation context without rejecting the tool family contract.',
    });
  }

  const sdkCliish = byId.get('sdk.amm.plan.cliish-inputs');
  if (sdkCliish && sdkCliish.status === 'expected-blocker') {
    frictionPoints.push({
      severity: 'medium',
      stepId: sdkCliish.id,
      area: 'sdk-mcp',
      title: 'SDK/MCP input typing is easy to misuse when coming from CLI flags',
      detail:
        'A natural JSON payload with CLI-like string values fails because `markets.create.plan` expects numeric liquidity but string timestamps, while `agent.market.validate` expects the timestamp as an integer.',
      recommendation:
        'Expose typed builders/examples for `markets.create.*` so users do not have to discover mixed-type rules by trial and error.',
    });
  } else if (sdkCliish && sdkCliish.status === 'ok') {
    strengths.push({
      stepId: sdkCliish.id,
      title: 'SDK and MCP normalize CLI-like market input payloads',
      detail:
        'Market planning accepts natural JSON payloads with CLI-like scalar strings and coerces them into the typed contract shape automatically.',
    });
  }

  const validationGate = byId.get('cli.amm.execute.no-validation');
  if (validationGate && validationGate.status === 'expected-blocker') {
    strengths.push({
      stepId: validationGate.id,
      title: 'Validation gating is explicit and protective',
      detail:
        'Execute mode refuses to proceed without the exact validation ticket and points the user at `agent market validate`.',
    });
  }

  const ammExecute = byId.get('cli.amm.execute.with-validation');
  const pariExecute = byId.get('cli.parimutuel.execute.with-validation');
  const executeErrors = [ammExecute, pariExecute]
    .filter(Boolean)
    .map((step) => String(step.errorMessage || ''))
    .filter(Boolean);
  if (executeErrors.some((message) => /insufficient funds|insufficient native balance|insufficient usdc balance/i.test(message))) {
    frictionPoints.push({
      severity: 'medium',
      stepId: ammExecute ? ammExecute.id : (pariExecute ? pariExecute.id : null),
      area: 'execution-readiness',
      title: 'Live deploy failure appears only at the final execute step',
      detail:
        'Both market types reached deploy execution and then failed on insufficient gas/value funding. The flow does not surface funded-wallet readiness earlier.',
      recommendation:
        'Add an explicit pre-execute readiness check for signer balance and required ETH value before asking users to attempt deployment.',
    });
  }

  const ammDryRun = byId.get('sdk.amm.dry-run');
  const pariDryRun = byId.get('cli.parimutuel.dry-run');
  if (ammDryRun && pariDryRun && ammDryRun.status === 'ok' && pariDryRun.status === 'ok') {
    strengths.push({
      stepId: ammDryRun.id,
      title: 'AMM and parimutuel creation paths are isolated at plan and dry-run layers',
      detail:
        'Both market types normalize, validate, and dry-run successfully through their dedicated parameter sets without bleeding into each other.',
    });
  }

  const recommendations = frictionPoints
    .map((item) => item.recommendation)
    .filter(Boolean)
    .filter((value, index, collection) => collection.indexOf(value) === index);

  return {
    frictionPoints: frictionPoints.sort((left, right) => compareStableStrings(left.title, right.title)),
    strengths: strengths.sort((left, right) => compareStableStrings(left.title, right.title)),
    recommendations,
  };
}

function deriveMcpParimutuelAssessment(steps) {
  const byId = collectStepMap(steps);
  const frictionPoints = [];
  const strengths = [];

  const bootstrap = byId.get('mcp.parimutuel.bootstrap');
  const profileRecommend = byId.get('mcp.parimutuel.profile.recommend');
  if (
    bootstrap && bootstrap.status === 'ok'
    && profileRecommend && profileRecommend.status === 'ok'
    && profileRecommend.payloadSummary
    && profileRecommend.payloadSummary.recommendedProfileId === 'market_deployer_a'
  ) {
    strengths.push({
      stepId: profileRecommend.id,
      title: 'MCP bootstrap and profile recommendation expose the deployer path early',
      detail:
        'A fresh MCP client can discover the canonical deployer profile and execute policy before touching signer setup.',
    });
  }

  const autocomplete = byId.get('mcp.parimutuel.autocomplete');
  if (autocomplete && autocomplete.status === 'ok') {
    const promptText = String(autocomplete.outputSnippet || '');
    if (/Parimutuel \(pool-based, funds remain locked until resolution\)/i.test(promptText)) {
      strengths.push({
        stepId: autocomplete.id,
        title: 'Autocomplete gives a minimal in-band parimutuel explanation',
        detail:
          'The agent prompt at least tells a cold MCP client that parimutuel is pool-based and locked until resolution.',
      });
    }
    if (/99\.9\/0\.1|distribution percentages define the starting yes\/no pool skew|almost one-sided directional pool/i.test(promptText)) {
      strengths.push({
        stepId: autocomplete.id,
        title: 'Autocomplete now explains how an extreme 99.9/0.1 parimutuel skew works',
        detail:
          'The prompt now explains that explicit distribution percentages define the opening pool skew and that an extreme 99.9/0.1 split is an intentional directional choice.',
      });
    } else if (!/distribution/i.test(promptText)) {
      frictionPoints.push({
        severity: 'medium',
        stepId: autocomplete.id,
        area: 'agent-guidance',
        title: 'Parimutuel guidance does not explain skewed pool configuration',
        detail:
          'The autocomplete prompt helps with rules and timing, but it does not explain how an extreme 99.9/0.1 pool should be expressed or what that skew means operationally.',
        recommendation:
          'Add MCP-visible guidance for parimutuel distribution percentages and their directional implications, not just a one-line market-type label.',
      });
    }
  }

  const hypePlan = byId.get('mcp.parimutuel.hype.plan.mock');
  if (hypePlan && hypePlan.status === 'ok') {
    const candidateCount = Number(hypePlan.payloadSummary && hypePlan.payloadSummary.candidateCount) || 0;
    const selectedQuestion = String(hypePlan.payloadSummary && hypePlan.payloadSummary.selectedQuestion || '');
    const mockProviderTestOnly = Boolean(hypePlan.payloadSummary && hypePlan.payloadSummary.mockProviderTestOnly);
    if (
      mockProviderTestOnly
      && (candidateCount < 3 || /featured .* outcome happen/i.test(selectedQuestion) || /Suggest sharp parimutuel ideas/i.test(selectedQuestion))
    ) {
      strengths.push({
        stepId: hypePlan.id,
        title: 'Mock hype mode is clearly framed as deterministic test-only guidance',
        detail:
          'The harness still uses mock output deterministically, but the MCP payload now tells real users to prefer provider-backed markets.hype.plan for actual market suggestions.',
      });
    } else if (candidateCount < 3 || /featured .* outcome happen/i.test(selectedQuestion) || /Suggest sharp parimutuel ideas/i.test(selectedQuestion)) {
      frictionPoints.push({
        severity: 'medium',
        stepId: hypePlan.id,
        area: 'market-suggestions',
        title: 'Mock hype suggestions are not production-quality market ideas',
        detail:
          'The deterministic suggestion path returned fewer candidates than requested and the selected draft was a generic placeholder derived from the query text, not a concrete deployable headline.',
        recommendation:
          'Document mock mode as harness-only and steer real MCP users toward provider-backed `markets.hype.plan` or the prompt-only agent research fallback for actual market ideation.',
      });
    } else {
      strengths.push({
        stepId: hypePlan.id,
        title: 'MCP can suggest and prevalidate candidate markets without a second manual planning pass',
        detail:
          'The hype planner returned candidate markets plus validation attestation that can feed directly into deployment.',
      });
    }
  }

  const skewPlan = byId.get('mcp.parimutuel.plan.skewed');
  if (
    skewPlan
    && skewPlan.status === 'ok'
    && skewPlan.payloadSummary
    && Number(skewPlan.payloadSummary.distributionYes) === 999000000
    && Number(skewPlan.payloadSummary.distributionNo) === 1000000
  ) {
    strengths.push({
      stepId: skewPlan.id,
      title: 'MCP planning accepts an extreme 99.9/0.1 parimutuel skew',
      detail:
        'The canonical plan surface normalized the requested percentage skew into the expected parts-per-billion distribution without manual conversion.',
    });
  }

  const dryRunNoSigner = byId.get('mcp.parimutuel.dry-run.no-signer');
  if (dryRunNoSigner && dryRunNoSigner.status === 'ok') {
    strengths.push({
      stepId: dryRunNoSigner.id,
      title: 'Fresh MCP users can shape the parimutuel payload before attaching a signer',
      detail:
        'Dry-run planning succeeded without signer configuration, so the user can validate structure and parameters before secret setup.',
    });
  }

  const dryRunUnfundedSigner = byId.get('mcp.parimutuel.dry-run.unfunded-signer');
  if (
    dryRunUnfundedSigner
    && dryRunUnfundedSigner.status === 'ok'
    && Number(dryRunUnfundedSigner.payloadSummary && dryRunUnfundedSigner.payloadSummary.preflightBlockerCount) > 0
    && dryRunUnfundedSigner.payloadSummary.preflightReady === false
  ) {
    strengths.push({
      stepId: dryRunUnfundedSigner.id,
      title: 'Signer-attached parimutuel dry-run now returns structured readiness blockers',
      detail:
        'Once signer credentials are attached, dry-run stays in preflight mode and returns explicit blocker data for gas, poll fees, and liquidity instead of failing through a raw simulation error.',
    });
  } else if (
    dryRunUnfundedSigner
    && dryRunUnfundedSigner.status === 'expected-blocker'
    && /insufficient funds|insufficient native balance|insufficient usdc balance/i.test(String(dryRunUnfundedSigner.errorMessage || ''))
  ) {
    frictionPoints.push({
      severity: 'high',
      stepId: dryRunUnfundedSigner.id,
      area: 'execution-readiness',
      title: 'Parimutuel dry-run becomes execution-like as soon as a signer is attached',
      detail:
        'Once the user adds signer credentials, dry-run simulates the on-chain parimutuel creation path and fails on funds instead of staying a purely structural preview.',
      recommendation:
        'Return a structured readiness/preflight blocker before transaction simulation, or expose a readiness-only MCP surface for signer-attached parimutuel deploy flows.',
    });
  }

  const recommendations = frictionPoints
    .map((item) => item.recommendation)
    .filter(Boolean)
    .filter((value, index, collection) => collection.indexOf(value) === index);

  return {
    frictionPoints: frictionPoints.sort((left, right) => compareStableStrings(left.title, right.title)),
    strengths: strengths.sort((left, right) => compareStableStrings(left.title, right.title)),
    recommendations,
  };
}

function buildRuntimeEnv(baseEnv, rpcUrl, privateKey) {
  return {
    ...baseEnv,
    CHAIN_ID: '1',
    RPC_URL: rpcUrl,
    PANDORA_PRIVATE_KEY: privateKey,
    PRIVATE_KEY: privateKey,
    ORACLE: ADDRESSES.oracle,
    FACTORY: ADDRESSES.factory,
    USDC: ADDRESSES.usdc,
  };
}

function buildSdkAmmPlanInput(useCliLikeStrings = false) {
  return {
    'market-type': AMM_MARKET.marketType,
    question: AMM_MARKET.question,
    rules: AMM_MARKET.rules,
    sources: [...AMM_MARKET.sources],
    'target-timestamp': AMM_MARKET.targetTimestamp,
    'liquidity-usdc': useCliLikeStrings ? String(AMM_MARKET.liquidityUsdc) : AMM_MARKET.liquidityUsdc,
    'fee-tier': AMM_MARKET.feeTier,
  };
}

function buildSdkAmmDryRunInput() {
  return {
    ...buildSdkAmmPlanInput(false),
    'dry-run': true,
    'tx-route': AMM_MARKET.txRoute,
  };
}

function buildSdkAmmValidateInput() {
  return {
    question: AMM_MARKET.question,
    rules: AMM_MARKET.rules,
    sources: [...AMM_MARKET.sources],
    'target-timestamp': Number.parseInt(AMM_MARKET.targetTimestamp, 10),
  };
}

function buildMcpParimutuelPlanInput() {
  return {
    'market-type': PARIMUTUEL_MARKET.marketType,
    question: PARIMUTUEL_MARKET.question,
    rules: PARIMUTUEL_MARKET.rules,
    sources: [...PARIMUTUEL_MARKET.sources],
    'target-timestamp': PARIMUTUEL_MARKET.targetTimestamp,
    'liquidity-usdc': PARIMUTUEL_MARKET.liquidityUsdc,
    'distribution-yes-pct': SKEWED_PARIMUTUEL_DISTRIBUTION.yesPct,
    'distribution-no-pct': SKEWED_PARIMUTUEL_DISTRIBUTION.noPct,
    'curve-flattener': PARIMUTUEL_MARKET.curveFlattener,
    'curve-offset': PARIMUTUEL_MARKET.curveOffset,
  };
}

function buildMcpParimutuelValidateInput() {
  return {
    question: PARIMUTUEL_MARKET.question,
    rules: PARIMUTUEL_MARKET.rules,
    sources: [...PARIMUTUEL_MARKET.sources],
    'target-timestamp': PARIMUTUEL_MARKET.targetTimestamp,
  };
}

function buildMcpParimutuelDryRunInput() {
  return {
    ...buildMcpParimutuelPlanInput(),
    'dry-run': true,
  };
}

function buildCliParimutuelArgs(command) {
  const args = [
    '--output',
    'json',
    'markets',
    'create',
    command,
    '--market-type',
    PARIMUTUEL_MARKET.marketType,
    '--question',
    PARIMUTUEL_MARKET.question,
    '--rules',
    PARIMUTUEL_MARKET.rules,
    '--sources',
    ...PARIMUTUEL_MARKET.sources,
    '--target-timestamp',
    PARIMUTUEL_MARKET.targetTimestamp,
    '--liquidity-usdc',
    String(PARIMUTUEL_MARKET.liquidityUsdc),
    '--curve-flattener',
    String(PARIMUTUEL_MARKET.curveFlattener),
    '--curve-offset',
    String(PARIMUTUEL_MARKET.curveOffset),
  ];
  if (command === 'run') {
    args.push('--dry-run');
  }
  return args;
}

function buildCliAmmExecuteArgs(validationTicket, includeValidationTicket, privateKey, rpcUrl) {
  const args = [
    '--output',
    'json',
    'markets',
    'create',
    'run',
    '--market-type',
    AMM_MARKET.marketType,
    '--question',
    AMM_MARKET.question,
    '--rules',
    AMM_MARKET.rules,
    '--sources',
    ...AMM_MARKET.sources,
    '--target-timestamp',
    AMM_MARKET.targetTimestamp,
    '--liquidity-usdc',
    String(AMM_MARKET.liquidityUsdc),
    '--fee-tier',
    String(AMM_MARKET.feeTier),
    '--execute',
    '--private-key',
    privateKey,
    '--rpc-url',
    rpcUrl,
    '--skip-dotenv',
  ];
  if (includeValidationTicket && validationTicket) {
    args.push('--validation-ticket', validationTicket);
  }
  return args;
}

function buildCliParimutuelExecuteArgs(validationTicket, privateKey, rpcUrl) {
  return [
    '--output',
    'json',
    'markets',
    'create',
    'run',
    '--market-type',
    PARIMUTUEL_MARKET.marketType,
    '--question',
    PARIMUTUEL_MARKET.question,
    '--rules',
    PARIMUTUEL_MARKET.rules,
    '--sources',
    ...PARIMUTUEL_MARKET.sources,
    '--target-timestamp',
    PARIMUTUEL_MARKET.targetTimestamp,
    '--liquidity-usdc',
    String(PARIMUTUEL_MARKET.liquidityUsdc),
    '--curve-flattener',
    String(PARIMUTUEL_MARKET.curveFlattener),
    '--curve-offset',
    String(PARIMUTUEL_MARKET.curveOffset),
    '--execute',
    '--private-key',
    privateKey,
    '--rpc-url',
    rpcUrl,
    '--validation-ticket',
    validationTicket,
    '--skip-dotenv',
  ];
}

async function runDeployerJourney(options = {}) {
  const tempRoot = createTempDir('pandora-user-journey-deployer-');
  const baseEnv = createIsolatedPandoraEnv(tempRoot);
  const liveRpcUrl = options.rpcUrl || DEFAULT_MAINNET_RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[1];
  const workdir = path.join(tempRoot, 'workspace');
  const fixturesDir = path.join(tempRoot, 'fixtures');
  const guidedEnvPath = path.join(workdir, '.env');
  const defaultEnvPath = path.join(workdir, 'default.env');
  const exampleEnvPath = path.join(fixturesDir, '.env.example');

  fs.mkdirSync(workdir, { recursive: true });
  fs.mkdirSync(fixturesDir, { recursive: true });

  const steps = [];
  let sdkClient = null;
  const freshSigner = await generateFreshZeroBalanceSigner(liveRpcUrl);

  try {
    const defaultSetup = await runCliJsonStep({
      id: 'cli.setup.default',
      title: 'Fresh user runs setup with the bundled example',
      surface: 'cli',
      command: 'pandora',
      args: ['--output', 'json', 'setup', '--dotenv-path', defaultEnvPath],
      env: baseEnv,
      expectFailure: false,
      notes: ['This simulates a first run with no handcrafted env file.'],
    });
    steps.push(defaultSetup.step);

    fs.writeFileSync(exampleEnvPath, buildValidEnv(liveRpcUrl, freshSigner.privateKey));

    const guidedSetup = await runCliJsonStep({
      id: 'cli.setup.guided',
      title: 'User supplies a valid env example and reruns setup',
      surface: 'cli',
      command: 'pandora',
      args: ['--output', 'json', 'setup', '--example', exampleEnvPath, '--dotenv-path', guidedEnvPath],
      env: baseEnv,
      expectFailure: false,
      notes: ['This is the corrected setup path after the naive first run fails.'],
    });
    steps.push(guidedSetup.step);

    const runtimeEnv = buildRuntimeEnv(baseEnv, liveRpcUrl, freshSigner.privateKey);

    const cliBootstrap = await runCliJsonStep({
      id: 'cli.bootstrap',
      title: 'Bootstrap the agent-facing surface from CLI JSON',
      surface: 'cli',
      command: 'pandora',
      args: ['--output', 'json', 'bootstrap'],
      env: runtimeEnv,
      expectFailure: false,
    });
    steps.push(cliBootstrap.step);

    const profileExplain = await runCliJsonStep({
      id: 'cli.profile.explain.deployer',
      title: 'Check whether the built-in mutable profile can deploy markets',
      surface: 'cli',
      command: 'pandora',
      args: [
        '--output',
        'json',
        'profile',
        'explain',
        '--id',
        'prod_trader_a',
        '--command',
        'markets.create.run',
        '--mode',
        'execute',
        '--chain-id',
        '1',
        '--category',
        'Crypto',
        '--policy-id',
        'execute-with-validation',
      ],
      env: runtimeEnv,
      expectFailure: false,
    });
    steps.push(profileExplain.step);

    await withRawMcpClient({ cwd: REPO_ROOT, env: runtimeEnv }, async (client) => {
      const mcpBootstrap = await runMcpStep(
        {
          id: 'mcp.bootstrap',
          title: 'Bootstrap the raw MCP surface directly',
          surface: 'mcp',
          toolName: 'bootstrap',
          input: {},
        },
        client,
        'bootstrap',
        {},
      );
      steps.push(mcpBootstrap.step);

      const mcpAmmPlan = await runMcpStep(
        {
          id: 'mcp.amm.plan',
          title: 'Plan AMM creation through raw MCP',
          surface: 'mcp',
          toolName: 'markets.create.plan',
          input: buildSdkAmmPlanInput(false),
        },
        client,
        'markets.create.plan',
        buildSdkAmmPlanInput(false),
      );
      steps.push(mcpAmmPlan.step);
    });

    sdkClient = createLocalPandoraAgentClient({
      command: process.execPath,
      args: [path.join(REPO_ROOT, 'cli', 'pandora.cjs'), 'mcp'],
      cwd: REPO_ROOT,
      env: runtimeEnv,
    });
    await sdkClient.connect();

    const sdkBootstrap = await runSdkStep(
      {
        id: 'sdk.bootstrap',
        title: 'Bootstrap over SDK using stdio MCP',
        surface: 'sdk+mcp',
      },
      () => sdkClient.getBootstrap(),
    );
    steps.push(sdkBootstrap.step);

    const sdkCliishPlan = await runSdkStep(
      {
        id: 'sdk.amm.plan.cliish-inputs',
        title: 'Attempt AMM planning with CLI-like JSON strings',
        surface: 'sdk+mcp',
        toolName: 'markets.create.plan',
        input: buildSdkAmmPlanInput(true),
        expectFailure: false,
      },
      () => sdkClient.callTool('markets.create.plan', buildSdkAmmPlanInput(true)),
    );
    steps.push(sdkCliishPlan.step);

    const sdkAmmPlan = await runSdkStep(
      {
        id: 'sdk.amm.plan',
        title: 'Plan AMM creation through SDK/MCP with corrected types',
        surface: 'sdk+mcp',
        toolName: 'markets.create.plan',
        input: buildSdkAmmPlanInput(false),
      },
      () => sdkClient.callTool('markets.create.plan', buildSdkAmmPlanInput(false)),
    );
    steps.push(sdkAmmPlan.step);

    const sdkAmmValidate = await runSdkStep(
      {
        id: 'sdk.amm.validate',
        title: 'Generate the AMM validation ticket through SDK/MCP',
        surface: 'sdk+mcp',
        toolName: 'agent.market.validate',
        input: buildSdkAmmValidateInput(),
      },
      () => sdkClient.callTool('agent.market.validate', buildSdkAmmValidateInput()),
    );
    steps.push(sdkAmmValidate.step);

    const sdkAmmDryRun = await runSdkStep(
      {
        id: 'sdk.amm.dry-run',
        title: 'Dry-run the AMM deployment through SDK/MCP',
        surface: 'sdk+mcp',
        toolName: 'markets.create.run',
        input: buildSdkAmmDryRunInput(),
      },
      () => sdkClient.callTool('markets.create.run', buildSdkAmmDryRunInput()),
    );
    steps.push(sdkAmmDryRun.step);

    const cliAmmNoValidation = await runCliJsonStep({
      id: 'cli.amm.execute.no-validation',
      title: 'Try live AMM execution without the validation ticket',
      surface: 'cli',
      command: 'pandora',
      args: buildCliAmmExecuteArgs(null, false, freshSigner.privateKey, liveRpcUrl),
      env: baseEnv,
      expectFailure: true,
      timeoutMs: 90_000,
    });
    steps.push(cliAmmNoValidation.step);

    const ammValidationTicket =
      sdkAmmValidate.value && sdkAmmValidate.value.data && sdkAmmValidate.value.data.ticket
        ? sdkAmmValidate.value.data.ticket
        : null;

    const cliAmmWithValidation = await runCliJsonStep({
      id: 'cli.amm.execute.with-validation',
      title: 'Try live AMM execution with a valid ticket and a fresh zero-balance signer',
      surface: 'cli',
      command: 'pandora',
      args: buildCliAmmExecuteArgs(ammValidationTicket, true, freshSigner.privateKey, liveRpcUrl),
      env: baseEnv,
      expectFailure: true,
      timeoutMs: 90_000,
    });
    steps.push(cliAmmWithValidation.step);

    const cliParimutuelPlan = await runCliJsonStep({
      id: 'cli.parimutuel.plan',
      title: 'Plan parimutuel market creation via CLI',
      surface: 'cli',
      command: 'pandora',
      args: buildCliParimutuelArgs('plan'),
      env: runtimeEnv,
      expectFailure: false,
    });
    steps.push(cliParimutuelPlan.step);

    const cliParimutuelValidate = await runCliJsonStep({
      id: 'cli.parimutuel.validate',
      title: 'Generate the parimutuel validation ticket via CLI',
      surface: 'cli',
      command: 'pandora',
      args: [
        '--output',
        'json',
        'agent',
        'market',
        'validate',
        '--question',
        PARIMUTUEL_MARKET.question,
        '--rules',
        PARIMUTUEL_MARKET.rules,
        '--sources',
        ...PARIMUTUEL_MARKET.sources,
        '--target-timestamp',
        PARIMUTUEL_MARKET.targetTimestamp,
      ],
      env: runtimeEnv,
      expectFailure: false,
    });
    steps.push(cliParimutuelValidate.step);

    const cliParimutuelDryRun = await runCliJsonStep({
      id: 'cli.parimutuel.dry-run',
      title: 'Dry-run parimutuel deployment via CLI',
      surface: 'cli',
      command: 'pandora',
      args: buildCliParimutuelArgs('run'),
      env: runtimeEnv,
      expectFailure: false,
    });
    steps.push(cliParimutuelDryRun.step);

    const parimutuelValidationTicket =
      cliParimutuelValidate.payload && cliParimutuelValidate.payload.data && cliParimutuelValidate.payload.data.ticket
        ? cliParimutuelValidate.payload.data.ticket
        : null;

    const cliParimutuelExecute = await runCliJsonStep({
      id: 'cli.parimutuel.execute.with-validation',
      title: 'Try live parimutuel execution with a valid ticket and a fresh zero-balance signer',
      surface: 'cli',
      command: 'pandora',
      args: buildCliParimutuelExecuteArgs(parimutuelValidationTicket, freshSigner.privateKey, liveRpcUrl),
      env: baseEnv,
      expectFailure: true,
      timeoutMs: 90_000,
    });
    steps.push(cliParimutuelExecute.step);

    const assessment = deriveDeployerAssessment(steps);
    const unexpectedFailureCount = steps.filter((step) => step.passed !== true).length;
    const expectedBlockerCount = steps.filter((step) => step.status === 'expected-blocker').length;

    return {
      scenarioId: 'deployer',
      title: 'The Deployer',
      generatedAt: new Date().toISOString(),
      packageVersion: pkg.version,
      ok: unexpectedFailureCount === 0,
      userGoal:
        'Fresh deployer attempts to set up Pandora and create one AMM market plus one parimutuel market.',
      userGoalStatus: 'blocked-before-funded-live-execution',
      workdirKept: options.keepWorkdir === true,
      workdir: options.keepWorkdir === true ? tempRoot : null,
      walletProbe: {
        address: freshSigner.address,
        nativeBalanceWei: freshSigner.nativeBalanceWei,
        nonce: freshSigner.nonce,
      },
      summary: {
        stepCount: steps.length,
        passedCount: steps.filter((step) => step.passed === true).length,
        expectedBlockerCount,
        unexpectedFailureCount,
        frictionCount: assessment.frictionPoints.length,
        strengthCount: assessment.strengths.length,
      },
      marketResults: {
        amm: {
          surface: 'sdk+mcp',
          planned: byBooleanStatus(steps, 'sdk.amm.plan'),
          validated: byBooleanStatus(steps, 'sdk.amm.validate'),
          dryRun: byBooleanStatus(steps, 'sdk.amm.dry-run'),
          liveExecute: 'blocked-insufficient-funds',
        },
        parimutuel: {
          surface: 'cli',
          planned: byBooleanStatus(steps, 'cli.parimutuel.plan'),
          validated: byBooleanStatus(steps, 'cli.parimutuel.validate'),
          dryRun: byBooleanStatus(steps, 'cli.parimutuel.dry-run'),
          liveExecute: 'blocked-insufficient-funds',
        },
      },
      steps,
      frictionPoints: assessment.frictionPoints,
      strengths: assessment.strengths,
      recommendations: assessment.recommendations,
    };
  } finally {
    if (sdkClient) {
      try {
        await sdkClient.close();
      } catch {}
    }
    if (options.keepWorkdir !== true) {
      removeDir(tempRoot);
    }
  }
}

async function runMcpParimutuelJourney(options = {}) {
  const tempRoot = createTempDir('pandora-user-journey-mcp-parimutuel-');
  const baseEnv = createIsolatedPandoraEnv(tempRoot);
  const liveRpcUrl = options.rpcUrl || DEFAULT_MAINNET_RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[1];
  const workdir = path.join(tempRoot, 'workspace');

  fs.mkdirSync(workdir, { recursive: true });

  const steps = [];
  const freshSigner = await generateFreshZeroBalanceSigner(liveRpcUrl);

  try {
    await withRawMcpClient({ cwd: workdir, env: baseEnv }, async (client) => {
      const bootstrap = await runMcpStep(
        {
          id: 'mcp.parimutuel.bootstrap',
          title: 'Fresh MCP user bootstraps Pandora',
          surface: 'mcp',
          toolName: 'bootstrap',
          input: {},
          notes: ['This simulates a cold agent connecting to Pandora through MCP first.'],
        },
        client,
        'bootstrap',
        {},
      );
      steps.push(bootstrap.step);

      const profileRecommend = await runMcpStep(
        {
          id: 'mcp.parimutuel.profile.recommend',
          title: 'Discover the recommended deployer profile through MCP',
          surface: 'mcp',
          toolName: 'profile.recommend',
          input: {
            command: 'markets.create.run',
            mode: 'execute',
            'chain-id': '1',
            category: 'Crypto',
            'policy-id': 'execute-with-validation',
          },
        },
        client,
        'profile.recommend',
        {
          command: 'markets.create.run',
          mode: 'execute',
          'chain-id': '1',
          category: 'Crypto',
          'policy-id': 'execute-with-validation',
        },
      );
      steps.push(profileRecommend.step);

      const hypePlan = await runMcpStep(
        {
          id: 'mcp.parimutuel.hype.plan.mock',
          title: 'Ask Pandora to suggest parimutuel markets in deterministic mock mode',
          surface: 'mcp',
          toolName: 'markets.hype.plan',
          input: {
            area: 'politics',
            query: HYPE_QUERY,
            'market-type': 'parimutuel',
            'candidate-count': 3,
            'ai-provider': 'mock',
            'liquidity-usdc': 100,
          },
          notes: ['The mock provider keeps this scenario deterministic, but it also reveals suggestion-quality limits.'],
        },
        client,
        'markets.hype.plan',
        {
          area: 'politics',
          query: HYPE_QUERY,
          'market-type': 'parimutuel',
          'candidate-count': 3,
          'ai-provider': 'mock',
          'liquidity-usdc': 100,
        },
      );
      steps.push(hypePlan.step);

      const autocomplete = await runMcpStep(
        {
          id: 'mcp.parimutuel.autocomplete',
          title: 'Ask the agent prompt surface to refine a parimutuel seed market',
          surface: 'mcp',
          toolName: 'agent.market.autocomplete',
          input: {
            question: PARIMUTUEL_MARKET.question,
            'market-type': 'parimutuel',
          },
        },
        client,
        'agent.market.autocomplete',
        {
          question: PARIMUTUEL_MARKET.question,
          'market-type': 'parimutuel',
        },
      );
      steps.push(autocomplete.step);

      const skewedPlan = await runMcpStep(
        {
          id: 'mcp.parimutuel.plan.skewed',
          title: 'Plan a 99.9/0.1 parimutuel market through MCP',
          surface: 'mcp',
          toolName: 'markets.create.plan',
          input: buildMcpParimutuelPlanInput(),
        },
        client,
        'markets.create.plan',
        buildMcpParimutuelPlanInput(),
      );
      steps.push(skewedPlan.step);

      const validate = await runMcpStep(
        {
          id: 'mcp.parimutuel.validate.skewed',
          title: 'Validate the skewed parimutuel market through MCP',
          surface: 'mcp',
          toolName: 'agent.market.validate',
          input: buildMcpParimutuelValidateInput(),
        },
        client,
        'agent.market.validate',
        buildMcpParimutuelValidateInput(),
      );
      steps.push(validate.step);

      const dryRunNoSigner = await runMcpStep(
        {
          id: 'mcp.parimutuel.dry-run.no-signer',
          title: 'Dry-run the skewed parimutuel market before signer setup',
          surface: 'mcp',
          toolName: 'markets.create.run',
          input: buildMcpParimutuelDryRunInput(),
        },
        client,
        'markets.create.run',
        buildMcpParimutuelDryRunInput(),
      );
      steps.push(dryRunNoSigner.step);
    });

    const runtimeEnv = buildRuntimeEnv(baseEnv, liveRpcUrl, freshSigner.privateKey);
    await withRawMcpClient({ cwd: workdir, env: runtimeEnv }, async (client) => {
      const dryRunUnfundedSigner = await runMcpStep(
        {
          id: 'mcp.parimutuel.dry-run.unfunded-signer',
          title: 'Dry-run again after attaching an unfunded deployer signer',
          surface: 'mcp',
          toolName: 'markets.create.run',
          input: buildMcpParimutuelDryRunInput(),
          expectFailure: false,
          notes: ['This isolates the signer-attached path and checks whether dry-run returns structured readiness blockers before any execution-like simulation failure.'],
        },
        client,
        'markets.create.run',
        buildMcpParimutuelDryRunInput(),
      );
      steps.push(dryRunUnfundedSigner.step);
    });

    const assessment = deriveMcpParimutuelAssessment(steps);
    const unexpectedFailureCount = steps.filter((step) => step.passed !== true).length;
    const expectedBlockerCount = steps.filter((step) => step.status === 'expected-blocker').length;

    return {
      scenarioId: 'mcp-parimutuel',
      title: 'The MCP Parimutuel Newcomer',
      generatedAt: new Date().toISOString(),
      packageVersion: pkg.version,
      ok: unexpectedFailureCount === 0,
      userGoal:
        'A fresh MCP user wants the agent to suggest markets, explain parimutuel basics, and plan a 99.9/0.1 parimutuel market.',
      userGoalStatus: 'guided-to-plan-with-structured-signer-readiness-blockers',
      workdirKept: options.keepWorkdir === true,
      workdir: options.keepWorkdir === true ? tempRoot : null,
      walletProbe: {
        address: freshSigner.address,
        nativeBalanceWei: freshSigner.nativeBalanceWei,
        nonce: freshSigner.nonce,
      },
      summary: {
        stepCount: steps.length,
        passedCount: steps.filter((step) => step.passed === true).length,
        expectedBlockerCount,
        unexpectedFailureCount,
        frictionCount: assessment.frictionPoints.length,
        strengthCount: assessment.strengths.length,
      },
      journeyResults: {
        suggestions: {
          suggested: byBooleanStatus(steps, 'mcp.parimutuel.hype.plan.mock'),
          deterministicQuality: 'mock-test-only-routed-to-provider-backed-default',
        },
        parimutuelSkew: {
          explained: byBooleanStatus(steps, 'mcp.parimutuel.autocomplete'),
          planned: byBooleanStatus(steps, 'mcp.parimutuel.plan.skewed'),
          validated: byBooleanStatus(steps, 'mcp.parimutuel.validate.skewed'),
          dryRunBeforeSigner: byBooleanStatus(steps, 'mcp.parimutuel.dry-run.no-signer'),
          dryRunWithSigner: 'structured-readiness-blockers',
        },
      },
      steps,
      frictionPoints: assessment.frictionPoints,
      strengths: assessment.strengths,
      recommendations: assessment.recommendations,
    };
  } finally {
    if (options.keepWorkdir !== true) {
      removeDir(tempRoot);
    }
  }
}

function byBooleanStatus(steps, stepId) {
  const step = (Array.isArray(steps) ? steps : []).find((entry) => entry.id === stepId);
  return Boolean(step && step.status === 'ok');
}

function buildAssessmentResult({ frictionPoints = [], strengths = [], recommendations = [], classification = null }) {
  return {
    frictionPoints: frictionPoints.sort((left, right) => compareStableStrings(left.title, right.title)),
    strengths: strengths.sort((left, right) => compareStableStrings(left.title, right.title)),
    recommendations: recommendations.filter(Boolean).filter((value, index, collection) => collection.indexOf(value) === index),
    classification: classification && typeof classification === 'object'
      ? {
          kind: String(classification.kind || DEFAULT_JOURNEY_CLASSIFICATION.kind),
          guidanceQuality: String(classification.guidanceQuality || DEFAULT_JOURNEY_CLASSIFICATION.guidanceQuality),
          externallyBlocked: classification.externallyBlocked === true,
          note: classification.note ? String(classification.note) : null,
        }
      : { ...DEFAULT_JOURNEY_CLASSIFICATION, note: null },
  };
}

function deriveJourneyClassification(userGoalStatus, assessment) {
  const explicit = assessment && assessment.classification ? assessment.classification : null;
  if (explicit) {
    return {
      kind: explicit.kind,
      guidanceQuality: explicit.guidanceQuality,
      externallyBlocked: explicit.externallyBlocked === true,
      note: explicit.note || null,
    };
  }
  if (userGoalStatus === 'achieved') {
    return {
      kind: 'achieved',
      guidanceQuality: 'clear',
      externallyBlocked: false,
      note: null,
    };
  }
  return {
    kind: 'product-state',
    guidanceQuality: 'unspecified',
    externallyBlocked: false,
    note: null,
  };
}

function stepById(steps, stepId) {
  return collectStepMap(steps).get(stepId) || null;
}

function createScenarioReport(meta, steps, assessment, options, tempRoot, extra = {}) {
  const unexpectedFailureCount = steps.filter((step) => step.passed !== true).length;
  const expectedBlockerCount = steps.filter((step) => step.status === 'expected-blocker').length;
  const journeyClassification = deriveJourneyClassification(meta.userGoalStatus, assessment);
  return {
    scenarioId: meta.scenarioId,
    title: meta.title,
    generatedAt: new Date().toISOString(),
    packageVersion: pkg.version,
    ok: unexpectedFailureCount === 0,
    userGoal: meta.userGoal,
    userGoalStatus: meta.userGoalStatus,
    workdirKept: options.keepWorkdir === true,
    workdir: options.keepWorkdir === true ? tempRoot : null,
    summary: {
      stepCount: steps.length,
      passedCount: steps.filter((step) => step.passed === true).length,
      expectedBlockerCount,
      unexpectedFailureCount,
      frictionCount: assessment.frictionPoints.length,
      strengthCount: assessment.strengths.length,
      journeyClassification,
    },
    steps,
    frictionPoints: assessment.frictionPoints,
    strengths: assessment.strengths,
    recommendations: assessment.recommendations,
    ...extra,
  };
}

async function withIsolatedCliScenario(prefix, options, fn) {
  const tempRoot = createTempDir(prefix);
  const baseEnv = createIsolatedPandoraEnv(tempRoot);
  const workdir = path.join(tempRoot, 'workspace');
  fs.mkdirSync(workdir, { recursive: true });

  try {
    return await fn({
      tempRoot,
      baseEnv,
      workdir,
      liveRpcUrl: options.rpcUrl || DEFAULT_MAINNET_RPC_URL || DEFAULT_RPC_BY_CHAIN_ID[1],
      strictUnsetEnvKeys: STRICT_EXTERNAL_UNSET_ENV_KEYS,
    });
  } finally {
    if (options.keepWorkdir !== true) {
      removeDir(tempRoot);
    }
  }
}

async function runCliScenarioSteps(context, stepDefinitions) {
  const steps = [];
  const outputs = new Map();

  for (const definitionOrFactory of Array.isArray(stepDefinitions) ? stepDefinitions : []) {
    const definition = typeof definitionOrFactory === 'function'
      ? await definitionOrFactory({ context, steps, outputs })
      : definitionOrFactory;
    const outcome = await runCliJsonStep({
      command: 'pandora',
      surface: 'cli',
      cwd: definition.cwd || context.workdir,
      env: definition.env || context.baseEnv,
      unsetEnvKeys: definition.unsetEnvKeys || context.strictUnsetEnvKeys,
      ...definition,
    });
    steps.push(outcome.step);
    outputs.set(definition.id, outcome);
  }

  return { steps, outputs };
}

async function runBootstrapReadonlyDiscoveryJourney(options = {}) {
  return withIsolatedCliScenario('pandora-user-journey-bootstrap-readonly-', options, async (context) => {
    const { steps } = await runCliScenarioSteps(context, [
      {
        id: 'readonly.bootstrap',
        title: 'Cold user runs bootstrap for canonical discovery',
        args: ['--output', 'json', 'bootstrap'],
      },
      {
        id: 'readonly.capabilities',
        title: 'Cold user inspects runtime-local capabilities',
        args: ['--output', 'json', 'capabilities', '--runtime-local-readiness'],
      },
      {
        id: 'readonly.schema',
        title: 'Cold user inspects machine-readable schema',
        args: ['--output', 'json', 'schema'],
      },
      {
        id: 'readonly.profile.list',
        title: 'Cold user lists built-in signer profiles',
        args: ['--output', 'json', 'profile', 'list'],
      },
      {
        id: 'readonly.policy.list',
        title: 'Cold user lists built-in policy packs',
        args: ['--output', 'json', 'policy', 'list'],
      },
    ]);

    const assessment = buildAssessmentResult({
      strengths: [
        {
          area: 'discovery',
          title: 'Cold-start discovery works without signer or wallet setup',
          detail: 'Bootstrap, capabilities, schema, profile list, and policy list all returned machine-readable onboarding data in a fresh isolated environment.',
        },
        {
          area: 'readiness',
          title: 'Read-only profile posture is explicit on first contact',
          detail: 'The runtime-local capabilities snapshot still shows only the read-only built-in profile as ready, which keeps discovery safe by default.',
        },
      ],
      recommendations: [
        'Keep bootstrap, capabilities, schema, profile list, and policy list as the public first-run path for users with no secrets.',
      ],
    });

    return createScenarioReport(
      {
        scenarioId: 'bootstrap-readonly-discovery',
        title: 'Bootstrap Read-Only Discovery',
        userGoal: 'A fresh CLI user wants to understand Pandora safely before touching any wallet or secret material.',
        userGoalStatus: 'achieved',
      },
      steps,
      assessment,
      options,
      context.tempRoot,
    );
  });
}

async function runPolicyProfileAuditJourney(options = {}) {
  return withIsolatedCliScenario('pandora-user-journey-policy-profile-', options, async (context) => {
    const { steps } = await runCliScenarioSteps(context, [
      {
        id: 'audit.policy.list',
        title: 'List built-in policies before enabling mutation',
        args: ['--output', 'json', 'policy', 'list'],
      },
      {
        id: 'audit.policy.recommend.trade',
        title: 'Ask policy recommend about live trade execution',
        args: ['--output', 'json', 'policy', 'recommend', '--command', 'trade', '--mode', 'execute', '--chain-id', '1', '--category', 'Crypto'],
      },
      {
        id: 'audit.profile.list',
        title: 'List built-in signer profiles',
        args: ['--output', 'json', 'profile', 'list'],
      },
      {
        id: 'audit.profile.explain.observer',
        title: 'Explain the read-only observer profile against quote',
        args: ['--output', 'json', 'profile', 'explain', '--id', 'market_observer_ro', '--command', 'quote', '--chain-id', '1'],
      },
      {
        id: 'audit.profile.explain.deployer',
        title: 'Explain the deployer profile against live market creation',
        args: [
          '--output',
          'json',
          'profile',
          'explain',
          '--id',
          'market_deployer_a',
          '--command',
          'markets.create.run',
          '--mode',
          'execute',
          '--chain-id',
          '1',
          '--category',
          'Crypto',
          '--policy-id',
          'execute-with-validation',
        ],
      },
    ]);

    const policyRecommend = stepById(steps, 'audit.policy.recommend.trade');
    const assessment = buildAssessmentResult({
      frictionPoints:
        policyRecommend
        && policyRecommend.status === 'ok'
        && policyRecommend.payloadSummary
        && policyRecommend.payloadSummary.recommendedPolicyId === 'execute-with-risk-cap'
          ? [
              {
                severity: 'medium',
                stepId: policyRecommend.id,
                area: 'policy',
                title: 'Policy recommend still points at a denying live-trade pack',
                detail: 'For live trade, policy.recommend chooses execute-with-risk-cap even though the returned recommendation still denies trade and redirects to quote.',
                recommendation: 'Prefer a recommendation contract that surfaces the actually usable safe mode or next tool first when the requested execution path remains denied.',
              },
            ]
          : [],
      strengths: [
        {
          area: 'policy',
          title: 'Policy and profile reasoning is explicit before mutation',
          detail: 'Policy list, policy recommend, profile list, and profile explain all returned structured remediation instead of forcing trial-and-error execution.',
        },
        {
          area: 'readiness',
          title: 'Read-only and deployer profiles describe different readiness states clearly',
          detail: 'The observer profile is ready for quote-style reads, while the deployer profile clearly reports missing signer secrets and missing network context.',
        },
      ],
      recommendations: [
        'Keep policy recommend and profile explain central in onboarding, but make sure a recommended policy is actually usable for the requested path.',
      ],
    });

    return createScenarioReport(
      {
        scenarioId: 'policy-profile-audit',
        title: 'Policy And Profile Audit',
        userGoal: 'A security-conscious user wants to understand what is allowed before enabling any mutation.',
        userGoalStatus: 'achieved',
      },
      steps,
      assessment,
      options,
      context.tempRoot,
    );
  });
}

async function runHypeNoAiKeysJourney(options = {}) {
  return withIsolatedCliScenario('pandora-user-journey-hype-no-ai-', options, async (context) => {
    const { steps } = await runCliScenarioSteps(context, [
      {
        id: 'hype.mock.plan',
        title: 'Generate deterministic market ideas without live AI keys',
        args: [
          '--output',
          'json',
          'markets',
          'hype',
          'plan',
          '--area',
          'politics',
          '--query',
          HYPE_FALLBACK_QUERY,
          '--market-type',
          'amm',
          '--candidate-count',
          '3',
          '--ai-provider',
          'mock',
          '--liquidity-usdc',
          '100',
        ],
      },
      {
        id: 'hype.agent.prompt.missing-area',
        title: 'Try the fallback agent prompt without the required area',
        args: ['--output', 'json', 'agent', 'market', 'hype', '--query', HYPE_FALLBACK_QUERY],
        expectFailure: true,
      },
      {
        id: 'hype.agent.prompt.with-area',
        title: 'Use the fallback agent prompt correctly with area',
        args: ['--output', 'json', 'agent', 'market', 'hype', '--area', 'politics', '--query', HYPE_FALLBACK_QUERY],
      },
    ]);

    const assessment = buildAssessmentResult({
      frictionPoints: [
        {
          severity: 'medium',
          stepId: 'hype.mock.plan',
          area: 'ideation',
          title: 'Mock hype planning is operational but still placeholder quality',
          detail: 'The deterministic no-key path works, but it still returns obviously mock research and duplicate-risk hints rather than production-grade suggestions.',
          recommendation: 'Keep mock mode for tests only and steer real users toward provider-backed markets.hype.plan first.',
        },
      ],
      strengths: [
        {
          area: 'ideation',
          title: 'No-key ideation still has a usable deterministic path',
          detail: 'markets.hype.plan with --ai-provider mock worked in a clean environment and explicitly advertised the preferred provider-backed path plus the agent.market.hype fallback.',
        },
        {
          area: 'fallback',
          title: 'Prompt-only fallback remains available when provider-backed planning is not possible',
          detail: 'Once area was supplied, agent.market.hype emitted the full research prompt contract for an external agent to continue the ideation workflow.',
        },
        {
          area: 'fallback',
          title: 'Fallback prompt mode now gives a working next command when area is missing',
          detail: 'The missing-area failure now names the valid areas and includes a concrete retry example instead of stopping at a generic required-flag error.',
        },
      ],
      recommendations: [
        'Mark mock hype planning as test-only everywhere and make provider-backed planning the default recommendation for real users.',
      ],
      classification: {
        kind: 'external-prerequisite',
        guidanceQuality: 'clear',
        externallyBlocked: true,
        note: 'The remaining limitation is the absence of a real AI provider for production-grade suggestion quality, not unclear routing.',
      },
    });

    return createScenarioReport(
      {
        scenarioId: 'hype-no-ai-keys',
        title: 'Hype Planning Without AI Keys',
        userGoal: 'A fresh user wants market suggestions without live AI-provider credentials.',
        userGoalStatus: 'achieved-with-test-only-guidance',
      },
      steps,
      assessment,
      options,
      context.tempRoot,
    );
  });
}

async function runResearchTraderDryRunJourney(options = {}) {
  return withIsolatedCliScenario('pandora-user-journey-research-trader-', options, async (context) => {
    const { steps } = await runCliScenarioSteps(context, [
      {
        id: 'trade.list',
        title: 'List public Pandora markets',
        args: ['--output', 'json', 'markets', 'list', '--limit', '1', '--with-odds'],
      },
      {
        id: 'trade.get',
        title: 'Inspect one known market deeply',
        args: ['--output', 'json', 'markets', 'get', '--id', KNOWN_PANDORA_MARKET_ID],
      },
      {
        id: 'trade.quote',
        title: 'Quote a buy on the known market',
        args: ['--output', 'json', 'quote', '--market-address', KNOWN_PANDORA_MARKET_ID, '--side', 'yes', '--amount-usdc', '25'],
      },
      ({ context: stepContext }) => ({
        id: 'trade.dry-run',
        title: 'Dry-run the buy without live signer material',
        args: [
          '--output',
          'json',
          'trade',
          '--market-address',
          KNOWN_PANDORA_MARKET_ID,
          '--side',
          'yes',
          '--amount-usdc',
          '25',
          '--dry-run',
          '--skip-dotenv',
          '--rpc-url',
          stepContext.liveRpcUrl,
        ],
      }),
    ]);

    const assessment = buildAssessmentResult({
      strengths: [
        {
          area: 'trading',
          title: 'Read-only discovery and dry-run trading work without live secrets',
          detail: 'Markets list/get, quote, and trade --dry-run all worked against a live market in an isolated environment.',
        },
        {
          area: 'workflow',
          title: 'The canonical read -> quote -> dry-run sequence is operational',
          detail: 'The dry-run returned a structured execution plan after the quote, which matches the documented safe trading loop.',
        },
      ],
      recommendations: [
        'Keep quote and trade --dry-run as the default research-trader path before any signer-backed execution.',
      ],
    });

    return createScenarioReport(
      {
        scenarioId: 'research-trader-dry-run',
        title: 'Research Trader Dry Run',
        userGoal: 'A research-oriented trader wants to discover a market, quote it, and dry-run a trade before connecting a signer.',
        userGoalStatus: 'achieved',
      },
      steps,
      assessment,
      options,
      context.tempRoot,
      {
        journeyResults: {
          marketRead: byBooleanStatus(steps, 'trade.get'),
          quote: byBooleanStatus(steps, 'trade.quote'),
          dryRun: byBooleanStatus(steps, 'trade.dry-run'),
        },
      },
    );
  });
}

async function runPortfolioEmptyWalletJourney(options = {}) {
  return withIsolatedCliScenario('pandora-user-journey-empty-wallet-', options, async (context) => {
    const { steps } = await runCliScenarioSteps(context, [
      {
        id: 'wallet.portfolio',
        title: 'Inspect an empty wallet portfolio',
        args: ['--output', 'json', 'portfolio', '--wallet', EMPTY_WALLET, '--chain-id', '1'],
      },
      {
        id: 'wallet.positions',
        title: 'List positions for the empty wallet',
        args: ['--output', 'json', 'positions', 'list', '--wallet', EMPTY_WALLET, '--chain-id', '1'],
      },
      ({ context: stepContext }) => ({
        id: 'wallet.claim.dry-run',
        title: 'Dry-run claim-all for the empty wallet',
        args: ['--output', 'json', 'claim', '--all', '--wallet', EMPTY_WALLET, '--dry-run', '--skip-dotenv', '--rpc-url', stepContext.liveRpcUrl],
      }),
    ]);

    const assessment = buildAssessmentResult({
      strengths: [
        {
          area: 'portfolio',
          title: 'Empty-wallet inspection is clean instead of error-prone',
          detail: 'Portfolio and positions list returned empty-state payloads, and claim --dry-run returned zero candidates instead of a hard failure.',
        },
      ],
      recommendations: [
        'Keep empty-wallet portfolio and claim-all dry-run flows as first-class onboarding checks for users who have connected a wallet but have no Pandora history yet.',
      ],
    });

    return createScenarioReport(
      {
        scenarioId: 'portfolio-empty-wallet',
        title: 'Portfolio Empty Wallet',
        userGoal: 'A new wallet owner wants to confirm that Pandora handles empty portfolio and claim surfaces cleanly.',
        userGoalStatus: 'achieved',
      },
      steps,
      assessment,
      options,
      context.tempRoot,
    );
  });
}

async function runWatchRiskObserverJourney(options = {}) {
  return withIsolatedCliScenario('pandora-user-journey-watch-risk-', options, async (context) => {
    const { steps } = await runCliScenarioSteps(context, [
      {
        id: 'watch.market',
        title: 'Watch a market once with a simple alert threshold',
        args: [
          '--output',
          'json',
          'watch',
          '--market-address',
          KNOWN_PANDORA_MARKET_ID,
          '--side',
          'yes',
          '--amount-usdc',
          '10',
          '--iterations',
          '1',
          '--interval-ms',
          '1000',
          '--alert-yes-above',
          '40',
        ],
      },
      {
        id: 'watch.risk.show',
        title: 'Inspect the local risk posture',
        args: ['--output', 'json', 'risk', 'show'],
      },
      {
        id: 'watch.risk.explain',
        title: 'Explain the panic-lock error code without triggering it',
        args: ['--output', 'json', 'explain', 'RISK_PANIC_ACTIVE'],
      },
    ]);

    const assessment = buildAssessmentResult({
      strengths: [
        {
          area: 'monitoring',
          title: 'Read-only monitoring works without a wallet or signer',
          detail: 'watch, risk show, and explain all returned structured monitoring outputs in a clean environment.',
        },
        {
          area: 'recovery',
          title: 'Risk explain gives a concrete canonical next command',
          detail: 'The panic-lock explanation resolved straight to pandora risk show instead of leaving the user to interpret an opaque error code.',
        },
      ],
      recommendations: [
        'Keep watch and risk explain visible in onboarding for users who want monitoring first and trading later.',
      ],
    });

    return createScenarioReport(
      {
        scenarioId: 'watch-risk-observer',
        title: 'Watch And Risk Observer',
        userGoal: 'An observer wants alerts and risk posture visibility without placing any trades.',
        userGoalStatus: 'achieved',
      },
      steps,
      assessment,
      options,
      context.tempRoot,
    );
  });
}

async function runSportsNoProviderJourney(options = {}) {
  return withIsolatedCliScenario('pandora-user-journey-sports-no-provider-', options, async (context) => {
    const { steps } = await runCliScenarioSteps(context, [
      {
        id: 'sports.books',
        title: 'Check sports provider health with no sportsbook credentials configured',
        args: ['--output', 'json', 'sports', 'books', 'list'],
      },
      {
        id: 'sports.schedule',
        title: 'Try schedule lookup with no sportsbook providers configured',
        args: ['--output', 'json', 'sports', 'schedule', '--limit', '3'],
        expectFailure: true,
      },
      {
        id: 'sports.events',
        title: 'Try sports events list with no sportsbook providers configured',
        args: ['--output', 'json', 'sports', 'events', 'list', '--limit', '3'],
        expectFailure: true,
      },
      {
        id: 'sports.scores',
        title: 'Try sports scores with no sportsbook providers configured',
        args: ['--output', 'json', 'sports', 'scores', '--limit', '3'],
        expectFailure: true,
      },
    ]);

    const assessment = buildAssessmentResult({
      frictionPoints: [
        {
          severity: 'high',
          stepId: 'sports.schedule',
          area: 'sports',
          title: 'Sports discovery is blocked entirely without provider setup',
          detail: 'Books health reports the missing provider state cleanly, but schedule, events list, and scores all hard-fail as soon as the user tries to continue.',
          recommendation: 'Keep sports books list as the first explicit preflight and add a direct remediation hint from the failing sports commands back to provider setup docs.',
        },
      ],
      strengths: [
        {
          area: 'sports',
          title: 'Sports books health makes missing provider config explicit',
          detail: 'sports books list returned a structured not-configured state instead of timing out or emitting partial junk data.',
        },
        {
          area: 'sports',
          title: 'Failing sports discovery commands now point back to the provider preflight path',
          detail: 'schedule, events list, and scores now return machine-readable remediation that sends the user back to sports books list plus the required sportsbook env keys.',
        },
      ],
      recommendations: [
        'Route all sports onboarding through sports books list first when sportsbook provider credentials are missing.',
      ],
      classification: {
        kind: 'external-prerequisite',
        guidanceQuality: 'clear',
        externallyBlocked: true,
        note: 'The remaining blocker is missing sportsbook provider configuration, and the remediation path is already explicit.',
      },
    });

    return createScenarioReport(
      {
        scenarioId: 'sports-no-provider',
        title: 'Sports Without Provider Config',
        userGoal: 'A sports operator wants schedule and score discovery before configuring sportsbook providers.',
        userGoalStatus: 'blocked-on-provider-configuration',
      },
      steps,
      assessment,
      options,
      context.tempRoot,
    );
  });
}

async function runOperationsEmptyLedgerJourney(options = {}) {
  return withIsolatedCliScenario('pandora-user-journey-operations-empty-', options, async (context) => {
    const { steps } = await runCliScenarioSteps(context, [
      {
        id: 'ops.list',
        title: 'Inspect the empty operations ledger',
        args: ['--output', 'json', 'operations', 'list'],
      },
      {
        id: 'ops.get.missing',
        title: 'Read one missing operation id',
        args: ['--output', 'json', 'operations', 'get', '--id', 'missing'],
        expectFailure: true,
      },
      {
        id: 'ops.receipt.missing',
        title: 'Read one missing operation receipt',
        args: ['--output', 'json', 'operations', 'receipt', '--id', 'missing'],
        expectFailure: true,
      },
      {
        id: 'ops.verify.missing',
        title: 'Verify one missing operation receipt',
        args: ['--output', 'json', 'operations', 'verify-receipt', '--id', 'missing'],
        expectFailure: true,
      },
    ]);

    const assessment = buildAssessmentResult({
      strengths: [
        {
          area: 'operations',
          title: 'Empty ledgers and missing operation ids are handled deterministically',
          detail: 'operations list returned zero items cleanly, and the missing get/receipt/verify paths all produced stable machine-readable blockers.',
        },
      ],
      recommendations: [
        'Keep operations list/get/receipt/verify-receipt as the first audit path after live work, and preserve the current deterministic missing-id behavior.',
      ],
    });

    return createScenarioReport(
      {
        scenarioId: 'operations-empty-ledger',
        title: 'Operations Empty Ledger',
        userGoal: 'An auditor wants to confirm that the operations and receipt surfaces behave predictably before any live actions exist.',
        userGoalStatus: 'achieved',
      },
      steps,
      assessment,
      options,
      context.tempRoot,
    );
  });
}

async function runAmmMirrorZeroPrereqsJourney(options = {}) {
  return withIsolatedCliScenario('pandora-user-journey-amm-mirror-zero-', options, async (context) => {
    const { steps } = await runCliScenarioSteps(context, [
      {
        id: 'zero.profile.deploy',
        title: 'Discover the deployer profile for AMM market creation',
        args: ['--output', 'json', 'profile', 'recommend', '--command', 'markets.create.run', '--mode', 'execute', '--chain-id', '1', '--category', 'Crypto', '--policy-id', 'execute-with-validation'],
      },
      {
        id: 'zero.profile.mirror',
        title: 'Discover the operator profile for live mirror automation',
        args: ['--output', 'json', 'profile', 'recommend', '--command', 'mirror.go', '--mode', 'execute', '--chain-id', '1', '--category', 'Sports', '--policy-id', 'execute-with-validation'],
      },
      {
        id: 'zero.amm.plan',
        title: 'Plan an AMM market with no signer configured',
        args: [
          '--output',
          'json',
          'markets',
          'create',
          'plan',
          '--market-type',
          'amm',
          '--question',
          AMM_MARKET.question,
          '--rules',
          AMM_MARKET.rules,
          '--sources',
          ...AMM_MARKET.sources,
          '--target-timestamp',
          AMM_MARKET.targetTimestamp,
          '--liquidity-usdc',
          String(AMM_MARKET.liquidityUsdc),
          '--skip-dotenv',
        ],
      },
      {
        id: 'zero.amm.validate',
        title: 'Validate the planned AMM payload',
        args: [
          '--output',
          'json',
          'agent',
          'market',
          'validate',
          '--question',
          AMM_MARKET.question,
          '--rules',
          AMM_MARKET.rules,
          '--sources',
          ...AMM_MARKET.sources,
          '--target-timestamp',
          AMM_MARKET.targetTimestamp,
        ],
      },
      {
        id: 'zero.mirror.browse',
        title: 'Browse live Polymarket mirror candidates with no wallet or API keys',
        args: ['--output', 'json', 'mirror', 'browse', '--limit', '1'],
      },
      {
        id: 'zero.mirror.go.missing-sources',
        title: 'Try mirror go paper mode without explicit resolution sources',
        args: ['--output', 'json', 'mirror', 'go', '--polymarket-slug', KNOWN_POLYMARKET_SLUG, '--liquidity-usdc', '10', '--category', 'Sports', '--paper'],
        expectFailure: true,
      },
      {
        id: 'zero.mirror.go.paper',
        title: 'Run mirror go in paper mode with explicit independent sources',
        args: [
          '--output',
          'json',
          'mirror',
          'go',
          '--polymarket-slug',
          KNOWN_POLYMARKET_SLUG,
          '--liquidity-usdc',
          '10',
          '--category',
          'Sports',
          '--paper',
          '--sources',
          ...MIRROR_RESOLUTION_SOURCES,
        ],
      },
    ]);

    const deployProfileStep = stepById(steps, 'zero.profile.deploy');
    const mirrorProfileStep = stepById(steps, 'zero.profile.mirror');
    const paperStep = stepById(steps, 'zero.mirror.go.paper');
    const deployMirrorPersonaExplained =
      Boolean(
        deployProfileStep
        && deployProfileStep.payloadSummary
        && deployProfileStep.payloadSummary.recommendedProfileId === 'market_deployer_a'
        && deployProfileStep.payloadSummary.companionProfileId === 'prod_trader_a'
        && mirrorProfileStep
        && mirrorProfileStep.payloadSummary
        && mirrorProfileStep.payloadSummary.recommendedProfileId === 'prod_trader_a'
        && mirrorProfileStep.payloadSummary.companionProfileId === 'market_deployer_a',
      );
    const sourcesRequirementSurfacedEarly =
      Boolean(
        mirrorProfileStep
        && mirrorProfileStep.payloadSummary
        && mirrorProfileStep.payloadSummary.mentionsIndependentSourcesRequirement,
      );
    const missingSourcesStep = stepById(steps, 'zero.mirror.go.missing-sources');
    const missingSourcesMessage = String(missingSourcesStep && missingSourcesStep.errorMessage || '');
    const assessment = buildAssessmentResult({
      frictionPoints: [
        ...(!sourcesRequirementSurfacedEarly
          ? [{
              severity: 'high',
              stepId: 'zero.mirror.go.missing-sources',
              area: 'mirror',
              title: 'Mirror go still stops cold until the user supplies independent resolution sources',
              detail: 'A fresh user can discover and plan the mirror market, but mirror go refuses to proceed even in paper mode unless two explicit public resolution URLs are supplied.',
              recommendation: 'Expose the explicit source requirement earlier in mirror onboarding and prefill candidate source slots when possible.',
            }]
          : []),
        ...(!deployMirrorPersonaExplained
          ? [{
              severity: 'medium',
              stepId: 'zero.profile.mirror',
              area: 'profiles',
              title: 'AMM deploy and mirror automation use different recommended mutable profiles',
              detail: 'Market deployment routes to market_deployer_a, while mirror automation routes to prod_trader_a, so a fresh user has to understand two mutable profile stories.',
              recommendation: 'Document that deployment and mirror automation are separate mutable personas, or ship a clearer composite operator path.',
            }]
          : []),
        ...(paperStep
          && paperStep.payloadSummary
          && String(paperStep.payloadSummary.firstDeployDiagnostic || '').includes('signer funding blockers')
          ? [
              {
                severity: 'medium',
                stepId: paperStep.id,
                area: 'mirror',
                title: 'Paper mirror go already surfaces signer funding blockers',
                detail: 'The paper-mode one-shot returns useful deploy/sync payloads, but it also mentions signer funding blockers before the user has even crossed into live mode.',
                recommendation: 'Keep the readiness diagnostics, but distinguish paper-mode readiness from live signer funding requirements more clearly.',
              },
            ]
          : []),
      ],
      strengths: [
        {
          area: 'deployment',
          title: 'Fresh users can plan and validate the AMM leg without a signer',
          detail: 'markets.create.plan and agent.market.validate both worked with no wallet or secret material present.',
        },
        ...(deployMirrorPersonaExplained
          ? [{
              area: 'profiles',
              title: 'Profile recommendations now explain the split deploy and mirror operator personas up front',
              detail: 'The CLI surfaces market_deployer_a for Pandora deployment and prod_trader_a for live mirror automation before the user reaches any failing mirror command.',
            }]
          : []),
        ...(sourcesRequirementSurfacedEarly
          ? [{
              area: 'mirror',
              title: 'Mirror onboarding surfaces the independent source requirement before mirror go fails',
              detail: `The mirror profile recommendation already tells the user that fresh-market mirror go needs two independent public --sources${missingSourcesMessage ? ', and the failing command now repeats that requirement clearly.' : '.'}`,
            }]
          : []),
        {
          area: 'mirror',
          title: 'Paper mirror go works from a public Polymarket slug once the user supplies real resolution sources',
          detail: 'mirror go in paper mode returned the full plan and deploy payload without requiring Polymarket API keys or an already-funded live signer.',
        },
      ],
      recommendations: [
        ...(deployMirrorPersonaExplained
          ? []
          : ['Lead this onboarding path with separate profile recommendations for the Pandora deploy leg and the mirror automation leg.']),
        ...(sourcesRequirementSurfacedEarly
          ? []
          : ['Make the explicit resolution-source requirement impossible to miss before a fresh user reaches mirror go.']),
      ],
    });

    return createScenarioReport(
      {
        scenarioId: 'amm-mirror-zero-prereqs',
        title: 'AMM Deployer With No Wallet Or API Keys',
        userGoal: 'A brand-new user has no wallet, no Polymarket API keys, and no Odds API keys, but wants to deploy an AMM market and hedge it with a Polymarket daemon.',
        userGoalStatus:
          deployMirrorPersonaExplained && sourcesRequirementSurfacedEarly
            ? 'guided-cleanly-to-paper-mirror-and-deploy-preflight'
            : 'guided-to-paper-mirror-and-deploy-preflight',
      },
      steps,
      assessment,
      options,
      context.tempRoot,
    );
  });
}

async function runMirrorSyncPaperExistingMarketJourney(options = {}) {
  return withIsolatedCliScenario('pandora-user-journey-mirror-sync-paper-', options, async (context) => {
    const steps = [];
    const once = await runCliJsonStep({
      id: 'sync.paper.once',
      title: 'Run one paper-mode sync iteration against an existing Pandora market',
      command: 'pandora',
      surface: 'cli',
      cwd: context.workdir,
      env: context.baseEnv,
      unsetEnvKeys: context.strictUnsetEnvKeys,
      args: ['--output', 'json', 'mirror', 'sync', 'once', '--paper', '--market-address', KNOWN_PANDORA_MARKET_ID, '--polymarket-slug', KNOWN_POLYMARKET_SLUG],
    });
    steps.push(once.step);

    const strategyHash = once.payload && once.payload.data && once.payload.data.strategyHash
      ? once.payload.data.strategyHash
      : 'missing';
    const status = await runCliJsonStep({
      id: 'sync.paper.status',
      title: 'Inspect paper sync runtime status by strategy hash',
      command: 'pandora',
      surface: 'cli',
      cwd: context.workdir,
      env: context.baseEnv,
      unsetEnvKeys: context.strictUnsetEnvKeys,
      args: ['--output', 'json', 'mirror', 'sync', 'status', '--strategy-hash', strategyHash],
    });
    steps.push(status.step);

    const onceStep = stepById(steps, 'sync.paper.once');
    const hasInventoryRuntimeWarning =
      Boolean(
        onceStep
        && onceStep.payloadSummary
        && String(onceStep.payloadSummary.firstDiagnosticMessage || '').includes('privateKeyToAccount is not a function'),
      );
    const assessment = buildAssessmentResult({
      frictionPoints: [
        ...(hasInventoryRuntimeWarning
          ? [
              {
                severity: 'high',
                stepId: onceStep.id,
                area: 'mirror-sync',
                title: 'Paper sync emits a concrete runtime warning from inventory offset handling',
                detail: 'The paper sync path completed, but it emitted a warning with the message `privateKeyToAccount is not a function`, which indicates a real runtime bug in the inventory-offset path.',
                recommendation: 'Fix the inventory-address derivation path before trusting paper sync diagnostics as a clean onboarding experience.',
              },
            ]
          : []),
      ],
      strengths: [
        {
          area: 'mirror-sync',
          title: 'Paper sync can run one bounded iteration without live hedge credentials',
          detail: 'mirror sync once in paper mode returned snapshots, gate checks, state file paths, and a strategy hash in a clean isolated environment.',
        },
        {
          area: 'runtime',
          title: 'Strategy-hash status inspection works after the bounded paper run',
          detail: 'mirror sync status resolved the same strategy hash and returned idle/not-started runtime state rather than losing the local state file.',
        },
      ],
      recommendations: [
        ...(hasInventoryRuntimeWarning
          ? ['Treat the current privateKeyToAccount warning as a real bug and not just an onboarding rough edge.']
          : []),
      ],
    });

    return createScenarioReport(
      {
        scenarioId: 'mirror-sync-paper-existing-market',
        title: 'Mirror Sync Paper Against Existing Market',
        userGoal: 'An operator wants to paper-sync an existing Pandora market to a Polymarket source before enabling any live hedge automation.',
        userGoalStatus: hasInventoryRuntimeWarning ? 'achieved-with-runtime-warning' : 'achieved-cleanly-in-paper-mode',
      },
      steps,
      assessment,
      options,
      context.tempRoot,
    );
  });
}

async function runUserJourneys(options = {}) {
  const scenarioIds = parseScenarioList(options.scenario);
  const reports = {};

  for (const scenarioId of scenarioIds) {
    if (scenarioId === 'deployer') {
      reports[scenarioId] = await runDeployerJourney(options);
      continue;
    }
    if (scenarioId === 'mcp-parimutuel') {
      reports[scenarioId] = await runMcpParimutuelJourney(options);
      continue;
    }
    if (scenarioId === 'amm-mirror-zero-prereqs') {
      reports[scenarioId] = await runAmmMirrorZeroPrereqsJourney(options);
      continue;
    }
    if (scenarioId === 'bootstrap-readonly-discovery') {
      reports[scenarioId] = await runBootstrapReadonlyDiscoveryJourney(options);
      continue;
    }
    if (scenarioId === 'policy-profile-audit') {
      reports[scenarioId] = await runPolicyProfileAuditJourney(options);
      continue;
    }
    if (scenarioId === 'hype-no-ai-keys') {
      reports[scenarioId] = await runHypeNoAiKeysJourney(options);
      continue;
    }
    if (scenarioId === 'research-trader-dry-run') {
      reports[scenarioId] = await runResearchTraderDryRunJourney(options);
      continue;
    }
    if (scenarioId === 'portfolio-empty-wallet') {
      reports[scenarioId] = await runPortfolioEmptyWalletJourney(options);
      continue;
    }
    if (scenarioId === 'watch-risk-observer') {
      reports[scenarioId] = await runWatchRiskObserverJourney(options);
      continue;
    }
    if (scenarioId === 'sports-no-provider') {
      reports[scenarioId] = await runSportsNoProviderJourney(options);
      continue;
    }
    if (scenarioId === 'mirror-sync-paper-existing-market') {
      reports[scenarioId] = await runMirrorSyncPaperExistingMarketJourney(options);
      continue;
    }
    if (scenarioId === 'operations-empty-ledger') {
      reports[scenarioId] = await runOperationsEmptyLedgerJourney(options);
      continue;
    }
  }

  const scenarioReports = Object.values(reports);
  const ok = scenarioReports.every((report) => report && report.ok === true);
  const failureSummary = scenarioReports
    .filter((report) => report && report.ok !== true)
    .map((report) => ({
      scenarioId: report.scenarioId,
      userGoalStatus: report.userGoalStatus,
      journeyClassification: report.summary && report.summary.journeyClassification,
      unexpectedFailureCount: report.summary && report.summary.unexpectedFailureCount,
      frictionCount: report.summary && report.summary.frictionCount,
    }));

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    kind: REPORT_KIND,
    generatedAt: new Date().toISOString(),
    packageVersion: pkg.version,
    scenariosRequested: scenarioIds,
    ok,
    summary: {
      scenarioCount: scenarioReports.length,
      okCount: scenarioReports.filter((report) => report.ok === true).length,
      blockedUserGoalCount: scenarioReports.filter((report) => report.userGoalStatus !== 'achieved').length,
      externalPrerequisiteCount: scenarioReports.filter(
        (report) => report.summary && report.summary.journeyClassification && report.summary.journeyClassification.kind === 'external-prerequisite',
      ).length,
      clearExternalPrerequisiteCount: scenarioReports.filter(
        (report) =>
          report.summary
          && report.summary.journeyClassification
          && report.summary.journeyClassification.kind === 'external-prerequisite'
          && report.summary.journeyClassification.guidanceQuality === 'clear',
      ).length,
    },
    reports,
    failureSummary,
  };
}

module.exports = {
  ADDITIONAL_SCENARIOS,
  DEFAULT_SCENARIOS,
  REPORT_KIND,
  REPORT_SCHEMA_VERSION,
  SCENARIO_SET,
  SUPPORTED_SCENARIOS,
  deriveDeployerAssessment,
  deriveJourneyClassification,
  deriveMcpParimutuelAssessment,
  parseScenarioList,
  summarizePayload,
  runAmmMirrorZeroPrereqsJourney,
  runBootstrapReadonlyDiscoveryJourney,
  runDeployerJourney,
  runHypeNoAiKeysJourney,
  runMcpParimutuelJourney,
  runMirrorSyncPaperExistingMarketJourney,
  runOperationsEmptyLedgerJourney,
  runPolicyProfileAuditJourney,
  runPortfolioEmptyWalletJourney,
  runResearchTraderDryRunJourney,
  runSportsNoProviderJourney,
  runUserJourneys,
  runWatchRiskObserverJourney,
};
