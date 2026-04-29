'use strict';

const crypto = require('crypto');

const { buildGoalBlueprint, buildSetupPlan, JOURNEY_GOALS, normalizeGoal } = require('./setup_plan_service.cjs');
const { createSetupTerminalUi } = require('./setup_terminal_ui.cjs');

const DEFAULT_POLYMARKET_HOST = 'https://clob.polymarket.com';
const DEFAULT_POLYMARKET_RPC_URL = 'https://polygon-bor-rpc.publicnode.com';
const DEFAULT_DIGITALOCEAN_API_BASE_URL = 'https://api.digitalocean.com/v2';
const MIRROR_GOALS = new Set(['paper-mirror', 'live-mirror']);
const HEDGE_DAEMON_GOALS = new Set(['paper-hedge-daemon', 'live-hedge-daemon']);
const POLYMARKET_GOALS = new Set([...MIRROR_GOALS, ...HEDGE_DAEMON_GOALS]);
const LIVE_POLYMARKET_GOALS = new Set(['live-mirror', 'live-hedge-daemon']);
const HOSTED_SETUP_GOALS = new Set(['deploy', 'paper-mirror', 'live-mirror', 'paper-hedge-daemon', 'live-hedge-daemon', 'hosted-gateway']);
const PANDORA_SIGNER_GOALS = new Set(['deploy', 'paper-mirror', 'live-mirror', 'paper-hedge-daemon', 'live-hedge-daemon']);
const SPORTS_SETUP_GOALS = new Set(['deploy', 'paper-mirror', 'live-mirror']);

function generatePrivateKey() {
  return `0x${crypto.randomBytes(32).toString('hex')}`;
}

function sanitizePrivateKey(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const hex = normalized.startsWith('0x') ? normalized.slice(2) : normalized;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return `0x${hex.toLowerCase()}`;
}

function maskValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 12) return `${text.slice(0, 2)}...`;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeResolutionSources(value) {
  return String(value || '')
    .split(',')
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function createSetupWizardService(deps = {}) {
  const isTTY = typeof deps.isTTY === 'boolean'
    ? deps.isTTY
    : Boolean(process.stdin && process.stdin.isTTY && process.stdout && process.stdout.isTTY);
  const stdin = deps.stdin || process.stdin;
  const stdout = deps.stdout || process.stdout;
  const CliError = deps.CliError || Error;
  const ui = createSetupTerminalUi({ stdin, stdout, isTTY });

  function ensureInteractive() {
    if (!isTTY) {
      throw new CliError('INTERACTIVE_TTY_REQUIRED', 'Interactive setup requires an attached TTY. Use manual setup instead.');
    }
  }

  function mergeEnv(currentEnv, updates) {
    return {
      ...(currentEnv && typeof currentEnv === 'object' ? currentEnv : {}),
      ...(updates && typeof updates === 'object' ? updates : {}),
    };
  }

  async function chooseGoal(currentGoal) {
    if (currentGoal) return currentGoal;
    const choice = await ui.select(
      'Choose a setup goal',
      JOURNEY_GOALS.map((entry) => ({
        ...entry,
        value: entry.id,
      })),
      { initialIndex: 0 },
    );
    return choice.value;
  }

  async function chooseMode(goal) {
    const choice = await ui.select(
      'Choose how to proceed',
      [
        {
          label: 'Guided onboarding',
          description: 'Walk through setup, review changes, and then write.',
          value: 'guided',
        },
        {
          label: 'Manual scaffold only',
          description: 'Copy the example env and leave the rest for manual editing.',
          value: 'manual',
        },
      ],
      { initialIndex: goal === 'explore' || goal === 'hosted-gateway' ? 1 : 0 },
    );
    return choice.value;
  }

  async function askBoolean(message, defaultValue) {
    return ui.confirm(message, defaultValue);
  }

  async function chooseOptionalStep(prompt, options = {}) {
    const choice = await ui.select(
      prompt,
      [
        {
          label: options.enabledLabel || 'Configure now',
          description: options.enabledDescription || 'Capture these values during guided setup.',
          value: 'enabled',
        },
        {
          label: options.skipLabel || 'Skip for now',
          description: options.skipDescription || 'Leave this step for manual setup later.',
          value: 'skip',
        },
      ],
      { initialIndex: options.defaultSelected ? 0 : 1 },
    );
    return choice.value === 'enabled';
  }

  function createStepPresenter(plan) {
    const steps = Array.isArray(plan && plan.steps) ? plan.steps : [];
    let currentIndex = 0;

    return (stepId) => {
      const step = steps.find((entry) => entry && entry.id === stepId);
      if (!step) return;
      currentIndex += 1;
      ui.writeLines([
        '',
        `Step ${currentIndex}/${steps.length}`,
        step.title,
        step.description,
      ]);
    };
  }

  async function collectRuntimeBasics(blueprint, currentEnv, updates) {
    for (const field of blueprint.runtimeFields) {
      const existing = normalizeText(currentEnv[field.envKey]);
      if (existing) {
        continue;
      }

      let answer = null;
      for (;;) {
        answer = normalizeText(await ui.question(field.label, {
          defaultValue: currentEnv[field.envKey] || null,
        }));
        if (answer) break;
        if (!field.required) break;
        ui.writeLine(`Missing required value for ${field.envKey}.`);
      }

      if (answer) {
        updates[field.envKey] = answer;
      }
    }
  }

  async function askPrivateKeyDecision(label, existingValue, defaultSelected) {
    const keepLabel = existingValue ? 'Keep current value' : 'Skip for now';
    const choice = await ui.select(
      `${label}${existingValue ? `\nCurrent value: ${maskValue(existingValue)}` : ''}`,
      [
        {
          label: 'Generate new key',
          description: 'Create a fresh private key locally.',
          value: 'generate',
        },
        {
          label: 'Import existing key',
          description: 'Paste a known private key.',
          value: 'import',
        },
        {
          label: keepLabel,
          description: 'Leave this signer unchanged.',
          value: 'skip',
        },
      ],
      { initialIndex: defaultSelected ? 0 : 2 },
    );

    if (choice.value === 'generate') {
      return { action: 'generate', value: generatePrivateKey() };
    }

    if (choice.value === 'import') {
      for (;;) {
        const candidate = sanitizePrivateKey(await ui.question('Paste private key', { secret: true }));
        if (candidate) {
          return { action: 'import', value: candidate };
        }
        ui.writeLine('Invalid private key format. Expected 0x + 64 hex chars.');
      }
    }

    return { action: 'skip', value: existingValue || null };
  }

  async function collectPandoraSigner(goal, currentEnv, updates, notes) {
    if (!PANDORA_SIGNER_GOALS.has(goal)) {
      notes.push('Skipped Pandora signer setup for the selected goal.');
      return;
    }

    const decision = await askPrivateKeyDecision(
      'Pandora private key',
      currentEnv.PANDORA_PRIVATE_KEY || currentEnv.PRIVATE_KEY || null,
      goal === 'live-mirror' || goal === 'live-hedge-daemon' || goal === 'deploy',
    );

    if (decision.value) {
      updates.PANDORA_PRIVATE_KEY = decision.value;
    }

    notes.push(
      decision.action === 'generate'
        ? 'Generated a new Pandora private key.'
        : decision.action === 'import'
          ? 'Imported a Pandora private key.'
          : 'Left the Pandora private key unchanged.',
    );
  }

  async function collectPolymarketConnectivity(goal, currentEnv, updates, notes) {
    if (!POLYMARKET_GOALS.has(goal)) {
      return { enabled: false };
    }

    const host = normalizeText(await ui.question('Polymarket host', {
      defaultValue: currentEnv.POLYMARKET_HOST || DEFAULT_POLYMARKET_HOST,
    }));
    const rpcUrl = normalizeText(await ui.question('Polymarket Polygon RPC URL', {
      defaultValue: currentEnv.POLYMARKET_RPC_URL || DEFAULT_POLYMARKET_RPC_URL,
    }));

    if (host) updates.POLYMARKET_HOST = host;
    if (rpcUrl) updates.POLYMARKET_RPC_URL = rpcUrl;
    notes.push('Captured Polymarket host and Polygon RPC settings.');
    return { enabled: true };
  }

  async function collectPolymarketSigner(goal, currentEnv, updates, notes) {
    if (!POLYMARKET_GOALS.has(goal)) {
      return false;
    }

    const decision = await askPrivateKeyDecision(
      'Polymarket private key',
      currentEnv.POLYMARKET_PRIVATE_KEY || null,
      LIVE_POLYMARKET_GOALS.has(goal),
    );
    if (decision.value) {
      updates.POLYMARKET_PRIVATE_KEY = decision.value;
    }

    const existingFunder = normalizeText(currentEnv.POLYMARKET_FUNDER || null);
    if (decision.value || existingFunder) {
      const funder = normalizeText(await ui.question('Polymarket funder / proxy wallet address', {
        defaultValue: currentEnv.POLYMARKET_FUNDER || null,
      }));
      if (funder) {
        updates.POLYMARKET_FUNDER = funder;
      }
    }

    notes.push(
      decision.action === 'generate'
        ? 'Generated a new Polymarket private key.'
        : decision.action === 'import'
          ? 'Imported a Polymarket private key.'
          : 'Left the Polymarket private key unchanged.',
    );
    return Boolean(decision.value || existingFunder);
  }

  async function collectPolymarketApi(goal, currentEnv, updates, notes) {
    if (!LIVE_POLYMARKET_GOALS.has(goal)) return;

    const apiKey = normalizeText(await ui.question('Polymarket API key', {
      secret: true,
      defaultValue: currentEnv.POLYMARKET_API_KEY || null,
    }));
    const apiSecret = normalizeText(await ui.question('Polymarket API secret', {
      secret: true,
      defaultValue: currentEnv.POLYMARKET_API_SECRET || null,
    }));
    const apiPassphrase = normalizeText(await ui.question('Polymarket API passphrase', {
      secret: true,
      defaultValue: currentEnv.POLYMARKET_API_PASSPHRASE || null,
    }));

    if (apiKey) updates.POLYMARKET_API_KEY = apiKey;
    if (apiSecret) updates.POLYMARKET_API_SECRET = apiSecret;
    if (apiPassphrase) updates.POLYMARKET_API_PASSPHRASE = apiPassphrase;
    notes.push('Captured Polymarket API credentials.');
  }

  async function collectHedgeDaemonPolicy(goal, currentEnv, updates, notes) {
    if (!HEDGE_DAEMON_GOALS.has(goal)) return false;

    const internalWalletsFile = normalizeText(await ui.question('Internal wallet whitelist file', {
      defaultValue: currentEnv.PANDORA_INTERNAL_WALLETS_FILE || null,
    }));
    const minHedgeUsdc = normalizeText(await ui.question('Minimum hedge size in USDC', {
      defaultValue: currentEnv.PANDORA_HEDGE_MIN_USDC || '25',
    }));
    const partialPolicy = await ui.select(
      'Partial hedge policy',
      [
        {
          label: 'Partial fills',
          description: 'Execute available depth and queue only the residual exposure.',
          value: 'partial',
        },
        {
          label: 'Queue whole hedge',
          description: 'Skip execution whenever full depth is not available.',
          value: 'skip',
        },
      ],
      {
        initialIndex: String(currentEnv.PANDORA_HEDGE_PARTIAL_POLICY || '').trim().toLowerCase() === 'skip' ? 1 : 0,
      },
    );
    const sellPolicy = await ui.select(
      'Sell hedge policy',
      [
        {
          label: 'Depth checked',
          description: 'Auto-sell on Polymarket only when sell-side depth passes.',
          value: 'depth-checked',
        },
        {
          label: 'Manual only',
          description: 'Never auto-sell hedge inventory; queue the reduction and alert the operator.',
          value: 'manual-only',
        },
      ],
      {
        initialIndex: String(currentEnv.PANDORA_HEDGE_SELL_POLICY || '').trim().toLowerCase() === 'manual-only' ? 1 : 0,
      },
    );

    if (internalWalletsFile) updates.PANDORA_INTERNAL_WALLETS_FILE = internalWalletsFile;
    if (minHedgeUsdc) updates.PANDORA_HEDGE_MIN_USDC = minHedgeUsdc;
    updates.PANDORA_HEDGE_PARTIAL_POLICY = partialPolicy.value;
    updates.PANDORA_HEDGE_SELL_POLICY = sellPolicy.value;
    notes.push('Captured hedge daemon whitelist and hedge policy defaults.');
    return true;
  }

  async function collectSportsConfig(goal, currentEnv, updates, notes) {
    if (!SPORTS_SETUP_GOALS.has(goal)) return;

    const providerChoice = await ui.select(
      goal === 'deploy'
        ? 'Sports / Odds provider for deploy-time market discovery'
        : 'Sports / Odds provider for mirror discovery',
      [
        {
          label: 'Skip for now',
          description: 'Leave sports provider defaults unset.',
          value: 'skip',
        },
        {
          label: 'The Odds API style',
          description: 'Use a primary provider with query-param API key defaults.',
          value: 'odds-api',
        },
        {
          label: 'Generic sportsbook provider',
          description: 'Capture custom URLs and API key behavior manually.',
          value: 'generic',
        },
      ],
      { initialIndex: 0 },
    );
    if (providerChoice.value === 'skip') {
      notes.push('Sports/Odds provider setup skipped.');
      return false;
    }

    updates.SPORTSBOOK_PROVIDER_MODE = 'primary';

    const primaryBaseUrl = normalizeText(await ui.question('Primary sportsbook base URL', {
      defaultValue: currentEnv.SPORTSBOOK_PRIMARY_BASE_URL || null,
    }));
    const backupBaseUrl = normalizeText(await ui.question('Backup sportsbook base URL', {
      defaultValue: currentEnv.SPORTSBOOK_BACKUP_BASE_URL || null,
    }));
    const apiKey = normalizeText(await ui.question('Primary sportsbook API key', {
      secret: true,
      defaultValue: currentEnv.SPORTSBOOK_PRIMARY_API_KEY || null,
    }));
    const apiKeyMode = normalizeText(await ui.question('Primary API key mode', {
      defaultValue: currentEnv.SPORTSBOOK_PRIMARY_API_KEY_MODE || (providerChoice.value === 'odds-api' ? 'query' : 'header'),
    })) || (providerChoice.value === 'odds-api' ? 'query' : 'header');
    const queryParam = normalizeText(await ui.question('Primary API key query param', {
      defaultValue: currentEnv.SPORTSBOOK_PRIMARY_API_KEY_QUERY_PARAM || 'apiKey',
    })) || 'apiKey';

    if (primaryBaseUrl) updates.SPORTSBOOK_PRIMARY_BASE_URL = primaryBaseUrl;
    if (backupBaseUrl) updates.SPORTSBOOK_BACKUP_BASE_URL = backupBaseUrl;
    if (apiKey) updates.SPORTSBOOK_PRIMARY_API_KEY = apiKey;
    if (apiKeyMode) updates.SPORTSBOOK_PRIMARY_API_KEY_MODE = apiKeyMode;
    if (queryParam) updates.SPORTSBOOK_PRIMARY_API_KEY_QUERY_PARAM = queryParam;

    notes.push('Sports/Odds provider configuration captured.');
  }

  function normalizeProviderKey(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || null;
  }

  async function collectHosting(goal, currentEnv, updates, notes) {
    if (!HOSTED_SETUP_GOALS.has(goal)) {
      return { provider: null };
    }

    const choice = await ui.select(
      goal === 'hosted-gateway'
        ? 'Choose the hosted gateway target'
        : 'Choose a deployment host',
      [
        {
          label: 'DigitalOcean',
          description: 'Capture DigitalOcean API settings.',
          value: 'digitalocean',
        },
        {
          label: 'Other provider',
          description: 'Capture provider name and optional API endpoint.',
          value: 'other',
        },
        {
          label: 'Local only',
          description: 'Keep this on the current machine for now.',
          value: 'local',
        },
        {
          label: 'Hosted later',
          description: 'Skip provider credentials for now.',
          value: 'later',
        },
      ],
      { initialIndex: goal === 'hosted-gateway' ? 0 : 2 },
    );

    if (choice.value === 'later') {
      notes.push('Hosting will be configured later.');
      return { provider: null };
    }

    if (choice.value === 'local') {
      updates.PANDORA_DAEMON_PROVIDER = 'local';
      notes.push('Recorded local-only hosting preference.');
      return { provider: 'local' };
    }

    if (choice.value === 'digitalocean') {
      const token = normalizeText(await ui.question('DigitalOcean API token', {
        secret: true,
        defaultValue: currentEnv.PANDORA_DAEMON_API_TOKEN || null,
      }));
      const baseUrl = normalizeText(await ui.question('DigitalOcean API base URL', {
        defaultValue: currentEnv.PANDORA_DAEMON_API_BASE_URL || DEFAULT_DIGITALOCEAN_API_BASE_URL,
      })) || DEFAULT_DIGITALOCEAN_API_BASE_URL;

      updates.PANDORA_DAEMON_PROVIDER = 'digitalocean';
      updates.PANDORA_DAEMON_API_BASE_URL = baseUrl;
      if (token) updates.PANDORA_DAEMON_API_TOKEN = token;
      notes.push(token
        ? 'Captured DigitalOcean deployment API settings.'
        : 'Recorded DigitalOcean as the deployment provider without an API token.');
      return { provider: 'digitalocean' };
    }

    const providerName = normalizeProviderKey(await ui.question('Provider name', {
      defaultValue: currentEnv.PANDORA_DAEMON_PROVIDER || 'other',
    })) || 'other';
    const token = normalizeText(await ui.question('Provider API token', {
      secret: true,
      defaultValue: currentEnv.PANDORA_DAEMON_API_TOKEN || null,
    }));
    const baseUrl = normalizeText(await ui.question('Provider API base URL', {
      defaultValue: currentEnv.PANDORA_DAEMON_API_BASE_URL || null,
    }));

    updates.PANDORA_DAEMON_PROVIDER = providerName;
    if (token) updates.PANDORA_DAEMON_API_TOKEN = token;
    if (baseUrl) updates.PANDORA_DAEMON_API_BASE_URL = baseUrl;
    notes.push(token
      ? `Captured deployment API settings for ${providerName}.`
      : `Recorded ${providerName} as the deployment provider without an API token.`);
    return { provider: providerName };
  }

  async function collectResolutionSources(goal, currentEnv, notes) {
    if (!MIRROR_GOALS.has(goal)) {
      return [];
    }

    const enabled = await chooseOptionalStep('Mirror resolution source defaults', {
      enabledLabel: 'Capture defaults now',
      enabledDescription: 'Store two public source URLs for future mirror commands.',
      skipLabel: 'Skip for now',
      skipDescription: 'Leave this unset and keep using explicit --sources later.',
      defaultSelected: true,
    });
    if (!enabled) {
      notes.push('Skipped env-backed mirror resolution defaults. Explicit --sources still works later.');
      return [];
    }

    const existing = normalizeResolutionSources(currentEnv.PANDORA_RESOLUTION_SOURCES || '');
    const first = normalizeText(await ui.question('Primary resolution source URL', {
      defaultValue: existing[0] || null,
    }));
    const second = normalizeText(await ui.question('Secondary resolution source URL', {
      defaultValue: existing[1] || null,
    }));
    const sources = [first, second].filter(Boolean);

    notes.push(
      sources.length >= 2
        ? 'Captured mirror resolution source defaults.'
        : 'Resolution source defaults remain incomplete. Explicit --sources still needs two public URLs.',
    );
    return sources;
  }

  function summarizeValidation(report) {
    if (!report || !report.journeyReadiness) {
      return { status: 'unknown', details: ['Validation unavailable.'] };
    }

    const details = [];
    if (Array.isArray(report.summary && report.summary.failures) && report.summary.failures.length) {
      details.push(...report.summary.failures.slice(0, 3));
    } else if (Array.isArray(report.journeyReadiness.recommendations) && report.journeyReadiness.recommendations.length) {
      details.push(...report.journeyReadiness.recommendations.slice(0, 2));
    }

    return {
      status: report.journeyReadiness.status || 'unknown',
      details,
    };
  }

  async function runValidation(context, stageId, goal, env, validations) {
    if (!context || typeof context.validateStage !== 'function') return null;
    const report = await context.validateStage({ stageId, goal, env });
    const summary = summarizeValidation(report);
    validations.push({ stageId, report, summary });

    ui.writeLines([
      '',
      `Validation - ${stageId}`,
      `Status: ${summary.status}`,
      ...summary.details.map((detail) => `- ${detail}`),
    ]);
    return report;
  }

  function buildReviewEntries(updates, resolutionSources) {
    const entries = [];
    const secretKeys = new Set([
      'PANDORA_PRIVATE_KEY',
      'POLYMARKET_PRIVATE_KEY',
      'POLYMARKET_API_KEY',
      'POLYMARKET_API_SECRET',
      'POLYMARKET_API_PASSPHRASE',
      'PANDORA_DAEMON_API_TOKEN',
      'SPORTSBOOK_PRIMARY_API_KEY',
    ]);

    for (const [key, value] of Object.entries(updates || {})) {
      if (!normalizeText(value)) continue;
      entries.push({
        key,
        value: secretKeys.has(key) ? maskValue(value) : value,
      });
    }

    if (Array.isArray(resolutionSources) && resolutionSources.length) {
      entries.push({
        key: 'PANDORA_RESOLUTION_SOURCES',
        value: resolutionSources.join(', '),
      });
    }

    return entries.sort((left, right) => String(left.key).localeCompare(String(right.key)));
  }

  async function reviewBeforeWrite(goal, mode, updates, resolutionSources, validations, notes) {
    const reviewEntries = buildReviewEntries(updates, resolutionSources);
    ui.writeLines([
      '',
      'Review',
      'Planned changes:',
      ...(reviewEntries.length
        ? reviewEntries.map((entry) => `- ${entry.key}=${entry.value}`)
        : ['- No env changes captured.']),
    ]);

    if (validations.length) {
      ui.writeLine('Validation checkpoints:');
      for (const checkpoint of validations) {
        ui.writeLine(`- ${checkpoint.stageId}: ${checkpoint.summary.status}`);
      }
    }

    const choice = await ui.select(
      'Review before write',
      [
        {
          label: 'Write changes',
          description: 'Persist the reviewed env updates to disk.',
          value: 'write',
        },
        {
          label: 'Cancel without writing',
          description: 'Exit now and leave the env file untouched.',
          value: 'cancel',
        },
      ],
      { initialIndex: 0 },
    );

    return {
      confirmed: choice.value !== 'cancel',
      entries: reviewEntries,
      validations: validations.map((entry) => ({
        stageId: entry.stageId,
        status: entry.summary.status,
        details: entry.summary.details,
      })),
      model: {
        goal,
        mode,
        entries: reviewEntries,
        validations: validations.map((entry) => ({
          stageId: entry.stageId,
          status: entry.summary.status,
          details: entry.summary.details,
        })),
        notes: Array.isArray(notes) ? notes.slice() : [],
      },
    };
  }

  async function runSetupWizard(context = {}) {
    ensureInteractive();

    const currentEnv = context.currentEnv && typeof context.currentEnv === 'object' ? context.currentEnv : {};
    const goal = await chooseGoal(normalizeGoal(context.goal));
    const blueprint = buildGoalBlueprint(goal);
    const plan = buildSetupPlan({ goal, currentEnv });
    const presentStep = createStepPresenter(plan);
    const mode = await chooseMode(goal);
    const updates = {};
    const notes = [];
    const validations = [];

    if (mode === 'manual') {
      notes.push('Manual mode selected. The wizard will scaffold the env file and leave values for you to edit.');
      return {
        mode,
        goal,
        updates,
        notes,
        hosting: { provider: null },
        resolutionSources: [],
        review: {
          confirmed: true,
          entries: [],
          validations: [],
        },
        plan,
      };
    }

    ui.writeLines([
      '',
      `${blueprint.label} onboarding`,
      blueprint.description,
      'Use arrow keys and Enter where supported. Numeric input still works in limited terminals.',
    ]);

    presentStep('runtime-basics');
    await collectRuntimeBasics(blueprint, currentEnv, updates);
    if (Object.keys(updates).some((key) => blueprint.runtimeFields.some((field) => field.envKey === key))) {
      await runValidation(context, 'runtime-basics', goal, mergeEnv(currentEnv, updates), validations);
    }

    if (blueprint.promptPandoraSigner) {
      presentStep('pandora-signer');
    }
    await collectPandoraSigner(goal, currentEnv, updates, notes);
    if (updates.PANDORA_PRIVATE_KEY || updates.PANDORA_DEPLOYER_PRIVATE_KEY) {
      await runValidation(context, 'pandora-signer', goal, mergeEnv(currentEnv, updates), validations);
    }

    if (blueprint.promptPolymarketConnectivity) {
      presentStep('polymarket-connectivity');
    }
    const connectivity = await collectPolymarketConnectivity(goal, currentEnv, updates, notes);
    if (connectivity.enabled) {
      await runValidation(context, 'polymarket', goal, mergeEnv(currentEnv, updates), validations);
    }

    if (blueprint.promptPolymarketSigner) {
      presentStep('polymarket-signer');
    }
    const signerEnabled = await collectPolymarketSigner(goal, currentEnv, updates, notes);
    if (signerEnabled) {
      await runValidation(context, 'polymarket-signer', goal, mergeEnv(currentEnv, updates), validations);
    }

    if (blueprint.promptPolymarketApi) {
      presentStep('polymarket-api');
    }
    await collectPolymarketApi(goal, currentEnv, updates, notes);

    if (HEDGE_DAEMON_GOALS.has(goal)) {
      presentStep('hedge-daemon-policy');
    }
    const hedgePolicyEnabled = await collectHedgeDaemonPolicy(goal, currentEnv, updates, notes);
    if (hedgePolicyEnabled) {
      await runValidation(context, 'hedge-daemon-policy', goal, mergeEnv(currentEnv, updates), validations);
    }

    if (blueprint.promptHosting) {
      presentStep('hosting');
    }
    const hosting = await collectHosting(goal, currentEnv, updates, notes);

    if (blueprint.promptSports) {
      presentStep('sports-odds');
    }
    await collectSportsConfig(goal, currentEnv, updates, notes);

    if (blueprint.promptResolutionSources) {
      presentStep('resolution-sources');
    }
    const resolutionSources = await collectResolutionSources(goal, currentEnv, notes);

    const previewEnv = mergeEnv(currentEnv, {
      ...updates,
      ...(resolutionSources.length
        ? { PANDORA_RESOLUTION_SOURCES: resolutionSources.join(',') }
        : {}),
    });
    await runValidation(context, 'final-preview', goal, previewEnv, validations);

    presentStep('review');
    const review = await reviewBeforeWrite(goal, mode, updates, resolutionSources, validations, notes);
    if (!review.confirmed) {
      notes.push('Cancelled before writing changes.');
    }

    return {
      mode,
      goal,
      updates,
      notes,
      hosting: { provider: hosting.provider },
      resolutionSources,
      cancelled: !review.confirmed,
      review,
      validations,
      plan,
    };
  }

  return {
    runSetupWizard,
    normalizeGoal,
    sanitizePrivateKey,
    maskValue,
  };
}

module.exports = {
  JOURNEY_GOALS,
  createSetupWizardService,
  normalizeGoal,
  sanitizePrivateKey,
  generatePrivateKey,
  maskValue,
};
