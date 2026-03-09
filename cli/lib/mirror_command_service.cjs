/**
 * Canonical usage string for `mirror go`.
 * Exported for CLI help rendering and integration tests.
 * @type {string}
 */
const MIRROR_GO_USAGE =
  'pandora [--output table|json] mirror go --polymarket-market-id <id>|--polymarket-slug <slug> [--liquidity-usdc <n>] [--fee-tier <500-50000>] [--max-imbalance <n>] [--arbiter <address>] [--category <id|name>] [--paper|--dry-run|--execute-live|--execute] [--auto-sync] [--sync-once] [--sync-interval-ms <ms>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--hedge-ratio <n>] [--rebalance-mode atomic|incremental] [--price-source on-chain|indexer] [--no-hedge] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--depth-slippage-bps <n>] [--min-time-to-close-sec <n>] [--strict-close-time-delta] [--chain-id <id>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--oracle <address>] [--factory <address>] [--distribution-yes <parts>] [--distribution-no <parts>] [--distribution-yes-pct <pct>] [--distribution-no-pct <pct>] [--sources <url...>] [--validation-ticket <ticket>] [--target-timestamp <unix|iso>] [--manifest-file <path>] [--trust-deploy] [--skip-gate] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--with-rules] [--include-similarity] [--min-close-lead-seconds <n>] [--dotenv-path <path>]';

/**
 * Canonical usage string for `mirror sync`.
 * Exported for CLI help rendering and integration tests.
 * @type {string}
 */
const MIRROR_SYNC_USAGE =
  'pandora [--output table|json] mirror sync once|run|start --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--paper|--dry-run|--execute-live|--execute] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--trust-deploy] [--manifest-file <path>] [--skip-gate] [--strict-close-time-delta] [--daemon] [--stream|--no-stream] [--interval-ms <ms>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--hedge-ratio <n>] [--rebalance-mode atomic|incremental] [--price-source on-chain|indexer] [--no-hedge] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--depth-slippage-bps <n>] [--min-time-to-close-sec <n>] [--iterations <n>] [--state-file <path>] [--kill-switch-file <path>] [--chain-id <id>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]';

const INVALID_SUBCOMMAND_MESSAGE =
  'mirror requires subcommand: browse|plan|deploy|verify|lp-explain|hedge-calc|calc|simulate|go|sync|dashboard|status|health|panic|drift|hedge-check|pnl|audit|replay|logs|close';

/**
 * Build the `mirror` subcommand dispatcher with lazy-loaded action handlers.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: 'table'|'json'}) => Promise<any>}
 */
function createRunMirrorCommand(deps) {
  const {
    CliError,
    emitSuccess,
    commandHelpPayload,
    parseIndexerSharedFlags,
  } = deps;

  const handlerLoaders = {
    browse: () => require('./mirror_handlers/browse.cjs'),
    plan: () => require('./mirror_handlers/plan.cjs'),
    deploy: () => require('./mirror_handlers/deploy.cjs'),
    verify: () => require('./mirror_handlers/verify.cjs'),
    'lp-explain': () => require('./mirror_handlers/lp_explain.cjs'),
    'hedge-calc': () => require('./mirror_handlers/hedge_calc.cjs'),
    calc: () => require('./mirror_handlers/calc.cjs'),
    simulate: () => require('./mirror_handlers/simulate.cjs'),
    go: () => require('./mirror_handlers/go.cjs'),
    sync: () => require('./mirror_handlers/sync.cjs'),
    dashboard: () => require('./mirror_handlers/dashboard.cjs'),
    status: () => require('./mirror_handlers/status.cjs'),
    health: () => require('./mirror_handlers/health.cjs'),
    panic: () => require('./mirror_handlers/panic.cjs'),
    drift: () => require('./mirror_handlers/drift.cjs'),
    'hedge-check': () => require('./mirror_handlers/hedge_check.cjs'),
    pnl: () => require('./mirror_handlers/pnl.cjs'),
    audit: () => require('./mirror_handlers/audit.cjs'),
    replay: () => require('./mirror_handlers/replay.cjs'),
    logs: () => require('./mirror_handlers/logs.cjs'),
    close: () => require('./mirror_handlers/close.cjs'),
  };
  const handlerCache = new Map();

  function getHandler(action) {
    if (handlerCache.has(action)) {
      return handlerCache.get(action);
    }

    const load = handlerLoaders[action];
    if (!load) {
      return null;
    }

    const loaded = load();
    const handler =
      typeof loaded === 'function'
        ? loaded
        : loaded && typeof loaded.handle === 'function'
          ? loaded.handle
          : null;

    if (!handler) {
      throw new Error(`Invalid mirror handler module for action: ${action}`);
    }

    handlerCache.set(action, handler);
    return handler;
  }

  return async function runMirrorCommand(args, context) {
    const action = args[0];
    const actionArgs = args.slice(1);

    if (!action || action === '--help' || action === '-h') {
      if (context.outputMode === 'json') {
        emitSuccess(
          context.outputMode,
          'mirror.help',
          commandHelpPayload(
            'pandora [--output table|json] mirror browse|plan|deploy|verify|lp-explain|hedge-calc|calc|simulate|go|sync|dashboard|status|health|panic|drift|hedge-check|pnl|audit|replay|logs|close ...',
            [
              'mirror dashboard is the canonical operator summary for active mirror markets; top-level `pandora dashboard` is a convenience alias.',
              'mirror go and mirror sync stay in paper/simulated mode unless --execute-live or --execute is supplied.',
              'Mirror sync simulates or executes Pandora rebalance and Polymarket hedge as separate legs; cross-venue settlement is not atomic.',
              'Use --rebalance-mode atomic with --price-source on-chain to size one Pandora rebalance against live reserves instead of incremental drift nudges.',
              'mirror sync snapshots and actions expose reserveSource, rebalanceSizingMode, and rebalanceTargetUsdc so operators can tell whether sizing used verify-payload reserves or an on-chain Pandora reserve refresh.',
              'mirror sync enforces the Pandora close-window guard via --min-time-to-close-sec and refuses startup with MIRROR_EXPIRY_TOO_CLOSE when Pandora trading time is too near.',
              '--strict-close-time-delta promotes CLOSE_TIME_DELTA from diagnostic-only to blocking; without it, Polymarket close-time mismatch stays informational while the Pandora close window remains the hard gate.',
              'Use --polymarket-rpc-url when Polygon preflight should differ from the main --rpc-url; comma-separated fallbacks are tried in order during live preflight.',
              'Polymarket outage fallback reuses cached snapshots under ~/.pandora/polymarket in paper mode; live mode blocks cached or stale sources through POLYMARKET_SOURCE_FRESH and expects websocket-backed prices for short-interval sports sync.',
              'mirror sync status reports daemon health metadata such as status, alive, checkedAt, pidFile, logFile, and metadata.pidAlive.',
              'mirror health is the machine-usable daemon/runtime status shell; mirror panic engages the global risk panic plus mirror stop-file and daemon-stop emergency flow.',
              'mirror drift and mirror hedge-check are dedicated read surfaces for operator actionability: drift isolates drift/cross-venue status, while hedge-check isolates current hedge target, gap, and trigger state.',
              'mirror logs tails the daemon log file resolved from a state file, strategy hash, or Pandora market selector when daemon metadata exists.',
              'mirror status always includes runtime/daemon health when strategy metadata is available, and --with-live adds crossVenue, actionability, pnlScenarios, verifyDiagnostics, and polymarketPosition.diagnostics while degrading partial visibility into diagnostics instead of hard failures; mirror close runs stop-daemons -> withdraw-lp -> claim-winnings, while Polymarket hedge settlement remains manual.',
              'mirror pnl is the dedicated cross-venue scenario P&L surface; mirror audit classifies persisted lastExecution plus recent runtime alerts, with optional live context via --with-live.',
              'mirror replay stays read-only and compares modeled rebalance/hedge sizing against persisted execution outcomes from the append-only audit log or lastExecution fallback.',
            ],
          ),
        );
      } else {
        console.log(
          'Usage: pandora [--output table|json] mirror browse|plan|deploy|verify|lp-explain|hedge-calc|calc|simulate|go|sync|dashboard|status|health|panic|drift|hedge-check|pnl|audit|replay|logs|close ...',
        );
        console.log('');
        console.log('Subcommands:');
        console.log(
          '  browse --min-yes-pct <n> --max-yes-pct <n> --min-volume-24h <n> [--closes-after <date>|--end-date-after <date|72h>] [--closes-before <date>|--end-date-before <date|72h>] [--question-contains <text>|--keyword <text>] [--slug <text>] [--category sports|crypto|politics|entertainment] [--exclude-sports] [--sort-by volume24h|liquidity|endDate] [--limit <n>] [--chain-id <id>] [--polymarket-tag-id <id>] [--polymarket-tag-ids <csv>] [--sport-tag-id <id>] [--sport-tag-ids <csv>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
        );
        console.log(
          '  plan   --source polymarket --polymarket-market-id <id>|--polymarket-slug <slug> [--chain-id <id>] [--target-slippage-bps <n>] [--turnover-target <n>] [--depth-slippage-bps <n>] [--safety-multiplier <n>] [--min-liquidity-usdc <n>] [--max-liquidity-usdc <n>] [--with-rules] [--include-similarity] [--min-close-lead-seconds <n>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
        );
        console.log(
          '  deploy --plan-file <path>|--polymarket-market-id <id>|--polymarket-slug <slug> --dry-run|--execute [--liquidity-usdc <n>] [--fee-tier <500-50000>] [--max-imbalance <n>] [--arbiter <address>] [--category <id|name>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--oracle <address>] [--factory <address>] [--usdc <address>] [--distribution-yes <parts>] [--distribution-no <parts>] [--sources <url...>] [--validation-ticket <ticket>] [--target-timestamp <unix|iso>] [--manifest-file <path>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--min-close-lead-seconds <n>]',
        );
        console.log(
          '  verify --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--trust-deploy] [--manifest-file <path>] [--include-similarity] [--with-rules] [--allow-rule-mismatch] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
        );
        console.log(
          '  lp-explain --liquidity-usdc <n> [--source-yes-pct <0-100>] [--distribution-yes <parts>] [--distribution-no <parts>]',
        );
        console.log(
          '  hedge-calc [--reserve-yes-usdc <n> --reserve-no-usdc <n>] [--excess-yes-usdc <n>] [--excess-no-usdc <n>] [--polymarket-yes-pct <0-100>] [--hedge-ratio <n>] [--hedge-cost-bps <n>] [--volume-scenarios <csv>] [--pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug>]',
        );
        console.log(
          '  calc   --target-pct <0-100> --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--trust-deploy] [--manifest-file <path>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
        );
        console.log(
          '  simulate --liquidity-usdc <n> [--source-yes-pct <0-100>] [--target-yes-pct <0-100>] [--distribution-yes <parts>] [--distribution-no <parts>] [--fee-tier <500-50000>] [--volume-scenarios <csv>] [--hedge-ratio <n>] [--polymarket-yes-pct <0-100>]',
        );
        console.log(
          `  go     ${MIRROR_GO_USAGE.replace('pandora [--output table|json] mirror go ', '')}`,
        );
        console.log(
          `  sync ${MIRROR_SYNC_USAGE.replace('pandora [--output table|json] mirror sync ', '')}`,
        );
        console.log('         stop selector: --pid-file <path>|--strategy-hash <hash>|--market-address <address>|--all');
        console.log('         status selector: --pid-file <path>|--strategy-hash <hash>');
        console.log(
          '  dashboard [--with-live] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
        );
        console.log(
          '  status --state-file <path>|--strategy-hash <hash> [--with-live] [--pandora-market-address <address>|--market-address <address>] [--polymarket-market-id <id>|--polymarket-slug <slug>] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
        );
        console.log(
          '  health --state-file <path>|--strategy-hash <hash>|--pid-file <path>|--market-address <address> [--polymarket-market-id <id>|--polymarket-slug <slug>] [--stale-after-ms <ms>]',
        );
        console.log(
          '  panic  --pid-file <path>|--strategy-hash <hash>|--market-address <address>|--all [--risk-file <path>] [--reason <text>] [--actor <id>] [--clear]',
        );
        console.log(
          '  drift  --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
        );
        console.log(
          '  hedge-check --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
        );
        console.log(
          '  pnl    --state-file <path>|--strategy-hash <hash> [--pandora-market-address <address>|--market-address <address>] [--polymarket-market-id <id>|--polymarket-slug <slug>] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
        );
        console.log(
          '  audit  --state-file <path>|--strategy-hash <hash> [--with-live] [--pandora-market-address <address>|--market-address <address>] [--polymarket-market-id <id>|--polymarket-slug <slug>] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
        );
        console.log(
          '  replay --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--limit <n>]',
        );
        console.log(
          '  logs   --state-file <path>|--strategy-hash <hash>|--pandora-market-address <address>|--market-address <address> [--polymarket-market-id <id>|--polymarket-slug <slug>] [--lines <n>]',
        );
        console.log(
          '  close  --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug>|--all --dry-run|--execute [--wallet <address>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--indexer-url <url>] [--timeout-ms <ms>]',
        );
        console.log('');
        console.log('Notes:');
        console.log('  mirror dashboard is the canonical operator summary for active mirror markets; `pandora dashboard` is a top-level alias.');
        console.log('  mirror go and mirror sync stay in paper/simulated mode unless --execute-live or --execute is supplied.');
        console.log('  Mirror sync runs Pandora rebalance and Polymarket hedge as separate legs; cross-venue settlement is not atomic.');
        console.log('  mirror sync snapshots and actions expose reserveSource, rebalanceSizingMode, and rebalanceTargetUsdc so reserve provenance is explicit.');
        console.log('  mirror sync enforces the Pandora close-window guard via --min-time-to-close-sec and refuses startup with MIRROR_EXPIRY_TOO_CLOSE when Pandora trading time is too near.');
        console.log('  --strict-close-time-delta makes CLOSE_TIME_DELTA blocking; otherwise close-time mismatch remains diagnostic-only.');
        console.log('  Use --polymarket-rpc-url when Polygon preflight should differ from the main --rpc-url; comma-separated fallbacks are tried in order.');
        console.log('  Polymarket outage fallback reuses cached snapshots under ~/.pandora/polymarket in paper mode; live mode blocks cached or stale sources and expects websocket-backed prices for short-interval sports sync.');
        console.log('  mirror sync status reports daemon health metadata such as status, alive, checkedAt, pidFile, logFile, and metadata.pidAlive.');
        console.log('  mirror health is the machine-usable daemon/runtime status shell; mirror panic engages the global risk panic plus mirror stop-file and daemon-stop emergency flow.');
        console.log('  mirror drift and mirror hedge-check are dedicated read surfaces for drift and hedge-gap actionability without the full mirror status payload.');
        console.log('  mirror logs returns tailed daemon log lines from a state file, strategy hash, or Pandora market selector when daemon metadata can identify the log file.');
        console.log('  mirror status includes runtime/daemon health when strategy metadata is available; --with-live adds crossVenue, actionability, pnlScenarios, verifyDiagnostics, and polymarketPosition.diagnostics.');
        console.log('  mirror pnl is the dedicated cross-venue scenario P&L view; mirror audit classifies persisted lastExecution plus recent runtime alerts and can attach live context with --with-live.');
        console.log('  mirror replay stays read-only and compares modeled rebalance/hedge sizing against persisted execution outcomes from the append-only audit log or lastExecution fallback.');
        console.log('  mirror close runs stop-daemons -> withdraw-lp -> claim-winnings; Polymarket hedge settlement remains manual.');
      }
      return;
    }

    const handler = getHandler(action);
    if (!handler) {
      throw new CliError('INVALID_ARGS', INVALID_SUBCOMMAND_MESSAGE);
    }
    const shared = parseIndexerSharedFlags(actionArgs);

    return handler({
      actionArgs: shared.rest,
      shared,
      context,
      deps,
      mirrorGoUsage: MIRROR_GO_USAGE,
      mirrorSyncUsage: MIRROR_SYNC_USAGE,
    });
  };
}

/** Public mirror command service exports. */
module.exports = {
  MIRROR_GO_USAGE,
  MIRROR_SYNC_USAGE,
  createRunMirrorCommand,
};
