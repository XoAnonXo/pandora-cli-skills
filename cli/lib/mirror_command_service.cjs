/**
 * Canonical usage string for `mirror go`.
 * Exported for CLI help rendering and integration tests.
 * @type {string}
 */
const MIRROR_GO_USAGE =
  'pandora [--output table|json] mirror go --polymarket-market-id <id>|--polymarket-slug <slug> [--liquidity-usdc <n>] [--fee-tier 500|3000|10000] [--max-imbalance <n>] [--arbiter <address>] [--category <n>] [--paper|--dry-run|--execute-live|--execute] [--auto-sync] [--sync-once] [--sync-interval-ms <ms>] [--hedge-ratio <n>] [--no-hedge] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <n>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>] [--usdc <address>] [--oracle <address>] [--factory <address>] [--sources <url...>] [--manifest-file <path>] [--trust-deploy] [--skip-gate] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--with-rules] [--include-similarity] [--min-close-lead-seconds <n>]';

/**
 * Canonical usage string for `mirror sync`.
 * Exported for CLI help rendering and integration tests.
 * @type {string}
 */
const MIRROR_SYNC_USAGE =
  'pandora [--output table|json] mirror sync run|once|start --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--paper|--dry-run|--execute-live|--execute] [--private-key <hex>] [--funder <address>] [--usdc <address>] [--trust-deploy] [--manifest-file <path>] [--skip-gate] [--daemon] [--stream|--no-stream] [--interval-ms <ms>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--hedge-ratio <n>] [--no-hedge] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <n>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--depth-slippage-bps <n>] [--min-time-to-close-sec <n>] [--iterations <n>] [--state-file <path>] [--kill-switch-file <path>] [--chain-id <id>] [--rpc-url <url>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]';

const INVALID_SUBCOMMAND_MESSAGE =
  'mirror requires subcommand: browse|plan|deploy|verify|lp-explain|hedge-calc|simulate|go|sync|status|close';

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
    simulate: () => require('./mirror_handlers/simulate.cjs'),
    go: () => require('./mirror_handlers/go.cjs'),
    sync: () => require('./mirror_handlers/sync.cjs'),
    status: () => require('./mirror_handlers/status.cjs'),
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
            'pandora [--output table|json] mirror browse|plan|deploy|verify|lp-explain|hedge-calc|simulate|go|sync|status|close ...',
          ),
        );
      } else {
        console.log(
          'Usage: pandora [--output table|json] mirror browse|plan|deploy|verify|lp-explain|hedge-calc|simulate|go|sync|status|close ...',
        );
        console.log('');
        console.log('Subcommands:');
        console.log(
          '  browse --min-yes-pct <n> --max-yes-pct <n> --min-volume-24h <n> [--closes-after <date>] [--closes-before <date>] [--question-contains <text>] [--limit <n>] [--chain-id <id>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
        );
        console.log(
          '  plan   --source polymarket --polymarket-market-id <id>|--polymarket-slug <slug> [--chain-id <id>] [--target-slippage-bps <n>] [--turnover-target <n>] [--depth-slippage-bps <n>] [--safety-multiplier <n>] [--min-liquidity-usdc <n>] [--max-liquidity-usdc <n>] [--with-rules] [--include-similarity] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]',
        );
        console.log(
          '  deploy --plan-file <path>|--polymarket-market-id <id>|--polymarket-slug <slug> --dry-run|--execute [--liquidity-usdc <n>] [--fee-tier 500|3000|10000] [--max-imbalance <n>] [--arbiter <address>] [--category <n>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--oracle <address>] [--factory <address>] [--usdc <address>] [--distribution-yes <parts>] [--distribution-no <parts>] [--sources <url...>] [--manifest-file <path>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--min-close-lead-seconds <n>]',
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
          '  simulate --liquidity-usdc <n> [--source-yes-pct <0-100>] [--target-yes-pct <0-100>] [--distribution-yes <parts>] [--distribution-no <parts>] [--fee-tier 500|3000|10000] [--volume-scenarios <csv>] [--hedge-ratio <n>] [--polymarket-yes-pct <0-100>]',
        );
        console.log(
          `  go     ${MIRROR_GO_USAGE.replace('pandora [--output table|json] mirror go ', '')}`,
        );
        console.log(
          `  sync ${MIRROR_SYNC_USAGE.replace('pandora [--output table|json] mirror sync ', '')}`,
        );
        console.log('         stop|status selector: --pid-file <path>|--strategy-hash <hash>');
        console.log('  status --state-file <path>|--strategy-hash <hash> [--with-live] [--trust-deploy]');
        console.log('  close  --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> --dry-run|--execute');
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
