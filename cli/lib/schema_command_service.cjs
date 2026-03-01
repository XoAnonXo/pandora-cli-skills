/**
 * Implements the `schema` command to output standard JSON interfaces for Agent ingestion.
 */

const COMMAND_HELP_SCHEMA_REF = '#/definitions/CommandHelpPayload';
const GENERIC_DATA_SCHEMA_REF = '#/definitions/GenericCommandData';

function commandDescriptor({
  summary,
  usage,
  emits,
  dataSchema = GENERIC_DATA_SCHEMA_REF,
  helpDataSchema = COMMAND_HELP_SCHEMA_REF,
  outputModes = ['table', 'json'],
}) {
  return {
    summary,
    usage,
    emits,
    outputModes,
    dataSchema,
    helpDataSchema,
  };
}

function buildCommandDescriptors() {
  return {
    help: commandDescriptor({
      summary: 'Display top-level usage and global flag metadata.',
      usage: 'pandora [--output table|json] help',
      emits: ['help'],
      dataSchema: '#/definitions/HelpPayload',
      helpDataSchema: null,
    }),
    quote: commandDescriptor({
      summary: 'Estimate a YES/NO quote from current market conditions.',
      usage:
        'pandora [--output table|json] quote [--indexer-url <url>] [--timeout-ms <ms>] --market-address <address> --side yes|no --amount-usdc <amount> [--yes-pct <0-100>] [--slippage-bps <0-10000>]',
      emits: ['quote', 'quote.help'],
      dataSchema: '#/definitions/QuotePayload',
    }),
    trade: commandDescriptor({
      summary: 'Execute or dry-run a buy flow with optional risk constraints.',
      usage:
        'pandora [--output table|json] trade [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --amount-usdc <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-shares-out-raw <uint>] [--max-amount-usdc <amount>] [--min-probability-pct <0-100>] [--max-probability-pct <0-100>] [--allow-unquoted-execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]',
      emits: ['trade', 'trade.help'],
      dataSchema: '#/definitions/TradePayload',
    }),
    watch: commandDescriptor({
      summary: 'Poll portfolio and/or market snapshots with optional alert thresholds.',
      usage:
        'pandora [--output table|json] watch [--wallet <address>] [--market-address <address>] [--side yes|no] [--amount-usdc <amount>] [--iterations <n>] [--interval-ms <ms>] [--chain-id <id>] [--include-events|--no-events] [--yes-pct <0-100>] [--alert-yes-below <0-100>] [--alert-yes-above <0-100>] [--alert-net-liquidity-below <amount>] [--alert-net-liquidity-above <amount>] [--fail-on-alert]',
      emits: ['watch', 'watch.help'],
      dataSchema: '#/definitions/WatchPayload',
    }),
    stream: commandDescriptor({
      summary: 'Emit NDJSON stream ticks for prices or events.',
      usage:
        'pandora stream prices|events [--indexer-url <url>] [--indexer-ws-url <url>] [--timeout-ms <ms>] [--interval-ms <ms>] [--market-address <address>] [--chain-id <id>] [--limit <n>]',
      emits: ['stream.help'],
      outputModes: ['table', 'json'],
      dataSchema: '#/definitions/StreamTickPayload',
      helpDataSchema: '#/definitions/CommandHelpPayload',
    }),
    'markets.list': commandDescriptor({
      summary: 'List Pandora markets with filters and pagination.',
      usage:
        'pandora [--output table|json] markets list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--expand] [--with-odds]',
      emits: ['markets.list', 'markets.list.help'],
      dataSchema: '#/definitions/PagedEntityPayload',
    }),
    'markets.get': commandDescriptor({
      summary: 'Get one or many markets by id.',
      usage: 'pandora [--output table|json] markets get [--id <id> ...] [--stdin]',
      emits: ['markets.get', 'markets.get.help'],
      dataSchema: '#/definitions/EntityCollectionPayload',
    }),
    'sports.books.list': commandDescriptor({
      summary: 'List sportsbook provider health and configured book priorities.',
      usage:
        'pandora [--output table|json] sports books list [--provider primary|backup|auto] [--book-priority <csv>] [--timeout-ms <ms>]',
      emits: ['sports.books.list', 'sports.help'],
      dataSchema: '#/definitions/SportsBooksPayload',
    }),
    'sports.events.list': commandDescriptor({
      summary: 'List normalized soccer events from sportsbook providers.',
      usage:
        'pandora [--output table|json] sports events list [--provider primary|backup|auto] [--competition <id|slug>] [--kickoff-after <iso>] [--kickoff-before <iso>] [--limit <n>] [--timeout-ms <ms>]',
      emits: ['sports.events.list', 'sports.help'],
      dataSchema: '#/definitions/SportsEventsPayload',
    }),
    'sports.events.live': commandDescriptor({
      summary: 'List currently-live soccer events from sportsbook providers.',
      usage:
        'pandora [--output table|json] sports events live [--provider primary|backup|auto] [--competition <id|slug>] [--limit <n>] [--timeout-ms <ms>]',
      emits: ['sports.events.live', 'sports.help'],
      dataSchema: '#/definitions/SportsEventsPayload',
    }),
    'sports.odds.snapshot': commandDescriptor({
      summary: 'Fetch event odds snapshot and consensus context.',
      usage:
        'pandora [--output table|json] sports odds snapshot --event-id <id> [--provider primary|backup|auto] [--book-priority <csv>] [--trim-percent <n>] [--min-tier1-books <n>] [--min-total-books <n>]',
      emits: ['sports.odds.snapshot', 'sports.help'],
      dataSchema: '#/definitions/SportsOddsPayload',
    }),
    'sports.consensus': commandDescriptor({
      summary: 'Compute majority-book trimmed-median consensus.',
      usage:
        'pandora [--output table|json] sports consensus --event-id <id>|--checks-json <json> [--provider primary|backup|auto] [--book-priority <csv>] [--trim-percent <n>] [--min-tier1-books <n>] [--min-total-books <n>]',
      emits: ['sports.consensus', 'sports.help'],
      dataSchema: '#/definitions/SportsConsensusPayload',
    }),
    'sports.create.plan': commandDescriptor({
      summary: 'Build conservative market creation plan from sportsbook consensus.',
      usage:
        'pandora [--output table|json] sports create plan --event-id <id> [--market-type amm|parimutuel] [--selection home|away|draw] [--creation-window-open-min <n>] [--creation-window-close-min <n>] [--book-priority <csv>]',
      emits: ['sports.create.plan', 'sports.help'],
      dataSchema: '#/definitions/SportsCreatePayload',
    }),
    'sports.create.run': commandDescriptor({
      summary: 'Execute or dry-run sports market creation.',
      usage:
        'pandora [--output table|json] sports create run --event-id <id> [--market-type amm|parimutuel] [--dry-run|--execute] [--liquidity-usdc <n>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>]',
      emits: ['sports.create.run', 'sports.help'],
      dataSchema: '#/definitions/SportsCreatePayload',
    }),
    'sports.sync': commandDescriptor({
      summary: 'Run sports sync once/run and runtime lifecycle actions.',
      usage:
        'pandora [--output table|json] sports sync once|run|start|stop|status [--event-id <id>] [--paper|--execute-live] [--risk-profile conservative|balanced|aggressive] [--state-file <path>]',
      emits: ['sports.sync.once', 'sports.sync.run', 'sports.sync.start', 'sports.sync.stop', 'sports.sync.status', 'sports.help'],
      dataSchema: '#/definitions/SportsSyncPayload',
    }),
    'sports.sync.once': commandDescriptor({
      summary: 'Run one bounded sports sync iteration.',
      usage:
        'pandora [--output table|json] sports sync once --event-id <id> [--paper|--execute-live] [--risk-profile conservative|balanced|aggressive] [--state-file <path>]',
      emits: ['sports.sync.once', 'sports.help'],
      dataSchema: '#/definitions/SportsSyncPayload',
    }),
    'sports.sync.run': commandDescriptor({
      summary: 'Run continuous sports sync loop.',
      usage:
        'pandora [--output table|json] sports sync run --event-id <id> [--paper|--execute-live] [--risk-profile conservative|balanced|aggressive] [--state-file <path>]',
      emits: ['sports.sync.run', 'sports.help'],
      dataSchema: '#/definitions/SportsSyncPayload',
    }),
    'sports.sync.start': commandDescriptor({
      summary: 'Start detached sports sync runtime.',
      usage:
        'pandora [--output table|json] sports sync start --event-id <id> [--paper|--execute-live] [--risk-profile conservative|balanced|aggressive] [--state-file <path>]',
      emits: ['sports.sync.start', 'sports.help'],
      dataSchema: '#/definitions/SportsSyncPayload',
    }),
    'sports.sync.stop': commandDescriptor({
      summary: 'Stop detached sports sync runtime.',
      usage:
        'pandora [--output table|json] sports sync stop [--state-file <path>]',
      emits: ['sports.sync.stop', 'sports.help'],
      dataSchema: '#/definitions/SportsSyncPayload',
    }),
    'sports.sync.status': commandDescriptor({
      summary: 'Inspect detached sports sync runtime status.',
      usage:
        'pandora [--output table|json] sports sync status [--state-file <path>]',
      emits: ['sports.sync.status', 'sports.help'],
      dataSchema: '#/definitions/SportsSyncPayload',
    }),
    'sports.resolve.plan': commandDescriptor({
      summary: 'Build manual-final resolution recommendation.',
      usage:
        'pandora [--output table|json] sports resolve plan --event-id <id>|--checks-json <json>|--checks-file <path> [--poll-address <address>] [--settle-delay-ms <ms>] [--consecutive-checks-required <n>] [--now <iso>|--now-ms <ms>] [--reason <text>]',
      emits: ['sports.resolve.plan', 'sports.help'],
      dataSchema: '#/definitions/SportsResolvePlanPayload',
    }),
    'mirror.plan': commandDescriptor({
      summary: 'Generate mirror sizing/distribution plan from Polymarket source.',
      usage:
        'pandora [--output table|json] mirror plan --source polymarket --polymarket-market-id <id>|--polymarket-slug <slug> [--chain-id <id>] [--target-slippage-bps <n>] [--turnover-target <n>] [--depth-slippage-bps <n>] [--safety-multiplier <n>] [--min-liquidity-usdc <n>] [--max-liquidity-usdc <n>] [--with-rules] [--include-similarity] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
      emits: ['mirror.plan', 'mirror.plan.help'],
      dataSchema: '#/definitions/MirrorPlanPayload',
    }),
    'mirror.deploy': commandDescriptor({
      summary: 'Deploy a mirror market from plan/selector in dry-run or execute mode.',
      usage:
        'pandora [--output table|json] mirror deploy --plan-file <path>|--polymarket-market-id <id>|--polymarket-slug <slug> --dry-run|--execute [--liquidity-usdc <n>] [--fee-tier 500|3000|10000] [--max-imbalance <n>] [--arbiter <address>] [--category <n>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--oracle <address>] [--factory <address>] [--usdc <address>] [--distribution-yes <parts>] [--distribution-no <parts>] [--sources <url...>] [--manifest-file <path>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--min-close-lead-seconds <n>]',
      emits: ['mirror.deploy', 'mirror.deploy.help'],
      dataSchema: '#/definitions/MirrorDeployPayload',
    }),
    'mirror.verify': commandDescriptor({
      summary: 'Verify a Pandora market against a Polymarket source pair.',
      usage:
        'pandora [--output table|json] mirror verify --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--trust-deploy] [--manifest-file <path>] [--include-similarity] [--with-rules] [--allow-rule-mismatch] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
      emits: ['mirror.verify', 'mirror.verify.help'],
      dataSchema: '#/definitions/MirrorVerifyPayload',
    }),
    'mirror.sync': commandDescriptor({
      summary: 'Run mirror sync loop or daemon lifecycle commands.',
      usage:
        'pandora [--output table|json] mirror sync run|once|start|stop|status --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [sync flags]',
      emits: ['mirror.sync', 'mirror.sync.help', 'mirror.sync.start', 'mirror.sync.stop', 'mirror.sync.status'],
      dataSchema: '#/definitions/MirrorSyncPayload',
    }),
    'mirror.hedge-calc': commandDescriptor({
      summary: 'Compute hedge direction/size from reserve imbalance and market odds.',
      usage:
        'pandora [--output table|json] mirror hedge-calc [--reserve-yes-usdc <n> --reserve-no-usdc <n>] [--excess-yes-usdc <n>] [--excess-no-usdc <n>] [--polymarket-yes-pct <0-100>] [--hedge-ratio <n>] [--hedge-cost-bps <n>] [--volume-scenarios <csv>] [--pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug>]',
      emits: ['mirror.hedge-calc', 'mirror.hedge-calc.help'],
      dataSchema: '#/definitions/MirrorHedgeCalcPayload',
    }),
    autopilot: commandDescriptor({
      summary: 'Run guarded polling/triggered trade automation.',
      usage:
        'pandora [--output table|json] autopilot run|once --market-address <address> --side yes|no --amount-usdc <amount> [--trigger-yes-below <0-100>] [--trigger-yes-above <0-100>] [--paper|--execute-live] [--interval-ms <ms>] [--cooldown-ms <ms>] [--max-amount-usdc <amount>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--state-file <path>] [--kill-switch-file <path>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]',
      emits: ['autopilot', 'autopilot.help'],
      dataSchema: '#/definitions/AutopilotPayload',
    }),
    leaderboard: commandDescriptor({
      summary: 'Compute wallet rankings from historical trade outcomes.',
      usage: 'pandora [--output table|json] leaderboard [--metric profit|volume|win-rate] [--chain-id <id>] [--limit <n>] [--min-trades <n>]',
      emits: ['leaderboard', 'leaderboard.help'],
      dataSchema: '#/definitions/LeaderboardPayload',
    }),
    schema: commandDescriptor({
      summary: 'Emit JSON envelope schema plus command descriptor map for agents.',
      usage: 'pandora [--output json] schema',
      emits: ['schema'],
      outputModes: ['json'],
      dataSchema: '#/definitions/SchemaCommandPayload',
      helpDataSchema: null,
    }),
    mcp: commandDescriptor({
      summary: 'Run Pandora MCP server over stdio transport.',
      usage: 'pandora mcp',
      emits: ['mcp.help'],
      outputModes: ['table'],
      dataSchema: '#/definitions/McpHelpPayload',
      helpDataSchema: null,
    }),
  };
}

function buildSchemaPayload() {
  const commandDescriptors = buildCommandDescriptors();
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'PandoraCliEnvelope',
    description:
      'The standard envelope format returned by the Pandora CLI in --output json mode. Exception: `pandora stream` emits NDJSON ticks directly instead of success/error envelopes.',
    type: 'object',
    oneOf: [
      { $ref: '#/definitions/SuccessEnvelope' },
      { $ref: '#/definitions/ErrorEnvelope' },
    ],
    commandDescriptorVersion: '1.0.0',
    descriptorScope: 'curated-core',
    commandDescriptors,
    definitions: {
      SuccessEnvelope: {
        type: 'object',
        required: ['ok', 'command', 'data'],
        properties: {
          ok: { type: 'boolean', const: true },
          command: { type: 'string', description: 'The CLI verb executed (e.g., "markets.list").' },
          data: {
            type: 'object',
            description: 'The primary payload.',
          },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ErrorEnvelope: {
        type: 'object',
        required: ['ok', 'error'],
        properties: {
          ok: { type: 'boolean', const: false },
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', description: 'A stable error code (e.g., "INVALID_USAGE").' },
              message: { type: 'string', description: 'Human-readable error explanation.' },
              details: { type: 'object', description: 'Contextual debugging metadata.' },
              recovery: { $ref: '#/definitions/ErrorRecoveryPayload' },
            },
          },
        },
      },
      ErrorRecoveryPayload: {
        type: 'object',
        required: ['action', 'command', 'retryable'],
        properties: {
          action: { type: 'string' },
          command: { type: 'string' },
          retryable: { type: 'boolean' },
        },
      },
      McpHelpPayload: {
        type: 'object',
        properties: {
          usage: { type: 'string' },
          notes: { type: 'array', items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      CommandHelpPayload: {
        type: 'object',
        required: ['usage'],
        properties: {
          usage: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      GenericCommandData: {
        type: 'object',
        description: 'Fallback schema for command payloads without a dedicated descriptor.',
      },
      SportsBooksPayload: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          requestedBooks: { type: ['array', 'null'], items: { type: 'string' } },
          books: { type: ['array', 'null'], items: { type: 'string' } },
          health: { type: 'object' },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SportsEventsPayload: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          mode: { type: 'string' },
          count: { type: 'integer' },
          events: { type: 'array', items: { type: 'object' } },
          marketType: { type: 'string' },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SportsOddsPayload: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          mode: { type: 'string' },
          event: { type: 'object' },
          books: { type: 'array', items: { type: 'object' } },
          bestOdds: { type: 'object' },
          source: { type: 'object' },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SportsConsensusPayload: {
        type: 'object',
        properties: {
          eventId: { type: ['string', 'null'] },
          method: { type: 'string' },
          source: { type: 'object' },
          diagnostics: { type: 'array', items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SportsCreatePayload: {
        type: 'object',
        properties: {
          event: { type: 'object' },
          source: { type: 'object' },
          timing: { type: 'object' },
          marketTemplate: { type: 'object' },
          mechanics: { type: 'object' },
          safety: { type: 'object' },
          deployment: { type: ['object', 'null'] },
          mode: { type: ['string', 'null'] },
          runtime: { type: ['object', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SportsSyncPayload: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          mode: { type: 'string' },
          status: { type: 'string' },
          found: { type: ['boolean', 'null'] },
          alive: { type: 'boolean' },
          pid: { type: ['number', 'null'] },
          pidFile: { type: ['string', 'null'] },
          strategyHash: { type: ['string', 'null'] },
          metadata: { type: ['object', 'null'] },
          cadence: { type: ['object', 'null'] },
          autoPause: { type: ['object', 'null'] },
          diagnostics: { type: 'array', items: { type: 'object' } },
          event: { type: ['object', 'null'] },
          source: { type: ['object', 'null'] },
          runtime: { type: ['object', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SportsResolvePlanPayload: {
        type: 'object',
        properties: {
          policy: { type: 'object' },
          safeToResolve: { type: 'boolean' },
          recommendedAnswer: { type: ['string', 'null'] },
          recommendedCommand: { type: ['string', 'null'] },
          checksAnalyzed: { type: 'integer' },
          stableWindowStartAt: { type: ['string', 'null'] },
          settleDelaySatisfied: { type: 'boolean' },
          checks: { type: 'array', items: { type: 'object' } },
          unsafeDiagnostics: { type: 'array', items: { type: 'object' } },
          diagnostics: { type: 'array', items: { type: 'object' } },
          timing: { type: ['object', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      HelpPayload: {
        allOf: [
          { $ref: '#/definitions/CommandHelpPayload' },
          {
            type: 'object',
            properties: {
              globalFlags: {
                type: 'object',
                additionalProperties: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          },
        ],
      },
      QuotePayload: {
        type: 'object',
        required: ['marketAddress', 'side', 'amountUsdc'],
        properties: {
          marketAddress: { type: 'string' },
          side: { enum: ['yes', 'no'] },
          amountUsdc: { type: 'number' },
          quote: { type: 'object' },
          odds: { type: 'object' },
          diagnostics: { type: 'array', items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      TradePayload: {
        type: 'object',
        required: ['mode', 'marketAddress', 'side', 'amountUsdc'],
        properties: {
          mode: { enum: ['dry-run', 'execute'] },
          status: { type: 'string' },
          marketAddress: { type: 'string' },
          side: { enum: ['yes', 'no'] },
          amountUsdc: { type: 'number' },
          quote: { type: 'object' },
          executionPlan: { type: 'object' },
          riskGuards: { type: 'object' },
          buyTxHash: { type: ['string', 'null'] },
          approveTxHash: { type: ['string', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      WatchPayload: {
        type: 'object',
        properties: {
          count: { type: 'integer' },
          alertCount: { type: 'integer' },
          snapshots: { type: 'array', items: { type: 'object' } },
          alerts: { type: 'array', items: { type: 'object' } },
          parameters: { type: 'object' },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      StreamTickPayload: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          ts: { type: 'string', format: 'date-time' },
          seq: { type: 'integer' },
          channel: { enum: ['prices', 'events'] },
          source: { type: 'object' },
          data: { type: 'object' },
        },
      },
      PagedEntityPayload: {
        type: 'object',
        properties: {
          count: { type: 'integer' },
          items: { type: 'array', items: { type: 'object' } },
          pageInfo: { type: ['object', 'null'] },
          pagination: { type: ['object', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      EntityCollectionPayload: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'object' } },
          count: { type: 'integer' },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MirrorPlanPayload: {
        type: 'object',
        properties: {
          sourceMarket: { type: 'object' },
          liquidityRecommendation: { type: 'object' },
          distributionHint: { type: 'object' },
          rules: { type: 'object' },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MirrorDeployPayload: {
        type: 'object',
        properties: {
          mode: { enum: ['dry-run', 'execute'] },
          pandora: { type: 'object' },
          sourceMarket: { type: 'object' },
          tx: { type: ['object', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MirrorVerifyPayload: {
        type: 'object',
        properties: {
          matchConfidence: { type: ['number', 'null'] },
          gateResult: { type: 'object' },
          similarity: { type: 'object' },
          ruleHashLeft: { type: ['string', 'null'] },
          ruleHashRight: { type: ['string', 'null'] },
          ruleDiffSummary: { type: 'object' },
          expiry: { type: 'object' },
          pandora: { type: 'object' },
          sourceMarket: { type: 'object' },
          diagnostics: { type: 'array', items: { type: 'string' } },
          strictGate: { type: 'object' },
          confidence: { type: ['number', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MirrorSyncPayload: {
        type: 'object',
        properties: {
          mode: { type: 'string' },
          executeLive: { type: 'boolean' },
          strategyHash: { type: ['string', 'null'] },
          stateFile: { type: ['string', 'null'] },
          killSwitchFile: { type: ['string', 'null'] },
          parameters: { type: 'object' },
          state: { type: ['object', 'null'] },
          actionCount: { type: 'integer' },
          actions: { type: 'array', items: { type: 'object' } },
          snapshots: { type: 'array', items: { type: 'object' } },
          webhookReports: { type: 'array', items: { type: 'object' } },
          iterationsRequested: { type: ['integer', 'null'] },
          iterationsCompleted: { type: 'integer' },
          stoppedReason: { type: ['string', 'null'] },
          pid: { type: ['integer', 'null'] },
          pidFile: { type: ['string', 'null'] },
          logFile: { type: ['string', 'null'] },
          alive: { type: ['boolean', 'null'] },
          status: { type: ['string', 'null'] },
          metadata: { type: ['object', 'null'] },
          diagnostics: { type: 'array', items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          stateSchemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MirrorHedgeCalcPayload: {
        type: 'object',
        properties: {
          inputs: { type: 'object' },
          metrics: { type: 'object' },
          scenarios: { type: 'array', items: { type: 'object' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AutopilotPayload: {
        type: 'object',
        properties: {
          mode: { enum: ['once', 'run'] },
          status: { type: 'string' },
          trigger: { type: ['object', 'null'] },
          action: { type: ['object', 'null'] },
          state: { type: ['object', 'null'] },
          diagnostics: { type: 'array', items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      LeaderboardPayload: {
        type: 'object',
        properties: {
          metric: { enum: ['profit', 'volume', 'win-rate'] },
          count: { type: 'integer' },
          items: { type: 'array', items: { type: 'object' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SchemaCommandPayload: {
        type: 'object',
        required: ['$schema', 'title', 'oneOf', 'definitions', 'commandDescriptors'],
        properties: {
          $schema: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          oneOf: { type: 'array', items: { type: 'object' } },
          commandDescriptorVersion: { type: 'string' },
          descriptorScope: { type: 'string' },
          commandDescriptors: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              required: ['summary', 'usage', 'emits', 'outputModes', 'dataSchema'],
              properties: {
                summary: { type: 'string' },
                usage: { type: 'string' },
                emits: { type: 'array', items: { type: 'string' } },
                outputModes: { type: 'array', items: { enum: ['table', 'json'] } },
                dataSchema: { type: 'string' },
                helpDataSchema: { type: ['string', 'null'] },
              },
            },
          },
          definitions: { type: 'object' },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  };
}

function createRunSchemaCommand(deps) {
  const { emitSuccess, CliError } = deps;

  if (typeof emitSuccess !== 'function') {
    throw new Error('createRunSchemaCommand requires emitSuccess');
  }

  function runSchemaCommand(args, context) {
    if (Array.isArray(args) && (args.includes('--help') || args.includes('-h'))) {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'schema.help', {
          usage: 'pandora --output json schema',
        });
      } else {
        // eslint-disable-next-line no-console
        console.log('Usage: pandora --output json schema');
        // eslint-disable-next-line no-console
        console.log('');
        // eslint-disable-next-line no-console
        console.log('Notes:');
        // eslint-disable-next-line no-console
        console.log('  - schema payload is available only in --output json mode.');
      }
      return;
    }

    if (context.outputMode !== 'json') {
      throw new CliError('INVALID_USAGE', 'The schema command is only supported in --output json mode.', {
        hints: ['Run `pandora --output json schema`'],
      });
    }

    if (Array.isArray(args) && args.length > 0) {
      throw new CliError('INVALID_ARGS', 'schema does not accept additional flags or positional arguments.', {
        hints: ['Run `pandora --output json schema` without extra arguments.'],
      });
    }

    emitSuccess(context.outputMode, 'schema', buildSchemaPayload());
  }

  return { runSchemaCommand };
}

module.exports = {
  createRunSchemaCommand,
};
