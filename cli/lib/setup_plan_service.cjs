'use strict';

const JOURNEY_GOALS = Object.freeze([
  { id: 'explore', label: 'Explore only', description: 'Read-only discovery and contract inspection.' },
  { id: 'hosted-gateway', label: 'Hosted gateway', description: 'Prepare a remote read-only or operator gateway.' },
  { id: 'paper-mirror', label: 'Paper mirror', description: 'Prepare a paper-mode Polymarket mirror.' },
  { id: 'live-mirror', label: 'Live mirror', description: 'Prepare a live hedging daemon.' },
  { id: 'deploy', label: 'Deploy', description: 'Prepare a Pandora market for execution.' },
]);

function normalizeGoal(goal) {
  const normalized = String(goal || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'paper') return 'paper-mirror';
  if (normalized === 'live') return 'live-mirror';
  if (normalized === 'gateway') return 'hosted-gateway';
  return JOURNEY_GOALS.some((entry) => entry.id === normalized) ? normalized : null;
}

function createField(envKey, label, kind, options = {}) {
  return {
    envKey,
    label,
    kind,
    required: Boolean(options.required),
    secret: Boolean(options.secret),
    description: options.description || '',
  };
}

function buildGoalBlueprint(goal) {
  const normalized = normalizeGoal(goal);
  switch (normalized) {
    case 'explore':
      return {
        goal: normalized,
        label: 'Explore only',
        description: 'Read-only discovery path with no signer setup by default.',
        runtimeFields: [
          createField('CHAIN_ID', 'Chain ID', 'integer', { required: true, description: 'Pandora chain identifier.' }),
          createField('RPC_URL', 'RPC URL', 'url', { required: true, description: 'HTTPS RPC endpoint for read-only inspection.' }),
        ],
        promptPandoraSigner: false,
        promptPolymarketConnectivity: false,
        promptPolymarketSigner: false,
        promptPolymarketApi: false,
        promptSports: false,
        promptHosting: false,
        promptResolutionSources: false,
      };
    case 'deploy':
      return {
        goal: normalized,
        label: 'Deploy',
        description: 'Deployment path for a Pandora market.',
        runtimeFields: [
          createField('CHAIN_ID', 'Chain ID', 'integer', { required: true, description: 'Pandora chain identifier.' }),
          createField('RPC_URL', 'RPC URL', 'url', { required: true, description: 'Execution RPC endpoint.' }),
          createField('ORACLE', 'Oracle address', 'address', { required: true, description: 'Oracle contract address.' }),
          createField('FACTORY', 'Factory address', 'address', { required: true, description: 'Pandora factory address.' }),
          createField('USDC', 'USDC address', 'address', { required: true, description: 'Settlement token address.' }),
        ],
        promptPandoraSigner: true,
        defaultPandoraSigner: true,
        promptPolymarketConnectivity: false,
        promptPolymarketSigner: false,
        promptPolymarketApi: false,
        promptSports: true,
        promptHosting: true,
        defaultHosting: false,
        promptResolutionSources: false,
      };
    case 'paper-mirror':
      return {
        goal: normalized,
        label: 'Paper mirror',
        description: 'Mirror planning with optional signer setup and no live hedge credentials required by default.',
        runtimeFields: [
          createField('CHAIN_ID', 'Chain ID', 'integer', { required: true, description: 'Pandora chain identifier.' }),
          createField('RPC_URL', 'RPC URL', 'url', { required: true, description: 'Execution or inspection RPC endpoint.' }),
          createField('ORACLE', 'Oracle address', 'address', { required: true, description: 'Oracle contract address.' }),
          createField('FACTORY', 'Factory address', 'address', { required: true, description: 'Pandora factory address.' }),
          createField('USDC', 'USDC address', 'address', { required: true, description: 'Settlement token address.' }),
        ],
        promptPandoraSigner: true,
        defaultPandoraSigner: false,
        promptPolymarketConnectivity: true,
        defaultPolymarketConnectivity: true,
        promptPolymarketSigner: true,
        defaultPolymarketSigner: false,
        promptPolymarketApi: false,
        promptSports: true,
        promptHosting: true,
        defaultHosting: false,
        promptResolutionSources: true,
      };
    case 'live-mirror':
      return {
        goal: normalized,
        label: 'Live mirror',
        description: 'Live hedging path with Pandora signer, Polymarket signer, and CLOB API credentials.',
        runtimeFields: [
          createField('CHAIN_ID', 'Chain ID', 'integer', { required: true, description: 'Pandora chain identifier.' }),
          createField('RPC_URL', 'RPC URL', 'url', { required: true, description: 'Execution RPC endpoint.' }),
          createField('ORACLE', 'Oracle address', 'address', { required: true, description: 'Oracle contract address.' }),
          createField('FACTORY', 'Factory address', 'address', { required: true, description: 'Pandora factory address.' }),
          createField('USDC', 'USDC address', 'address', { required: true, description: 'Settlement token address.' }),
        ],
        promptPandoraSigner: true,
        defaultPandoraSigner: true,
        promptPolymarketConnectivity: true,
        defaultPolymarketConnectivity: true,
        promptPolymarketSigner: true,
        defaultPolymarketSigner: true,
        promptPolymarketApi: true,
        defaultPolymarketApi: true,
        promptSports: true,
        promptHosting: true,
        defaultHosting: false,
        promptResolutionSources: true,
      };
    case 'hosted-gateway':
      return {
        goal: normalized,
        label: 'Hosted gateway',
        description: 'Remote gateway or control-plane path with read-only defaults.',
        runtimeFields: [
          createField('CHAIN_ID', 'Chain ID', 'integer', { required: true, description: 'Pandora chain identifier.' }),
          createField('RPC_URL', 'RPC URL', 'url', { required: true, description: 'Runtime connectivity endpoint.' }),
        ],
        promptPandoraSigner: false,
        defaultPandoraSigner: false,
        promptPolymarketConnectivity: false,
        promptPolymarketSigner: false,
        promptPolymarketApi: false,
        promptSports: false,
        promptHosting: true,
        defaultHosting: true,
        promptResolutionSources: false,
      };
    default:
      return null;
  }
}

function withDefaultValue(field, currentEnv = {}) {
  return {
    ...field,
    currentValue: Object.prototype.hasOwnProperty.call(currentEnv, field.envKey)
      ? currentEnv[field.envKey]
      : null,
  };
}

function buildSetupPlan(options = {}) {
  const currentEnv = options.currentEnv && typeof options.currentEnv === 'object' ? options.currentEnv : {};
  const goal = normalizeGoal(options.goal);
  const blueprint = buildGoalBlueprint(goal);

  if (!goal || !blueprint) {
    return {
      goal: null,
      mode: 'plan',
      goals: JOURNEY_GOALS.map((entry) => ({ ...entry })),
      steps: [],
      notes: [
        'Select a goal first, then request a goal-specific setup plan.',
        'Use `doctor --goal <goal>` to validate progress without writing files.',
      ],
    };
  }

  const steps = [];
  steps.push({
    id: 'runtime-basics',
    title: 'Runtime basics',
    description: 'Collect the core chain, RPC, and contract addresses needed for the selected goal.',
    writesEnv: blueprint.runtimeFields.map((field) => field.envKey),
    fields: blueprint.runtimeFields.map((field) => withDefaultValue(field, currentEnv)),
  });

  if (blueprint.promptPandoraSigner) {
    steps.push({
      id: 'pandora-signer',
      title: 'Pandora signer',
      description: 'Optional signer setup. Read-only paths may skip this and remain inspection-only.',
      writesEnv: ['PANDORA_PRIVATE_KEY'],
      decision: {
        defaultSelected: Boolean(blueprint.defaultPandoraSigner),
      },
      fields: [
        withDefaultValue(
          createField('PANDORA_PRIVATE_KEY', 'Pandora private key', 'private-key', {
            required: Boolean(blueprint.defaultPandoraSigner),
            secret: true,
            description: 'Generate or import the Pandora signer.',
          }),
          currentEnv,
        ),
      ],
    });
  }

  if (blueprint.promptPolymarketConnectivity) {
    steps.push({
      id: 'polymarket-connectivity',
      title: 'Polymarket connectivity',
      description: 'Capture discovery and Polygon RPC defaults for Polymarket workflows.',
      writesEnv: ['POLYMARKET_HOST', 'POLYMARKET_RPC_URL'],
      decision: {
        defaultSelected: Boolean(blueprint.defaultPolymarketConnectivity),
      },
      fields: [
        withDefaultValue(
          createField('POLYMARKET_HOST', 'Polymarket host', 'url', {
            required: Boolean(blueprint.defaultPolymarketConnectivity),
            description: 'CLOB host used for discovery and trading calls.',
          }),
          currentEnv,
        ),
        withDefaultValue(
          createField('POLYMARKET_RPC_URL', 'Polymarket Polygon RPC URL', 'url', {
            required: Boolean(blueprint.defaultPolymarketConnectivity),
            description: 'Polygon RPC used for wallet checks.',
          }),
          currentEnv,
        ),
      ],
    });
  }

  if (blueprint.promptPolymarketSigner) {
    steps.push({
      id: 'polymarket-signer',
      title: 'Polymarket signer',
      description: 'Optional signer and funder pairing for mirror workflows.',
      writesEnv: ['POLYMARKET_PRIVATE_KEY', 'POLYMARKET_FUNDER'],
      decision: {
        defaultSelected: Boolean(blueprint.defaultPolymarketSigner),
      },
      fields: [
        withDefaultValue(
          createField('POLYMARKET_PRIVATE_KEY', 'Polymarket private key', 'private-key', {
            required: Boolean(blueprint.defaultPolymarketSigner),
            secret: true,
            description: 'Generate or import the Polymarket signer.',
          }),
          currentEnv,
        ),
        withDefaultValue(
          createField('POLYMARKET_FUNDER', 'Polymarket funder / proxy wallet', 'address', {
            required: Boolean(blueprint.defaultPolymarketSigner),
            description: 'Proxy or funder wallet paired with the signer.',
          }),
          currentEnv,
        ),
      ],
    });
  }

  if (blueprint.promptPolymarketApi) {
    steps.push({
      id: 'polymarket-api',
      title: 'Polymarket API credentials',
      description: 'Live CLOB execution credentials for live mirror mode.',
      writesEnv: ['POLYMARKET_API_KEY', 'POLYMARKET_API_SECRET', 'POLYMARKET_API_PASSPHRASE'],
      decision: {
        defaultSelected: Boolean(blueprint.defaultPolymarketApi),
      },
      fields: [
        withDefaultValue(createField('POLYMARKET_API_KEY', 'API key', 'secret', { required: true, secret: true }), currentEnv),
        withDefaultValue(createField('POLYMARKET_API_SECRET', 'API secret', 'secret', { required: true, secret: true }), currentEnv),
        withDefaultValue(createField('POLYMARKET_API_PASSPHRASE', 'API passphrase', 'secret', { required: true, secret: true }), currentEnv),
      ],
    });
  }

  if (blueprint.promptHosting) {
    steps.push({
      id: 'hosting',
      title: 'Hosting preferences',
      description: 'Capture optional daemon or gateway hosting preferences.',
      writesEnv: ['PANDORA_DAEMON_PROVIDER', 'PANDORA_DAEMON_API_BASE_URL', 'PANDORA_DAEMON_API_TOKEN'],
      decision: {
        defaultSelected: Boolean(blueprint.defaultHosting),
      },
      fields: [
        withDefaultValue(createField('PANDORA_DAEMON_PROVIDER', 'Hosting provider', 'string', { required: false }), currentEnv),
        withDefaultValue(createField('PANDORA_DAEMON_API_BASE_URL', 'Hosting API base URL', 'url', { required: false }), currentEnv),
        withDefaultValue(createField('PANDORA_DAEMON_API_TOKEN', 'Hosting API token', 'secret', { required: false, secret: true }), currentEnv),
      ],
    });
  }

  if (blueprint.promptSports) {
    steps.push({
      id: 'sports-odds',
      title: 'Sports / Odds provider',
      description: 'Optional sportsbook or odds provider configuration.',
      writesEnv: [
        'SPORTSBOOK_PROVIDER_MODE',
        'SPORTSBOOK_PRIMARY_BASE_URL',
        'SPORTSBOOK_BACKUP_BASE_URL',
        'SPORTSBOOK_PRIMARY_API_KEY',
        'SPORTSBOOK_PRIMARY_API_KEY_MODE',
        'SPORTSBOOK_PRIMARY_API_KEY_QUERY_PARAM',
      ],
      fields: [
        withDefaultValue(createField('SPORTSBOOK_PROVIDER_MODE', 'Provider mode', 'string', { required: false }), currentEnv),
        withDefaultValue(createField('SPORTSBOOK_PRIMARY_BASE_URL', 'Primary sportsbook base URL', 'url', { required: false }), currentEnv),
        withDefaultValue(createField('SPORTSBOOK_BACKUP_BASE_URL', 'Backup sportsbook base URL', 'url', { required: false }), currentEnv),
        withDefaultValue(createField('SPORTSBOOK_PRIMARY_API_KEY', 'Primary sportsbook API key', 'secret', { required: false, secret: true }), currentEnv),
        withDefaultValue(createField('SPORTSBOOK_PRIMARY_API_KEY_MODE', 'API key mode', 'string', { required: false }), currentEnv),
        withDefaultValue(createField('SPORTSBOOK_PRIMARY_API_KEY_QUERY_PARAM', 'API key query param', 'string', { required: false }), currentEnv),
      ],
    });
  }

  if (blueprint.promptResolutionSources) {
    steps.push({
      id: 'resolution-sources',
      title: 'Mirror resolution defaults',
      description: 'Optional env fallback for mirror resolution sources. Explicit --sources still wins.',
      writesEnv: ['PANDORA_RESOLUTION_SOURCES'],
      fields: [
        withDefaultValue(createField('PANDORA_RESOLUTION_SOURCES', 'Resolution source URLs', 'csv', {
          required: false,
          description: 'Comma-separated public source URLs. Optional, but needs at least two URLs when set.',
        }), currentEnv),
      ],
    });
  }

  steps.push({
    id: 'review',
    title: 'Review and validate',
    description: 'Run scoped validation, inspect the redacted change set, then write the env file only after confirmation.',
    writesEnv: [],
    fields: [],
  });

  return {
    goal,
    label: blueprint.label,
    description: blueprint.description,
    mode: 'plan',
    reviewRequired: true,
    goals: JOURNEY_GOALS.map((entry) => ({ ...entry })),
    steps,
    notes: [
      'Use `doctor --goal <goal>` to validate progress without writing.',
      'Interactive setup should follow this plan and stop at a redacted review-before-write gate.',
    ],
  };
}

module.exports = {
  JOURNEY_GOALS,
  buildGoalBlueprint,
  buildSetupPlan,
  normalizeGoal,
};
