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
    lp: commandDescriptor({
      summary: 'Run LP add/remove/positions workflows including batch remove.',
      usage:
        'pandora [--output table|json] lp add|remove|positions [--market-address <address>] [--wallet <address>] [--amount-usdc <n>] [--lp-tokens <n>|--all|--all-markets] [--dry-run|--execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>] [--deadline-seconds <n>] [--indexer-url <url>] [--timeout-ms <ms>]',
      emits: ['lp', 'lp.help'],
      dataSchema: '#/definitions/LpPayload',
    }),
    resolve: commandDescriptor({
      summary: 'Dry-run or execute poll resolution.',
      usage:
        'pandora [--output table|json] resolve [--dotenv-path <path>] [--skip-dotenv] --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>]',
      emits: ['resolve', 'resolve.help'],
      dataSchema: '#/definitions/ResolvePayload',
    }),
    claim: commandDescriptor({
      summary: 'Dry-run or execute winnings redemption for one market or all discovered markets.',
      usage:
        'pandora [--output table|json] claim [--dotenv-path <path>] [--skip-dotenv] --market-address <address>|--all [--wallet <address>] --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--indexer-url <url>] [--timeout-ms <ms>]',
      emits: ['claim', 'claim.help'],
      dataSchema: '#/definitions/ClaimPayload',
    }),
    watch: commandDescriptor({
      summary: 'Poll portfolio and/or market snapshots with optional alert thresholds.',
      usage:
        'pandora [--output table|json] watch [--wallet <address>] [--market-address <address>] [--side yes|no] [--amount-usdc <amount>] [--iterations <n>] [--interval-ms <ms>] [--chain-id <id>] [--include-events|--no-events] [--yes-pct <0-100>] [--alert-yes-below <0-100>] [--alert-yes-above <0-100>] [--alert-net-liquidity-below <amount>] [--alert-net-liquidity-above <amount>] [--fail-on-alert]',
      emits: ['watch', 'watch.help'],
      dataSchema: '#/definitions/WatchPayload',
    }),
    portfolio: commandDescriptor({
      summary: 'Build portfolio snapshot across positions/LP/events.',
      usage:
        'pandora [--output table|json] portfolio --wallet <address> [--chain-id <id>] [--limit <n>] [--include-events|--no-events] [--with-lp] [--rpc-url <url>]',
      emits: ['portfolio', 'portfolio.help'],
      dataSchema: '#/definitions/PortfolioPayload',
    }),
    export: commandDescriptor({
      summary: 'Export deterministic history rows as csv/json.',
      usage:
        'pandora [--output table|json] export --wallet <address> --format csv|json [--chain-id <id>] [--year <yyyy>] [--from <unix>] [--to <unix>] [--out <path>]',
      emits: ['export', 'export.help'],
      dataSchema: '#/definitions/ExportPayload',
    }),
    lifecycle: commandDescriptor({
      summary: 'Manage file-based lifecycle state for detect->resolve workflow.',
      usage:
        'pandora [--output table|json] lifecycle start --config <file> | status --id <id> | resolve --id <id> --confirm',
      emits: ['lifecycle.help', 'lifecycle.start', 'lifecycle.status', 'lifecycle.resolve'],
      dataSchema: '#/definitions/LifecyclePayload',
    }),
    'odds.record': commandDescriptor({
      summary: 'Record venue odds snapshots into local history storage.',
      usage:
        'pandora [--output table|json] odds record --competition <id> --interval <sec> [--max-samples <n>] [--event-id <id>] [--venues pandora_amm,polymarket] [--indexer-url <url>] [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>]',
      emits: ['odds.record', 'odds.help'],
      dataSchema: '#/definitions/OddsRecordPayload',
    }),
    'odds.history': commandDescriptor({
      summary: 'Read stored venue odds history for one event.',
      usage: 'pandora [--output table|json] odds history --event-id <id> --output csv|json [--limit <n>]',
      emits: ['odds.history', 'odds.help'],
      dataSchema: '#/definitions/OddsHistoryPayload',
    }),
    'arb.scan': commandDescriptor({
      summary: 'Scan selected market ids for net-profitable cross-market spreads.',
      usage:
        'pandora arb scan --markets <csv> --output ndjson|json [--min-net-spread-pct <n>] [--fee-pct-per-leg <n>] [--slippage-pct-per-leg <n>] [--amount-usdc <n>] [--combinatorial] [--max-bundle-size <n>] [--interval-ms <ms>] [--iterations <n>] [--indexer-url <url>] [--timeout-ms <ms>]',
      emits: ['arb.help', 'arb.scan'],
      outputModes: ['table', 'json'],
      dataSchema: '#/definitions/ArbScanPayload',
    }),
    'simulate.mc': commandDescriptor({
      summary: 'Run desk-grade Monte Carlo simulation with CI and VaR/ES risk outputs.',
      usage:
        'pandora [--output table|json] simulate mc [--trials <n>] [--horizon <n>] [--start-yes-pct <0-100>] [--entry-yes-pct <0-100>] [--position yes|no] [--stake-usdc <n>] [--drift-bps <n>] [--vol-bps <n>] [--confidence <50-100>] [--var-level <50-100>] [--seed <n>] [--antithetic] [--stratified]',
      emits: ['simulate.mc', 'simulate.help', 'simulate.mc.help'],
      dataSchema: '#/definitions/SimulateMcPayload',
    }),
    'simulate.particle-filter': commandDescriptor({
      summary: 'Run sequential Monte Carlo filtering with ESS diagnostics and credible intervals.',
      usage:
        'pandora [--output table|json] simulate particle-filter (--observations-json <json>|--input <path>|--stdin) [--particles <n>] [--process-noise <n>] [--observation-noise <n>] [--drift-bps <n>] [--initial-yes-pct <0-100>] [--initial-spread <n>] [--resample-threshold <0-1>] [--resample-method systematic|multinomial] [--credible-interval <50-100>] [--seed <n>]',
      emits: ['simulate.particle-filter', 'simulate.help', 'simulate.particle-filter.help'],
      dataSchema: '#/definitions/SimulateParticleFilterPayload',
    }),
    'simulate.agents': commandDescriptor({
      summary: 'Run deterministic agent-based market simulation with ABM diagnostics.',
      usage:
        'pandora [--output table|json] simulate agents [--n-informed <n>] [--n-noise <n>] [--n-mm <n>] [--n-steps <n>] [--seed <int>]',
      emits: ['simulate.agents', 'simulate.help'],
      dataSchema: '#/definitions/SimulateAgentsPayload',
    }),
    'model.score.brier': commandDescriptor({
      summary: 'Score forecast calibration via Brier metrics.',
      usage:
        'pandora [--output table|json] model score brier [--source <name>] [--market-address <address>] [--competition <id>] [--event-id <id>] [--model-id <id>] [--group-by source|market|competition|model|none] [--window-days <n>] [--bucket-count <n>] [--forecast-file <path>] [--include-records] [--include-unresolved] [--limit <n>]',
      emits: ['model.score.brier', 'model.help'],
      dataSchema: '#/definitions/ModelScoreBrierPayload',
    }),
    'model.calibrate': commandDescriptor({
      summary: 'Calibrate jump-diffusion parameters from historical price/return inputs.',
      usage:
        'pandora [--output table|json] model calibrate (--prices <csv>|--returns <csv>) [--dt <n>] [--jump-threshold-sigma <n>] [--min-jump-count <n>] [--model-id <id>] [--save-model <path>]',
      emits: ['model.calibrate', 'model.help'],
      dataSchema: '#/definitions/ModelCalibratePayload',
    }),
    'model.correlation': commandDescriptor({
      summary: 'Estimate dependency structure and tail dependence via copula methods.',
      usage:
        'pandora [--output table|json] model correlation --series <id:v1,v2,...> --series <id:v1,v2,...> [--copula t|gaussian|clayton|gumbel] [--compare <csv>] [--tail-alpha <n>] [--df <n>] [--joint-threshold-z <n>] [--scenario-shocks <csv>] [--model-id <id>] [--save-model <path>]',
      emits: ['model.correlation', 'model.help'],
      dataSchema: '#/definitions/ModelCorrelationPayload',
    }),
    'model.diagnose': commandDescriptor({
      summary: 'Diagnose market/model informativeness with machine-readable gating flags.',
      usage:
        'pandora [--output table|json] model diagnose [--calibration-rmse <n>] [--drift-bps <n>] [--spread-bps <n>] [--depth-coverage <0..1>] [--informed-flow-ratio <0..1>] [--noise-ratio <0..1>] [--anomaly-rate <0..1>] [--manipulation-alerts <n>] [--tail-dependence <0..1>]',
      emits: ['model.diagnose', 'model.help'],
      dataSchema: '#/definitions/ModelDiagnosePayload',
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
    'mirror.browse': commandDescriptor({
      summary: 'Browse Polymarket mirror candidates with optional sports tag filters.',
      usage:
        'pandora [--output table|json] mirror browse [--min-yes-pct <n>] [--max-yes-pct <n>] [--min-volume-24h <n>] [--closes-after <date>|--end-date-after <date|72h>] [--closes-before <date>|--end-date-before <date|72h>] [--question-contains <text>|--keyword <text>] [--slug <text>] [--category sports|crypto|politics|entertainment] [--exclude-sports] [--sort-by volume24h|liquidity|endDate] [--limit <n>] [--chain-id <id>] [--polymarket-tag-id <id>] [--polymarket-tag-ids <csv>] [--sport-tag-id <id>] [--sport-tag-ids <csv>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
      emits: ['mirror.browse', 'mirror.browse.help'],
      dataSchema: '#/definitions/MirrorBrowsePayload',
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
        'pandora [--output table|json] mirror deploy --plan-file <path>|--polymarket-market-id <id>|--polymarket-slug <slug> --dry-run|--execute [--liquidity-usdc <n>] [--fee-tier <500-50000>] [--max-imbalance <n>] [--arbiter <address>] [--category <n>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--oracle <address>] [--factory <address>] [--usdc <address>] [--distribution-yes <parts>] [--distribution-no <parts>] [--sources <url...>] [--manifest-file <path>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--min-close-lead-seconds <n>]',
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
    'mirror.lp-explain': commandDescriptor({
      summary: 'Explain complete-set LP mechanics and inventory split.',
      usage:
        'pandora [--output table|json] mirror lp-explain --liquidity-usdc <n> [--source-yes-pct <0-100>] [--distribution-yes <parts>] [--distribution-no <parts>]',
      emits: ['mirror.lp-explain', 'mirror.lp-explain.help'],
      dataSchema: '#/definitions/GenericCommandData',
    }),
    'mirror.simulate': commandDescriptor({
      summary: 'Run mirror LP economics simulation.',
      usage:
        'pandora [--output table|json] mirror simulate --liquidity-usdc <n> [--source-yes-pct <0-100>] [--target-yes-pct <0-100>] [--distribution-yes <parts>] [--distribution-no <parts>] [--fee-tier <500-50000>] [--volume-scenarios <csv>] [--hedge-ratio <n>] [--polymarket-yes-pct <0-100>]',
      emits: ['mirror.simulate', 'mirror.simulate.help'],
      dataSchema: '#/definitions/GenericCommandData',
    }),
    'mirror.go': commandDescriptor({
      summary: 'Run mirror deploy + verify + optional sync workflow.',
      usage:
        'pandora [--output table|json] mirror go --polymarket-market-id <id>|--polymarket-slug <slug> [--liquidity-usdc <n>] [--fee-tier <500-50000>] [--max-imbalance <n>] [--arbiter <address>] [--category <n>] [--paper|--dry-run|--execute-live|--execute] [--auto-sync] [--sync-once] [--sync-interval-ms <ms>] [--hedge-ratio <n>] [--no-hedge] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <n>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--chain-id <id>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>] [--funder <address>] [--usdc <address>] [--oracle <address>] [--factory <address>] [--sources <url...>] [--manifest-file <path>] [--trust-deploy] [--skip-gate] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--with-rules] [--include-similarity] [--min-close-lead-seconds <n>]',
      emits: ['mirror.go', 'mirror.go.help'],
      dataSchema: '#/definitions/GenericCommandData',
    }),
    'mirror.sync': commandDescriptor({
      summary: 'Run mirror sync loop or daemon lifecycle commands.',
      usage:
        'pandora [--output table|json] mirror sync run|once|start --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [sync flags]; stop selector: --pid-file <path>|--strategy-hash <hash>|--market-address <address>|--all; status selector: --pid-file <path>|--strategy-hash <hash>',
      emits: ['mirror.sync', 'mirror.sync.help', 'mirror.sync.start', 'mirror.sync.stop', 'mirror.sync.status'],
      dataSchema: '#/definitions/MirrorSyncPayload',
    }),
    'mirror.status': commandDescriptor({
      summary: 'Inspect persisted mirror strategy state.',
      usage:
        'pandora [--output table|json] mirror status --state-file <path>|--strategy-hash <hash> [--with-live] [--trust-deploy] [--indexer-url <url>] [--timeout-ms <ms>]',
      emits: ['mirror.status', 'mirror.status.help'],
      dataSchema: '#/definitions/GenericCommandData',
    }),
    'mirror.close': commandDescriptor({
      summary: 'Build or execute closeout workflow for one mirror pair or all.',
      usage:
        'pandora [--output table|json] mirror close --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug>|--all --dry-run|--execute [--wallet <address>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--indexer-url <url>] [--timeout-ms <ms>]',
      emits: ['mirror.close', 'mirror.close.help'],
      dataSchema: '#/definitions/MirrorClosePayload',
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
    'risk.show': commandDescriptor({
      summary: 'Inspect persisted risk guardrail + panic state.',
      usage: 'pandora [--output table|json] risk show [--risk-file <path>]',
      emits: ['risk.show', 'risk.show.help'],
      dataSchema: '#/definitions/RiskPayload',
    }),
    'risk.panic': commandDescriptor({
      summary: 'Engage or clear risk panic lock for all live writes.',
      usage:
        'pandora [--output table|json] risk panic [--risk-file <path>] [--reason <text> --actor <id>] | [--clear --actor <id>]',
      emits: ['risk.panic', 'risk.panic.help'],
      dataSchema: '#/definitions/RiskPayload',
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
      emits: ['schema', 'schema.help'],
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
          marketType: { type: ['string', 'null'] },
          buySignature: { type: ['string', 'null'] },
          ammDeadlineEpoch: { type: ['string', 'null'] },
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
      LpPayload: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          mode: { type: 'string' },
          runtime: { type: ['object', 'null'] },
          status: { type: ['string', 'null'] },
          marketAddress: { type: ['string', 'null'] },
          wallet: { type: ['string', 'null'] },
          count: { type: ['integer', 'null'] },
          successCount: { type: ['integer', 'null'] },
          failureCount: { type: ['integer', 'null'] },
          txPlan: { type: ['object', 'null'] },
          preflight: { type: ['object', 'null'] },
          tx: { type: ['object', 'null'] },
          items: { type: ['array', 'null'], items: { type: 'object' } },
          diagnostics: { type: ['array', 'null'], items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ResolvePayload: {
        type: 'object',
        properties: {
          mode: { enum: ['dry-run', 'execute'] },
          status: { type: 'string' },
          runtime: { type: ['object', 'null'] },
          pollAddress: { type: ['string', 'null'] },
          answer: { type: ['string', 'null'] },
          reason: { type: ['string', 'null'] },
          txPlan: { type: ['object', 'null'] },
          precheck: { type: ['object', 'null'] },
          tx: { type: ['object', 'null'] },
          diagnostics: { type: ['array', 'null'], items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ClaimPayload: {
        type: 'object',
        properties: {
          mode: { type: 'string' },
          runtime: { type: ['object', 'null'] },
          status: { type: ['string', 'null'] },
          action: { type: ['string', 'null'] },
          marketAddress: { type: ['string', 'null'] },
          wallet: { type: ['string', 'null'] },
          pollAddress: { type: ['string', 'null'] },
          claimable: { type: ['boolean', 'null'] },
          resolution: { type: ['object', 'null'] },
          txPlan: { type: ['object', 'null'] },
          preflight: { type: ['object', 'null'] },
          tx: { type: ['object', 'null'] },
          count: { type: ['integer', 'null'] },
          successCount: { type: ['integer', 'null'] },
          failureCount: { type: ['integer', 'null'] },
          items: { type: ['array', 'null'], items: { type: 'object' } },
          diagnostics: { type: ['array', 'null'], items: { type: 'string' } },
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
      PortfolioPayload: {
        type: 'object',
        properties: {
          indexerUrl: { type: 'string' },
          wallet: { type: 'string' },
          chainId: { type: ['integer', 'null'] },
          limit: { type: ['integer', 'null'] },
          withLp: { type: 'boolean' },
          summary: { type: 'object' },
          positions: { type: 'array', items: { type: 'object' } },
          lpPositions: { type: 'array', items: { type: 'object' } },
          events: { type: ['array', 'null'], items: { type: 'object' } },
          diagnostics: { type: 'array', items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ExportPayload: {
        type: 'object',
        properties: {
          format: { enum: ['csv', 'json'] },
          wallet: { type: 'string' },
          chainId: { type: ['integer', 'null'] },
          count: { type: 'integer' },
          filters: { type: 'object' },
          columns: { type: 'array', items: { type: 'string' } },
          outPath: { type: ['string', 'null'] },
          rows: { type: 'array', items: { type: 'object' } },
          content: { type: ['string', 'array'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      LifecyclePayload: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          phase: { type: 'string' },
          phases: { type: 'array', items: { type: 'string' } },
          history: { type: 'array', items: { type: 'object' } },
          changed: { type: ['boolean', 'null'] },
          createdAt: { type: ['string', 'null'], format: 'date-time' },
          updatedAt: { type: ['string', 'null'], format: 'date-time' },
          resolvedAt: { type: ['string', 'null'], format: 'date-time' },
          lifecycleDir: { type: ['string', 'null'] },
          filePath: { type: ['string', 'null'] },
          configPath: { type: ['string', 'null'] },
          configDigest: { type: ['string', 'null'] },
          config: { type: ['object', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      OddsRecordPayload: {
        type: 'object',
        properties: {
          action: { const: 'record' },
          competition: { type: 'string' },
          eventId: { type: ['string', 'null'] },
          intervalSec: { type: 'number' },
          maxSamples: { type: 'integer' },
          venues: { type: 'array', items: { type: 'string' } },
          backend: { type: 'string' },
          storage: { type: 'object' },
          insertedTotal: { type: 'integer' },
          samples: { type: 'array', items: { type: 'object' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      OddsHistoryPayload: {
        type: 'object',
        properties: {
          action: { const: 'history' },
          eventId: { type: 'string' },
          output: { enum: ['json', 'csv'] },
          backend: { type: 'string' },
          storage: { type: 'object' },
          count: { type: 'integer' },
          items: { type: 'array', items: { type: 'object' } },
          csv: { type: ['string', 'null'] },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ArbScanPayload: {
        type: 'object',
        properties: {
          action: { const: 'scan' },
          indexerUrl: { type: 'string' },
          iterationsCompleted: { type: 'integer' },
          requestedIterations: { type: ['integer', 'null'] },
          intervalMs: { type: 'integer' },
          filters: { type: 'object' },
          opportunities: { type: 'array', items: { type: 'object' } },
          diagnostics: { type: 'array', items: { type: 'string' } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SimulateMcPayload: {
        type: 'object',
        properties: {
          inputs: { type: 'object' },
          summary: { type: 'object' },
          distribution: { type: 'object' },
          diagnostics: { type: 'array', items: { type: ['string', 'object'] } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SimulateParticleFilterPayload: {
        type: 'object',
        properties: {
          inputs: { type: 'object' },
          summary: { type: 'object' },
          trajectory: { type: 'array', items: { type: 'object' } },
          diagnostics: { type: 'array', items: { type: ['string', 'object'] } },
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SimulateAgentsPayload: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          parameters: { type: 'object' },
          convergenceError: { type: 'number' },
          spreadTrajectory: { type: 'array', items: { type: 'object' } },
          volume: { type: 'object' },
          pnlByAgentType: { type: 'object' },
          finalState: { type: 'object' },
          runtimeBounds: { type: 'object' },
        },
      },
      ModelScoreBrierPayload: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          action: { const: 'score.brier' },
          filters: { type: 'object' },
          ledger: { type: 'object' },
          report: { type: 'object' },
          diagnostics: { type: 'array', items: { type: ['string', 'object'] } },
        },
      },
      ModelCalibratePayload: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          action: { const: 'calibrate' },
          model: { type: 'object' },
          diagnostics: { type: 'object' },
          persistence: { type: 'object' },
        },
      },
      ModelCorrelationPayload: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          action: { const: 'correlation' },
          copula: { type: 'object' },
          metrics: { type: 'object' },
          stress: { type: 'object' },
          comparisons: { type: 'array', items: { type: 'object' } },
          diagnostics: { type: 'object' },
          model: { type: 'object' },
          persistence: { type: 'object' },
        },
      },
      ModelDiagnosePayload: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'string' },
          generatedAt: { type: 'string', format: 'date-time' },
          inputs: { type: 'object' },
          components: { type: 'object' },
          aggregate: { type: 'object' },
          recommendations: { type: 'object' },
          flags: { type: 'object' },
          diagnostics: { type: 'array', items: { type: ['string', 'object'] } },
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
      MirrorBrowsePayload: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          gammaApiError: { type: ['string', 'null'] },
          filters: { type: 'object' },
          count: { type: 'integer' },
          items: { type: 'array', items: { type: 'object' } },
          diagnostics: { type: 'array', items: { type: 'string' } },
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
      MirrorClosePayload: {
        type: 'object',
        properties: {
          mode: { enum: ['dry-run', 'execute'] },
          target: { type: 'object' },
          pandoraMarketAddress: { type: ['string', 'null'] },
          polymarketMarketId: { type: ['string', 'null'] },
          polymarketSlug: { type: ['string', 'null'] },
          steps: { type: 'array', items: { type: 'object' } },
          summary: { type: 'object' },
          diagnostics: { type: 'array', items: { type: 'string' } },
          schemaVersion: { type: 'string' },
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
      RiskPayload: {
        type: 'object',
        properties: {
          action: { type: ['string', 'null'] },
          changed: { type: ['boolean', 'null'] },
          riskFile: { type: 'string' },
          panic: { type: 'object' },
          guardrails: { type: 'object' },
          counters: { type: 'object' },
          stopFiles: { type: 'array', items: { type: 'string' } },
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
