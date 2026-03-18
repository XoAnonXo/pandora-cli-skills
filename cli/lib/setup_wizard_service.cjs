'use strict';

const readline = require('readline');
const crypto = require('crypto');

const DEFAULT_POLYMARKET_HOST = 'https://clob.polymarket.com';
const DEFAULT_POLYMARKET_RPC_URL = 'https://polygon-bor-rpc.publicnode.com';
const DEFAULT_DIGITALOCEAN_API_BASE_URL = 'https://api.digitalocean.com/v2';

const JOURNEY_GOALS = Object.freeze([
  { id: 'explore', label: 'Explore only', description: 'Read-only discovery and contract inspection.' },
  { id: 'deploy', label: 'Deploy', description: 'Prepare a Pandora market for execution.' },
  { id: 'paper-mirror', label: 'Paper mirror', description: 'Prepare a paper-mode Polymarket mirror.' },
  { id: 'live-mirror', label: 'Live mirror', description: 'Prepare a live hedging daemon.' },
  { id: 'hosted-gateway', label: 'Hosted gateway', description: 'Prepare a remote read-only or operator gateway.' },
]);

function normalizeGoal(goal) {
  const normalized = String(goal || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'paper') return 'paper-mirror';
  if (normalized === 'live') return 'live-mirror';
  if (normalized === 'gateway') return 'hosted-gateway';
  return JOURNEY_GOALS.some((entry) => entry.id === normalized) ? normalized : null;
}

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

function question(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

function parseChoice(answer, max, defaultIndex) {
  const normalized = String(answer || '').trim();
  if (!normalized) return defaultIndex;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed)) return defaultIndex;
  if (parsed < 1 || parsed > max) return defaultIndex;
  return parsed - 1;
}

function parseYesNo(answer, defaultValue) {
  const normalized = String(answer || '').trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['y', 'yes', 'true', '1'].includes(normalized)) return true;
  if (['n', 'no', 'false', '0'].includes(normalized)) return false;
  return defaultValue;
}

function createSecretQuestion(rl) {
  const originalWrite = rl._writeToOutput;
  return async function askSecret(prompt) {
    rl.stdoutMuted = true;
    rl._writeToOutput = function writeMasked(stringToWrite) {
      if (rl.stdoutMuted) {
        const stripped = String(stringToWrite || '').replace(/[\r\n]+/g, '');
        if (stripped) {
          rl.output.write('*'.repeat(stripped.length));
          return;
        }
      }
      originalWrite.call(rl, stringToWrite);
    };

    try {
      rl.output.write(prompt);
      return await question(rl, '');
    } finally {
      rl.stdoutMuted = false;
      rl._writeToOutput = originalWrite;
    }
  };
}

function normalizeUrl(value) {
  const text = String(value || '').trim();
  return text || null;
}

function createSetupWizardService(deps = {}) {
  const isTTY = typeof deps.isTTY === 'boolean'
    ? deps.isTTY
    : Boolean(process.stdin && process.stdin.isTTY && process.stdout && process.stdout.isTTY);
  const stdin = deps.stdin || process.stdin;
  const stdout = deps.stdout || process.stdout;
  const CliError = deps.CliError || Error;

  function ensureInteractive() {
    if (!isTTY) {
      throw new CliError('INTERACTIVE_TTY_REQUIRED', 'Interactive setup requires an attached TTY. Use manual setup instead.');
    }
  }

  async function askGoal(rl, currentGoal) {
    if (currentGoal) return currentGoal;

    stdout.write('\nChoose a setup goal:\n');
    for (let i = 0; i < JOURNEY_GOALS.length; i += 1) {
      const entry = JOURNEY_GOALS[i];
      stdout.write(`  ${i + 1}. ${entry.label} - ${entry.description}\n`);
    }
    const choice = parseChoice(await question(rl, 'Select [1]: '), JOURNEY_GOALS.length, 0);
    return JOURNEY_GOALS[choice].id;
  }

  async function askMode(rl) {
    stdout.write('\nChoose how to proceed:\n');
    stdout.write('  1. Guided onboarding\n');
    stdout.write('  2. Manual scaffold only\n');
    const choice = parseChoice(await question(rl, 'Select [1]: '), 2, 0);
    return choice === 1 ? 'manual' : 'guided';
  }

  async function askPrivateKeyDecision(rl, label, existingValue) {
    stdout.write(`\n${label}\n`);
    if (existingValue) {
      stdout.write(`Current value detected: ${maskValue(existingValue)}\n`);
    }
    stdout.write('  1. Generate a new key\n');
    stdout.write('  2. Import an existing key\n');
    stdout.write('  3. Keep current / skip\n');
    const choice = parseChoice(await question(rl, 'Select [3]: '), 3, 2);
    if (choice === 0) {
      return { action: 'generate', value: generatePrivateKey() };
    }
    if (choice === 1) {
      const askSecret = createSecretQuestion(rl);
      for (;;) {
        const candidate = sanitizePrivateKey(await askSecret('Paste private key (hidden): '));
        if (candidate) {
          return { action: 'import', value: candidate };
        }
        stdout.write('Invalid private key format. Expected 0x + 64 hex chars.\n');
      }
    }
    return { action: 'skip', value: existingValue || null };
  }

  async function askOptionalSportsConfig(rl, existingEnv) {
    const enabled = parseYesNo(
      await question(rl, '\nConfigure sportsbook/Odds API now? [n]: '),
      false,
    );

    if (!enabled) {
      return { updates: {}, notes: ['Sports/Odds API setup skipped.'] };
    }

    const updates = {};
    const askSecret = createSecretQuestion(rl);
    const primaryBaseUrl = normalizeUrl(await question(rl, `Primary sportsbook base URL${existingEnv.SPORTSBOOK_PRIMARY_BASE_URL ? ` [${existingEnv.SPORTSBOOK_PRIMARY_BASE_URL}]` : ''}: `));
    const backupBaseUrl = normalizeUrl(await question(rl, `Backup sportsbook base URL${existingEnv.SPORTSBOOK_BACKUP_BASE_URL ? ` [${existingEnv.SPORTSBOOK_BACKUP_BASE_URL}]` : ''}: `));
    const apiKey = normalizeUrl(await askSecret(`Primary API key${existingEnv.SPORTSBOOK_PRIMARY_API_KEY ? ' [set]' : ''}: `));
    const apiKeyMode = normalizeUrl(await question(rl, `Primary API key mode [header|query]${existingEnv.SPORTSBOOK_PRIMARY_API_KEY_MODE ? ` [${existingEnv.SPORTSBOOK_PRIMARY_API_KEY_MODE}]` : ''}: `)) || 'header';
    const queryParam = normalizeUrl(await question(rl, `Primary API key query param${existingEnv.SPORTSBOOK_PRIMARY_API_KEY_QUERY_PARAM ? ` [${existingEnv.SPORTSBOOK_PRIMARY_API_KEY_QUERY_PARAM}]` : ''}: `)) || 'apiKey';

    if (primaryBaseUrl) updates.SPORTSBOOK_PRIMARY_BASE_URL = primaryBaseUrl;
    if (backupBaseUrl) updates.SPORTSBOOK_BACKUP_BASE_URL = backupBaseUrl;
    if (apiKey) updates.SPORTSBOOK_PRIMARY_API_KEY = apiKey;
    if (apiKeyMode) updates.SPORTSBOOK_PRIMARY_API_KEY_MODE = apiKeyMode;
    if (queryParam) updates.SPORTSBOOK_PRIMARY_API_KEY_QUERY_PARAM = queryParam;

    return {
      updates,
      notes: ['Sports/Odds API configuration captured.'],
    };
  }

  async function askPolymarketConnectivity(rl, existingEnv) {
    const defaultHost = normalizeUrl(existingEnv.POLYMARKET_HOST) || DEFAULT_POLYMARKET_HOST;
    const defaultRpcUrl = normalizeUrl(existingEnv.POLYMARKET_RPC_URL) || DEFAULT_POLYMARKET_RPC_URL;
    const host = normalizeUrl(await question(rl, `Polymarket host [${defaultHost}]: `)) || defaultHost;
    const rpcUrl = normalizeUrl(await question(rl, `Polymarket Polygon RPC URL [${defaultRpcUrl}]: `)) || defaultRpcUrl;

    return {
      updates: {
        POLYMARKET_HOST: host,
        POLYMARKET_RPC_URL: rpcUrl,
      },
      notes: ['Captured Polymarket host and Polygon RPC settings.'],
    };
  }

  function normalizeProviderKey(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || null;
  }

  async function askOptionalHosting(rl, existingEnv) {
    const enabled = parseYesNo(await question(rl, '\nCapture deployment host preferences now? [n]: '), false);
    if (!enabled) {
      return { provider: null, updates: {}, notes: ['Hosting preferences skipped.'] };
    }

    stdout.write('  1. DigitalOcean\n');
    stdout.write('  2. Other provider\n');
    stdout.write('  3. Local only\n');
    const choice = parseChoice(await question(rl, 'Select [1]: '), 3, 0);
    const askSecret = createSecretQuestion(rl);
    const updates = {};

    if (choice === 2) {
      updates.PANDORA_DAEMON_PROVIDER = 'local';
      return {
        provider: 'local',
        updates,
        notes: ['Hosting preference recorded: local-only runtime.'],
      };
    }

    if (choice === 0) {
      const provider = 'digitalocean';
      const defaultBaseUrl = normalizeUrl(existingEnv.PANDORA_DAEMON_API_BASE_URL) || DEFAULT_DIGITALOCEAN_API_BASE_URL;
      const token = normalizeUrl(await askSecret(`DigitalOcean API token${existingEnv.PANDORA_DAEMON_API_TOKEN ? ' [set]' : ''}: `));
      const baseUrl = normalizeUrl(await question(rl, `DigitalOcean API base URL [${defaultBaseUrl}]: `)) || defaultBaseUrl;
      updates.PANDORA_DAEMON_PROVIDER = provider;
      updates.PANDORA_DAEMON_API_BASE_URL = baseUrl;
      if (token) {
        updates.PANDORA_DAEMON_API_TOKEN = token;
      }
      return {
        provider,
        updates,
        notes: [
          token
            ? 'Captured DigitalOcean deployment API settings.'
            : 'Recorded DigitalOcean as the deployment provider, but left the API token unset.',
        ],
      };
    }

    const existingProvider = existingEnv.PANDORA_DAEMON_PROVIDER && existingEnv.PANDORA_DAEMON_PROVIDER !== 'digitalocean'
      ? existingEnv.PANDORA_DAEMON_PROVIDER
      : '';
    const providerName = normalizeProviderKey(await question(
      rl,
      `Provider name${existingProvider ? ` [${existingProvider}]` : ''}: `,
    )) || existingProvider || 'other';
    const defaultBaseUrl = normalizeUrl(existingEnv.PANDORA_DAEMON_API_BASE_URL);
    const token = normalizeUrl(await askSecret(`Provider API token${existingEnv.PANDORA_DAEMON_API_TOKEN ? ' [set]' : ''}: `));
    const baseUrl = normalizeUrl(await question(
      rl,
      `Provider API base URL${defaultBaseUrl ? ` [${defaultBaseUrl}]` : ''}: `,
    )) || defaultBaseUrl;
    updates.PANDORA_DAEMON_PROVIDER = providerName;
    if (baseUrl) {
      updates.PANDORA_DAEMON_API_BASE_URL = baseUrl;
    }
    if (token) {
      updates.PANDORA_DAEMON_API_TOKEN = token;
    }
    return {
      provider: providerName,
      updates,
      notes: [
        token
          ? `Captured deployment API settings for ${providerName}.`
          : `Recorded ${providerName} as the deployment provider, but left the API token unset.`,
      ],
    };
  }

  async function askResolutionSources(rl, goal) {
    if (!['deploy', 'paper-mirror', 'live-mirror'].includes(goal)) {
      return { sources: [], notes: [] };
    }

    const enabled = parseYesNo(
      await question(rl, '\nCapture two public resolution source URLs for future mirror commands? [y]: '),
      true,
    );
    if (!enabled) {
      return {
        sources: [],
        notes: ['Mirror deploy/go still needs two independent public resolution sources later.'],
      };
    }

    const first = normalizeUrl(await question(rl, 'Primary resolution source URL: '));
    const second = normalizeUrl(await question(rl, 'Secondary resolution source URL: '));
    const sources = [first, second].filter(Boolean);
    return {
      sources,
      notes: sources.length >= 2
        ? ['Resolution source hints captured for later mirror use.']
        : ['Resolution sources remain incomplete. Mirror deploy/go still needs two independent public URLs.'],
    };
  }

  async function runSetupWizard(context = {}) {
    ensureInteractive();

    const rl = readline.createInterface({
      input: stdin,
      output: stdout,
      terminal: true,
    });

    try {
      const currentEnv = context.currentEnv && typeof context.currentEnv === 'object' ? context.currentEnv : {};
      const goal = normalizeGoal(context.goal) || await askGoal(rl, null);
      const mode = await askMode(rl);
      const updates = {};
      const notes = [];

      if (mode === 'manual') {
        notes.push('Manual mode selected. The wizard will scaffold the env file and leave values for you to edit.');
        return {
          mode,
          goal,
          updates,
          notes,
          hosting: { provider: null },
          resolutionSources: [],
        };
      }

      const pandoraDecision = await askPrivateKeyDecision(rl, 'Pandora private key', currentEnv.PANDORA_PRIVATE_KEY || currentEnv.PRIVATE_KEY || null);
      if (pandoraDecision.value) {
        updates.PANDORA_PRIVATE_KEY = pandoraDecision.value;
      }
      notes.push(
        pandoraDecision.action === 'generate'
          ? 'Generated a new Pandora private key.'
          : pandoraDecision.action === 'import'
            ? 'Imported a Pandora private key.'
            : 'Skipped Pandora private key setup.',
      );

      if (goal === 'live-mirror' || goal === 'paper-mirror') {
        const polymarketDecision = await askPrivateKeyDecision(
          rl,
          'Polymarket private key',
          currentEnv.POLYMARKET_PRIVATE_KEY || null,
        );
        if (polymarketDecision.value) {
          updates.POLYMARKET_PRIVATE_KEY = polymarketDecision.value;
        }
        notes.push(
          polymarketDecision.action === 'generate'
            ? 'Generated a new Polymarket private key.'
            : polymarketDecision.action === 'import'
              ? 'Imported a Polymarket private key.'
              : 'Skipped Polymarket private key setup.',
        );

        const funder = normalizeUrl(await question(
          rl,
          `Polymarket funder / proxy wallet address${currentEnv.POLYMARKET_FUNDER ? ` [${currentEnv.POLYMARKET_FUNDER}]` : ''}: `,
        ));
        if (funder) {
          updates.POLYMARKET_FUNDER = funder;
        }

        const polymarketConnectivity = await askPolymarketConnectivity(rl, currentEnv);
        Object.assign(updates, polymarketConnectivity.updates);
        notes.push(...polymarketConnectivity.notes);
      }

      if (goal === 'live-mirror') {
        const askSecret = createSecretQuestion(rl);
        const apiKey = normalizeUrl(await askSecret(`Polymarket API key${currentEnv.POLYMARKET_API_KEY ? ' [set]' : ''}: `));
        const apiSecret = normalizeUrl(await askSecret(`Polymarket API secret${currentEnv.POLYMARKET_API_SECRET ? ' [set]' : ''}: `));
        const apiPassphrase = normalizeUrl(await askSecret(`Polymarket API passphrase${currentEnv.POLYMARKET_API_PASSPHRASE ? ' [set]' : ''}: `));
        if (apiKey) updates.POLYMARKET_API_KEY = apiKey;
        if (apiSecret) updates.POLYMARKET_API_SECRET = apiSecret;
        if (apiPassphrase) updates.POLYMARKET_API_PASSPHRASE = apiPassphrase;
      }

      const sports = await askOptionalSportsConfig(rl, currentEnv);
      Object.assign(updates, sports.updates);
      notes.push(...sports.notes);

      const hosting = await askOptionalHosting(rl, currentEnv);
      Object.assign(updates, hosting.updates);
      notes.push(...hosting.notes);

      const sources = await askResolutionSources(rl, goal);
      notes.push(...sources.notes);

      return {
        mode,
        goal,
        updates,
        notes,
        hosting: { provider: hosting.provider },
        resolutionSources: sources.sources,
      };
    } finally {
      rl.close();
    }
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
