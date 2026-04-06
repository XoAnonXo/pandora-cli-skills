const fs = require('fs');

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createDoctorService requires deps.${name}()`);
  }
  return deps[name];
}

const DEFAULT_REQUIRED_ENV_KEYS = ['CHAIN_ID', 'RPC_URL', 'PRIVATE_KEY', 'ORACLE', 'FACTORY', 'USDC'];

const GOAL_DESCRIPTIONS = Object.freeze({
  explore: 'Read-only exploration of chain and market data',
  deploy: 'Deploy contracts with a signing wallet',
  'paper-mirror': 'Follow Polymarket odds without live credentials',
  'live-mirror': 'Follow Polymarket odds with live market making',
  'hosted-gateway': 'Connect to a hosted remote gateway',
  'paper-hedge-daemon': 'Delta-neutral Polymarket hedging (paper mode)',
  'live-hedge-daemon': 'Delta-neutral Polymarket hedging (live mode)',
});
const DEFAULT_SUPPORTED_CHAIN_IDS = new Set([1]);
const DEFAULT_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DEFAULT_POLYMARKET_HOST = 'https://clob.polymarket.com';
const DEFAULT_POLYMARKET_RPC_URL = 'https://polygon-bor-rpc.publicnode.com';
const DEFAULT_POLYMARKET_DOCTOR_KEYS = [
  'POLYMARKET_HOST',
  'POLYMARKET_RPC_URL',
  'POLYMARKET_FUNDER',
  'POLYMARKET_PRIVATE_KEY',
  'POLYMARKET_API_KEY',
  'POLYMARKET_API_SECRET',
  'POLYMARKET_API_PASSPHRASE',
];
const { normalizeResolutionSources } = require('./shared/resolution_sources.cjs');

const DEFAULT_HELP_NOTES = Object.freeze([
  'Goal options:',
  '  explore           Read-only exploration of chain and market data',
  '  deploy            Deploy contracts with a signing wallet',
  '  paper-mirror      Follow Polymarket odds without live credentials',
  '  live-mirror       Follow Polymarket odds with live market making',
  '  hosted-gateway    Connect to a hosted remote gateway',
  '  paper-hedge-daemon  Delta-neutral Polymarket hedging (paper mode)',
  '  live-hedge-daemon   Delta-neutral Polymarket hedging (live mode)',
]);

function getGoalDescription(goal) {
  return GOAL_DESCRIPTIONS[normalizeGoal(goal)] || null;
}

function normalizeGoal(goal) {
  const normalized = String(goal || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'paper') return 'paper-mirror';
  if (normalized === 'live') return 'live-mirror';
  if (normalized === 'gateway') return 'hosted-gateway';
  if (normalized === 'hedge') return 'paper-hedge-daemon';
  if (normalized === 'paper-hedge') return 'paper-hedge-daemon';
  if (normalized === 'live-hedge') return 'live-hedge-daemon';
  if (normalized === 'paper-daemon') return 'paper-hedge-daemon';
  if (normalized === 'live-daemon') return 'live-hedge-daemon';
  if ([
    'explore',
    'deploy',
    'paper-mirror',
    'live-mirror',
    'paper-hedge-daemon',
    'live-hedge-daemon',
    'hosted-gateway',
  ].includes(normalized)) {
    return normalized;
  }
  return null;
}

function buildGoalRequirements(goal) {
  if (!goal) {
    return {
      goal: null,
      requiredEnv: DEFAULT_REQUIRED_ENV_KEYS,
      needPolymarketCheck: false,
      needResolutionSources: false,
      note: null,
      recommendations: [],
    };
  }

  if (normalized === 'explore') {
    return {
      goal: normalized,
      requiredEnv: ['CHAIN_ID', 'RPC_URL'],
      needPolymarketCheck: false,
      needResolutionSources: false,
      note: 'Read-only exploration only needs chain and RPC connectivity.',
      recommendations: ['Continue with `pandora bootstrap` and `pandora --output json schema`.'],
    };
  }

  if (normalized === 'deploy') {
    return {
      goal: normalized,
      requiredEnv: ['CHAIN_ID', 'RPC_URL', 'PRIVATE_KEY', 'ORACLE', 'FACTORY', 'USDC'],
      needPolymarketCheck: false,
      needResolutionSources: false,
      note: 'Deployment readiness requires a deploy signer and core market addresses.',
      recommendations: ['Run `pandora --output json profile explain` for the deploy signer before execution.'],
    };
  }

  if (normalized === 'paper-mirror') {
    return {
      goal: normalized,
      requiredEnv: ['CHAIN_ID', 'RPC_URL', 'ORACLE', 'FACTORY', 'USDC'],
      needPolymarketCheck: false,
      needResolutionSources: true,
      note: 'Paper Pandora Mirroring Mode can proceed without live Polymarket credentials.',
      recommendations: [
        'Choose this path when you want Pandora to follow Polymarket odds. Add `--no-hedge` on mirror sync when you want Pandora-only mirroring.',
        'Provide two independent public `--sources` when you move from planning to deploy.',
        'Set `PANDORA_RESOLUTION_SOURCES` if you want env-driven mirror defaults.',
      ],
    };
  }

  if (normalized === 'live-mirror') {
    return {
      goal: normalized,
      requiredEnv: ['CHAIN_ID', 'RPC_URL', 'PRIVATE_KEY', 'ORACLE', 'FACTORY', 'USDC'],
      needPolymarketCheck: true,
      needResolutionSources: true,
      note: 'Live Pandora Mirroring Mode is for market making on Pandora. Use it when you want Pandora to follow Polymarket odds.',
      recommendations: [
        'If you want Pandora-only mirroring, use `mirror sync --no-hedge`. Plain `mirror sync` without that flag is the hybrid path.',
        'Validate credentials and then run live mirror commands only after the dry-run passes.',
        'Set `PANDORA_RESOLUTION_SOURCES` if you want env-driven mirror defaults.',
      ],
    };
  }

  if (normalized === 'paper-hedge-daemon') {
    return {
      goal: normalized,
      requiredEnv: ['CHAIN_ID', 'RPC_URL', 'ORACLE', 'FACTORY', 'USDC', 'PANDORA_INTERNAL_WALLETS_FILE'],
      needPolymarketCheck: false,
      needResolutionSources: false,
      note: 'Paper Polymarket Hedge Mode targets the hedge-only daemon path for an existing mirror pair, not Pandora Mirroring Mode.',
      recommendations: [
        'Use `mirror hedge` when you want delta-neutral Polymarket hedging and fee capture from Pandora flow.',
        'Use `mirror sync --no-hedge` only when you want Pandora Mirroring Mode instead of hedge-only operation.',
        'Bundle artifacts support DigitalOcean droplets and generic VPS targets today; Cloudflare Workers are not supported in v1.',
      ],
    };
  }

  if (normalized === 'live-hedge-daemon') {
    return {
      goal: normalized,
      requiredEnv: ['CHAIN_ID', 'RPC_URL', 'PRIVATE_KEY', 'ORACLE', 'FACTORY', 'USDC', 'PANDORA_INTERNAL_WALLETS_FILE'],
      needPolymarketCheck: true,
      needResolutionSources: false,
      note: 'Live Polymarket Hedge Mode targets the hedge-only daemon path for an existing mirror pair and live Polymarket execution, not Pandora Mirroring Mode.',
      recommendations: [
        'Use `mirror hedge` when you want delta-neutral Polymarket hedging and fee capture from Pandora flow.',
        'Use `mirror sync --no-hedge` only when you want Pandora Mirroring Mode instead of hedge-only operation.',
        'Bundle artifacts support DigitalOcean droplets and generic VPS targets today; Cloudflare Workers are not supported in v1.',
      ],
    };
  }

  return {
    goal: normalized,
    requiredEnv: ['CHAIN_ID', 'RPC_URL'],
    needPolymarketCheck: false,
    needResolutionSources: false,
    note: 'Hosted gateway setup is mostly read-only and can remain signer-light.',
    recommendations: ['Keep the gateway read-only until you intentionally provision signer material.'],
  };
}

/**
 * Creates doctor-report helpers for env/rpc/code health checks.
 * @param {object} deps
 * @returns {{ buildDoctorReport: (options: object) => Promise<object> }}
 */
function createDoctorService(deps = {}) {
  const CliError = requireDep(deps, 'CliError');
  const loadEnvFile = requireDep(deps, 'loadEnvFile');
  const runPolymarketCheck = requireDep(deps, 'runPolymarketCheck');
  const isValidPrivateKey = requireDep(deps, 'isValidPrivateKey');
  const isValidAddress = requireDep(deps, 'isValidAddress');
  const isSecureHttpUrlOrLocal = requireDep(deps, 'isSecureHttpUrlOrLocal');

  const requiredEnvKeys = Array.isArray(deps.requiredEnvKeys) && deps.requiredEnvKeys.length
    ? deps.requiredEnvKeys
    : DEFAULT_REQUIRED_ENV_KEYS;
  const supportedChainIds = deps.supportedChainIds instanceof Set
    ? deps.supportedChainIds
    : DEFAULT_SUPPORTED_CHAIN_IDS;
  const zeroAddress = typeof deps.zeroAddress === 'string' && deps.zeroAddress.trim()
    ? deps.zeroAddress.trim().toLowerCase()
    : DEFAULT_ZERO_ADDRESS;
  const defaultPolymarketHost = typeof deps.defaultPolymarketHost === 'string' && deps.defaultPolymarketHost.trim()
    ? deps.defaultPolymarketHost.trim()
    : DEFAULT_POLYMARKET_HOST;
  const defaultPolymarketRpcUrl = typeof deps.defaultPolymarketRpcUrl === 'string' && deps.defaultPolymarketRpcUrl.trim()
    ? deps.defaultPolymarketRpcUrl.trim()
    : DEFAULT_POLYMARKET_RPC_URL;
  const polymarketDoctorKeys = Array.isArray(deps.polymarketDoctorKeys) && deps.polymarketDoctorKeys.length
    ? deps.polymarketDoctorKeys
    : DEFAULT_POLYMARKET_DOCTOR_KEYS;

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

  async function probeHttpEndpoint(url, timeoutMs, method = 'HEAD', options = {}) {
    const acceptAnyHttpStatus = Boolean(options.acceptAnyHttpStatus);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
      });
      const reachable = acceptAnyHttpStatus
        ? response.status >= 100 && response.status < 500
        : response.ok;
      return {
        ok: reachable,
        status: response.status,
        error: reachable ? null : `HTTP ${response.status}`,
      };
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return { ok: false, status: null, error: `Request timed out after ${timeoutMs}ms.` };
      }
      return { ok: false, status: null, error: err && err.message ? err.message : String(err) };
    } finally {
      clearTimeout(timeout);
    }
  }

  function getEnvValue(env, key) {
    if (env && Object.prototype.hasOwnProperty.call(env, key)) {
      return env[key];
    }
    return process.env[key];
  }

  function hasPolymarketDoctorInputs(env) {
    return polymarketDoctorKeys.some((key) => String(getEnvValue(env, key) || '').trim().length > 0);
  }

  function validateEnvValues(goal, env) {
    const goalRequirements = buildGoalRequirements(goal);
    const requiredKeys = goalRequirements.goal ? goalRequirements.requiredEnv : requiredEnvKeys;
    const missing = requiredKeys.filter((key) => {
      if (key === 'PRIVATE_KEY') {
        const primary = String(getEnvValue(env, 'PANDORA_PRIVATE_KEY') || '').trim();
        const legacy = String(getEnvValue(env, 'PRIVATE_KEY') || '').trim();
        return !primary && !legacy;
      }
      const value = getEnvValue(env, key);
      return !value || !String(value).trim();
    });
    const missingSet = new Set(missing);
    const errors = [];

    const chainIdRaw = String(getEnvValue(env, 'CHAIN_ID') || '').trim();
    let chainId = null;
    if (!missingSet.has('CHAIN_ID')) {
      chainId = Number(chainIdRaw);
      if (!Number.isInteger(chainId)) {
        errors.push(`CHAIN_ID must be an integer. Received: "${chainIdRaw}"`);
      } else if (!supportedChainIds.has(chainId)) {
        errors.push(`Unsupported CHAIN_ID=${chainId}. Supported values: ${Array.from(supportedChainIds).join(', ')}`);
      }
    }

    const rpcUrl = String(getEnvValue(env, 'RPC_URL') || '').trim();
    if (!missingSet.has('RPC_URL') && !isSecureHttpUrlOrLocal(rpcUrl)) {
      errors.push(`RPC_URL must use https:// (or http://localhost/127.0.0.1 for local testing). Received: "${rpcUrl}"`);
    }

    const privateKey = String(getEnvValue(env, 'PANDORA_PRIVATE_KEY') || getEnvValue(env, 'PRIVATE_KEY') || '').trim();
    if (requiredKeys.includes('PRIVATE_KEY') && !missingSet.has('PRIVATE_KEY') && !isValidPrivateKey(privateKey)) {
      errors.push(
        'PANDORA_PRIVATE_KEY (preferred) or PRIVATE_KEY must be a full 32-byte hex key (0x + 64 hex chars), not a placeholder.',
      );
    }

    for (const key of ['ORACLE', 'FACTORY', 'USDC']) {
      if (!requiredKeys.includes(key)) {
        continue;
      }
      const value = String(getEnvValue(env, key) || '').trim();
      if (missingSet.has(key)) {
        continue;
      }
      if (!isValidAddress(value)) {
        errors.push(`${key} must be a valid 20-byte hex address (0x + 40 hex chars). Received: "${value}"`);
        continue;
      }
      if (value.toLowerCase() === zeroAddress) {
        errors.push(`${key} cannot be the zero address.`);
      }
    }

    if (requiredKeys.includes('PANDORA_INTERNAL_WALLETS_FILE') && !missingSet.has('PANDORA_INTERNAL_WALLETS_FILE')) {
      const walletFile = String(getEnvValue(env, 'PANDORA_INTERNAL_WALLETS_FILE') || '').trim();
      if (!walletFile) {
        errors.push('PANDORA_INTERNAL_WALLETS_FILE must point to a newline-delimited wallet whitelist file.');
      } else if (!fs.existsSync(walletFile)) {
        errors.push(`PANDORA_INTERNAL_WALLETS_FILE does not exist: "${walletFile}"`);
      }
    }

    const partialPolicy = String(getEnvValue(env, 'PANDORA_HEDGE_PARTIAL_POLICY') || '').trim().toLowerCase();
    if (partialPolicy && partialPolicy !== 'partial' && partialPolicy !== 'skip') {
      errors.push('PANDORA_HEDGE_PARTIAL_POLICY must be partial|skip when set.');
    }

    const sellPolicy = String(getEnvValue(env, 'PANDORA_HEDGE_SELL_POLICY') || '').trim().toLowerCase();
    if (sellPolicy && sellPolicy !== 'depth-checked' && sellPolicy !== 'manual-only') {
      errors.push('PANDORA_HEDGE_SELL_POLICY must be depth-checked|manual-only when set.');
    }

    return {
      missing,
      errors,
      chainId,
      rpcUrl,
      addresses: {
        ORACLE: String(getEnvValue(env, 'ORACLE') || '').trim(),
        FACTORY: String(getEnvValue(env, 'FACTORY') || '').trim(),
        USDC: String(getEnvValue(env, 'USDC') || '').trim(),
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

    const runtimeEnv = {
      ...process.env,
      ...(options.env && typeof options.env === 'object' ? options.env : {}),
    };
    const goalRequirements = buildGoalRequirements(options.goal);
    const envState = validateEnvValues(goalRequirements.goal, runtimeEnv);
    const shouldCheckPolymarket = options.checkPolymarket || goalRequirements.needPolymarketCheck || (!goalRequirements.goal && hasPolymarketDoctorInputs(runtimeEnv));
    const report = {
      goal: goalRequirements.goal,
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
      journeyReadiness: {
        goal: goalRequirements.goal,
        note: goalRequirements.note,
        status: 'ready',
        missing: [],
        warnings: [],
        recommendations: goalRequirements.recommendations.slice(),
      },
      rpc: {
        ok: false,
        url: String(getEnvValue(runtimeEnv, 'RPC_URL') || '').trim(),
        chainIdHex: null,
        chainId: null,
        expectedChainId: Number.isInteger(envState.chainId) ? envState.chainId : null,
        matchesExpectedChainId: null,
        error: null,
      },
      codeChecks: [],
      polymarket: {
        checked: shouldCheckPolymarket,
        host: String(getEnvValue(runtimeEnv, 'POLYMARKET_HOST') || defaultPolymarketHost).trim() || defaultPolymarketHost,
        rpcUrl: String(getEnvValue(runtimeEnv, 'POLYMARKET_RPC_URL') || defaultPolymarketRpcUrl).trim() || defaultPolymarketRpcUrl,
        hostReachability: {
          ok: null,
          status: null,
          error: null,
        },
        check: null,
        failures: [],
        warnings: [],
      },
      summary: {
        ok: false,
        errorCount: 0,
        warningCount: 0,
      },
    };

    if (!report.env.required.ok || !report.env.validation.ok) {
      const envErrorCount = report.env.required.missing.length + report.env.validation.errors.length;
      const failures = [];
      failures.push(...report.env.required.missing.map((name) => `Missing required env var: ${name}`));
      failures.push(...report.env.validation.errors);
      report.journeyReadiness.missing.push(...report.env.required.missing);
      report.journeyReadiness.warnings.push(...report.env.validation.errors);
      report.journeyReadiness.status = report.journeyReadiness.missing.length ? 'blocked' : 'ready-with-notes';
      report.summary.ok = false;
      report.summary.errorCount = envErrorCount;
      report.summary.failures = failures;
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

    const codeTargets = [];
    const requiredAddressKeys = new Set(
      (goalRequirements.goal ? goalRequirements.requiredEnv : requiredEnvKeys)
        .filter((key) => ['ORACLE', 'FACTORY', 'USDC'].includes(key)),
    );
    if (requiredAddressKeys.has('ORACLE')) {
      codeTargets.push({ key: 'ORACLE', required: true });
    }
    if (requiredAddressKeys.has('FACTORY')) {
      codeTargets.push({ key: 'FACTORY', required: true });
    }

    if (options.checkUsdcCode && requiredAddressKeys.has('USDC')) {
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

    if (shouldCheckPolymarket) {
      const polymarketProbeTarget = `${String(report.polymarket.host).replace(/\/+$/, '')}/time`;
      const hostProbe = await probeHttpEndpoint(polymarketProbeTarget, options.rpcTimeoutMs, 'GET', {
        acceptAnyHttpStatus: true,
      });
      report.polymarket.hostReachability = hostProbe;
      if (!hostProbe.ok) {
        report.polymarket.failures.push(
          `Polymarket host reachability failed (${polymarketProbeTarget}): ${hostProbe.error || 'unknown error'}`,
        );
      }

      let polyCheck = null;
      try {
        polyCheck = await runPolymarketCheck({
          rpcUrl: report.polymarket.rpcUrl,
          privateKey: getEnvValue(runtimeEnv, 'POLYMARKET_PRIVATE_KEY') || null,
          funder: getEnvValue(runtimeEnv, 'POLYMARKET_FUNDER') || null,
          host: getEnvValue(runtimeEnv, 'POLYMARKET_HOST') || defaultPolymarketHost,
        });
        report.polymarket.check = polyCheck;
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        report.polymarket.failures.push(`Polymarket check failed: ${message}`);
        report.polymarket.check = null;
      }

      if (polyCheck) {
        if (!polyCheck.chainOk || polyCheck.chainId !== 137) {
          report.polymarket.failures.push(
            `Polymarket RPC chain must be Polygon (137). Received: ${polyCheck.chainId === null ? 'unknown' : polyCheck.chainId}.`,
          );
        }
        if (!polyCheck.runtime || !polyCheck.runtime.funderAddress) {
          report.polymarket.failures.push('POLYMARKET_FUNDER is not configured.');
        } else if (!polyCheck.ownership || polyCheck.ownership.funderCodePresent !== true) {
          report.polymarket.failures.push('POLYMARKET_FUNDER does not appear to be a contract/proxy wallet.');
        }
        if (!polyCheck.ownership || polyCheck.ownership.ok !== true) {
          report.polymarket.failures.push('Signer does not match/own configured POLYMARKET_FUNDER.');
        }
        if (!polyCheck.apiKeySanity || polyCheck.apiKeySanity.ok !== true) {
          report.polymarket.failures.push(
            `Polymarket API-key derivation/sanity failed (${polyCheck.apiKeySanity ? polyCheck.apiKeySanity.status : 'unknown'}).`,
          );
        }
        if (Array.isArray(polyCheck.diagnostics) && polyCheck.diagnostics.length) {
          report.polymarket.warnings.push(...polyCheck.diagnostics);
        }
      }
    }

    if (envState.missing.length) {
      report.journeyReadiness.missing.push(...envState.missing);
    }
    if (envState.errors.length) {
      report.journeyReadiness.warnings.push(...envState.errors);
    }
    if (shouldCheckPolymarket && report.polymarket && Array.isArray(report.polymarket.failures)) {
      report.journeyReadiness.warnings.push(...report.polymarket.failures);
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
    if (shouldCheckPolymarket) {
      failures.push(...report.polymarket.failures);
      report.summary.warningCount += report.polymarket.warnings.length;
    }
    if (goalRequirements.needResolutionSources) {
      const rawResolutionSources = String(getEnvValue(runtimeEnv, 'PANDORA_RESOLUTION_SOURCES') || '').trim();
      if (rawResolutionSources) {
        const resolutionSources = normalizeResolutionSources([rawResolutionSources]);
        if (resolutionSources.length < 2) {
          const message =
            'PANDORA_RESOLUTION_SOURCES is optional, but when set it should contain at least two public source URLs.';
          report.journeyReadiness.warnings.push(message);
          report.summary.warningCount += 1;
        }
      }
    }

    if (report.journeyReadiness.missing.length) {
      report.journeyReadiness.status = 'blocked';
    } else if (report.journeyReadiness.warnings.length) {
      report.journeyReadiness.status = 'ready-with-notes';
    }

    report.summary.errorCount = failures.length;
    report.summary.ok = failures.length === 0;
    report.summary.failures = failures;
    return report;
  }

  return {
    buildDoctorReport,
  };
}

module.exports = {
  createDoctorService,
};
