# Pandora CLI Command Reference

This is the human-oriented scoped command and flag reference. For machine-authoritative command contracts, prefer:

- `pandora --output json capabilities`
- `pandora --output json schema`
- `pandora <family> ... --help` for the freshest family-specific usage surface

## Global conventions
- Global output mode: `--output table|json` (default `table`)
- Most commands support `--output table|json`
- JSON-only commands:
  - `pandora --output json capabilities`
  - `pandora --output json schema`
- Dedicated stdio server mode:
  - `pandora mcp`
- Legacy passthrough wrappers:
  - `launch`
  - `clone-bet`
- Agent schema command: `pandora --output json schema`
- Agent capability digest: `pandora --output json capabilities`
- MCP server mode: `pandora mcp`
- Fork runtime flags for transaction families:
  - `--fork`
  - `--fork-rpc-url <url>`
  - `--fork-chain-id <id>`
- JSON errors can include additive recovery hints:
  - `error.recovery = { action, command, retryable }`

## High-value command routing reference

This section is intentionally condensed for retrieval. For the exhaustive live contract:

- use `pandora --output json capabilities` for compact discovery
- use `pandora --output json schema` for exact machine-readable inputs/outputs
- use `pandora <family> ... --help` for the freshest family-specific usage surface

```text
pandora [--output table|json] --version
pandora [--output table|json] help
pandora [--output table|json] init-env [--force] [--dotenv-path <path>] [--example <path>]
pandora [--output table|json] doctor [--dotenv-path <path>] [--skip-dotenv] [--check-usdc-code] [--check-polymarket] [--rpc-timeout-ms <ms>]
pandora [--output table|json] setup [--force] [--dotenv-path <path>] [--example <path>] [--check-usdc-code] [--check-polymarket] [--rpc-timeout-ms <ms>]
pandora [--output json] capabilities
pandora [--output table|json] markets list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>|--type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--min-tvl <usdc>] [--hedgeable] [--expand] [--with-odds]
pandora [--output table|json] markets get [--id <id> ...] [--stdin]
pandora [--output table|json] sports books list|events list|events live|odds snapshot|odds bulk|consensus|create plan|create run|sync once|sync run|sync start|sync stop|sync status|resolve plan [flags]
pandora [--output table|json] lifecycle start --config <path>|status --id <id>|resolve --id <id> --confirm
pandora arb scan --markets <csv> --output ndjson|json [--min-net-spread-pct <n>] [--fee-pct-per-leg <n>] [--slippage-pct-per-leg <n>] [--amount-usdc <n>] [--combinatorial] [--max-bundle-size <n>] [--iterations <n>] [--interval-ms <ms>]
pandora [--output table|json] odds record --competition <id> --interval <sec> [--max-samples <n>] [--event-id <id>] [--venues pandora_amm,polymarket] [--indexer-url <url>] [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>]
pandora [--output table|json] odds history --event-id <id> --output csv|json [--limit <n>]
pandora [--output table|json] polls list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--status <int>] [--category <int>] [--question-contains <text>] [--where-json <json>]
pandora [--output table|json] polls get --id <id>
pandora [--output table|json] events list [--type all|liquidity|oracle-fee|claim] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-direction asc|desc] [--chain-id <id>] [--wallet <address>] [--market-address <address>] [--poll-address <address>] [--tx-hash <hash>]
pandora [--output table|json] events get --id <id> [--type all|liquidity|oracle-fee|claim]
pandora [--output table|json] positions list [--wallet <address>] [--market-address <address>] [--chain-id <id>] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--where-json <json>]
pandora [--output table|json] portfolio --wallet <address> [--chain-id <id>|--all-chains] [--limit <n>] [--include-events|--no-events] [--with-lp] [--rpc-url <url>]
pandora [--output table|json] watch [--wallet <address>] [--market-address <address>] [--side yes|no] [--amount-usdc <amount>] [--iterations <n>] [--interval-ms <ms>] [--chain-id <id>] [--include-events|--no-events] [--yes-pct <0-100>] [--alert-yes-below <0-100>] [--alert-yes-above <0-100>] [--alert-net-liquidity-below <amount>] [--alert-net-liquidity-above <amount>] [--fail-on-alert] [--track-brier] [--brier-source <name>] [--brier-file <path>] [--group-by source|market|competition]
pandora [--output table|json] scan [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--expand]
pandora [--output table|json] markets scan [scan flags]  # backward-compatible alias of scan
pandora [--output table|json] quote [--indexer-url <url>] [--timeout-ms <ms>] --market-address <address> --side yes|no [--mode buy|sell] --amount-usdc <amount>|--shares <amount>|--amounts <csv> [--yes-pct <0-100>] [--slippage-bps <0-10000>]
pandora [--output table|json] trade [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --amount-usdc <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-shares-out-raw <uint>] [--max-amount-usdc <amount>] [--min-probability-pct <0-100>] [--max-probability-pct <0-100>] [--allow-unquoted-execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]
pandora [--output table|json] sell [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --shares <amount>|--amount <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-amount-out-raw <uint>] [--allow-unquoted-execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]
pandora [--output table|json] claim [--dotenv-path <path>] [--skip-dotenv] --market-address <address>|--all [--wallet <address>] --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--indexer-url <url>] [--timeout-ms <ms>]
pandora [--output table|json] history --wallet <address> [--chain-id <id>] [--market-address <address>] [--side yes|no|both] [--status all|open|won|lost|closed] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by timestamp|pnl|entry-price|mark-price] [--order-direction asc|desc] [--include-seed]
pandora [--output table|json] export --wallet <address> --format csv|json [--chain-id <id>] [--year <yyyy>] [--from <unix>] [--to <unix>] [--out <path>]
pandora arb scan [--source pandora|polymarket] [--markets <csv>] --output ndjson|json [--min-net-spread-pct <n>|--min-spread-pct <n>] [--min-tvl <usdc>] [--fee-pct-per-leg <n>] [--slippage-pct-per-leg <n>] [--amount-usdc <n>] [--combinatorial] [--max-bundle-size <n>] [--similarity-threshold <0-1>] [--min-token-score <0-1>] [--max-close-diff-hours <n>] [--question-contains <text>] [--iterations <n>] [--interval-ms <ms>] [--indexer-url <url>] [--timeout-ms <ms>]
pandora [--output table|json] arbitrage [--chain-id <id>] [--venues pandora,polymarket] [--limit <n>] [--min-spread-pct <n>] [--min-liquidity-usdc <n>] [--max-close-diff-hours <n>] [--similarity-threshold <0-1>] [--min-token-score <0-1>] [--cross-venue-only|--allow-same-venue] [--with-rules] [--include-similarity] [--question-contains <text>] [--polymarket-host <url>] [--polymarket-mock-url <url>]
pandora [--output table|json] autopilot run|once --market-address <address> --side yes|no --amount-usdc <amount> [--trigger-yes-below <0-100>] [--trigger-yes-above <0-100>] [--paper|--execute-live] [--interval-ms <ms>] [--cooldown-ms <ms>] [--max-amount-usdc <amount>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--state-file <path>] [--kill-switch-file <path>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]
pandora [--output table|json] mirror browse|plan|deploy|verify|lp-explain|hedge-calc|simulate|go|sync|status|close ...
pandora [--output table|json] simulate mc|particle-filter|agents ...
pandora [--output table|json] model calibrate|correlation|diagnose|score brier ...
pandora [--output table|json] polymarket check|approve|preflight|trade ...
pandora [--output table|json] webhook test [--webhook-url <url>] [--webhook-template <json>] [--webhook-secret <secret>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>] [--webhook-timeout-ms <ms>] [--webhook-retries <n>]
pandora [--output table|json] leaderboard [--metric profit|volume|win-rate] [--chain-id <id>] [--limit <n>] [--min-trades <n>]
pandora [--output table|json] analyze --market-address <address> [--provider <name>] [--model <id>] [--max-cost-usd <n>] [--temperature <n>] [--timeout-ms <ms>]
pandora [--output table|json] suggest --wallet <address> --risk low|medium|high --budget <amount> [--count <n>] [--include-venues pandora,polymarket]
pandora [--output table|json] resolve [--dotenv-path <path>] [--skip-dotenv] --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>]
pandora [--output table|json] lp add|remove|positions [--market-address <address>] [--wallet <address>] [--amount-usdc <n>] [--lp-tokens <n>|--all|--all-markets] [--dry-run|--execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>] [--deadline-seconds <n>] [--indexer-url <url>] [--timeout-ms <ms>]
pandora [--output table|json] risk show|panic [--risk-file <path>] [--clear] [--reason <text>] [--actor <id>]
pandora [--output table|json] operations get|list|cancel|close [flags]
pandora stream prices|events [--indexer-url <url>] [--indexer-ws-url <url>] [--timeout-ms <ms>] [--interval-ms <ms>] [--market-address <address>] [--chain-id <id>] [--limit <n>]
pandora [--output json] schema
pandora mcp
pandora launch [--dotenv-path <path>] [--skip-dotenv] [script args...]
pandora clone-bet [--dotenv-path <path>] [--skip-dotenv] [script args...]
```

## Mirror subcommands

```text
browse --min-yes-pct <n> --max-yes-pct <n> --min-volume-24h <n> [--closes-after <date>|--end-date-after <date|72h>] [--closes-before <date>|--end-date-before <date|72h>] [--question-contains <text>|--keyword <text>] [--slug <text>] [--category sports|crypto|politics|entertainment] [--exclude-sports] [--sort-by volume24h|liquidity|endDate] [--limit <n>] [--chain-id <id>] [--polymarket-tag-id <id>] [--polymarket-tag-ids <csv>] [--sport-tag-id <id>] [--sport-tag-ids <csv>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
plan   --source polymarket --polymarket-market-id <id>|--polymarket-slug <slug> [--chain-id <id>] [--target-slippage-bps <n>] [--turnover-target <n>] [--depth-slippage-bps <n>] [--safety-multiplier <n>] [--min-liquidity-usdc <n>] [--max-liquidity-usdc <n>] [--with-rules] [--include-similarity] [--min-close-lead-seconds <n>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
deploy --plan-file <path>|--polymarket-market-id <id>|--polymarket-slug <slug> --dry-run|--execute [--liquidity-usdc <n>] [--fee-tier <500-50000>] [--max-imbalance <n>] [--arbiter <address>] [--category <id|name>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--oracle <address>] [--factory <address>] [--usdc <address>] [--distribution-yes <parts>] [--distribution-no <parts>] [--distribution-yes-pct <0-100>] [--distribution-no-pct <0-100>] [--rules <text>] [--sources <url...>] [--validation-ticket <ticket>] [--target-timestamp <unix|iso>] [--min-close-lead-seconds <n>] [--manifest-file <path>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
verify --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--trust-deploy] [--manifest-file <path>] [--include-similarity] [--with-rules] [--allow-rule-mismatch] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
lp-explain --liquidity-usdc <n> [--source-yes-pct <0-100>] [--distribution-yes <parts>] [--distribution-no <parts>]
hedge-calc [--reserve-yes-usdc <n> --reserve-no-usdc <n>] [--excess-yes-usdc <n>] [--excess-no-usdc <n>] [--polymarket-yes-pct <0-100>] [--hedge-ratio <n>] [--hedge-cost-bps <n>] [--volume-scenarios <csv>] [--pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug>] [--trust-deploy] [--manifest-file <path>]
simulate --liquidity-usdc <n> [--source-yes-pct <0-100>] [--target-yes-pct <0-100>] [--distribution-yes <parts>] [--distribution-no <parts>] [--fee-tier <500-50000>] [--volume-scenarios <csv>] [--hedge-ratio <n>] [--hedge-cost-bps <n>] [--polymarket-yes-pct <0-100>]
go     --polymarket-market-id <id>|--polymarket-slug <slug> [--liquidity-usdc <n>] [--fee-tier <500-50000>] [--max-imbalance <n>] [--arbiter <address>] [--category <id|name>] [--paper|--dry-run|--execute-live|--execute] [--auto-sync] [--sync-once] [--sync-interval-ms <ms>] [--hedge-ratio <n>] [--no-hedge] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <n>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--chain-id <id>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>] [--funder <address>] [--usdc <address>] [--oracle <address>] [--factory <address>] [--sources <url...>] [--validation-ticket <ticket>] [--target-timestamp <unix|iso>] [--manifest-file <path>] [--trust-deploy] [--skip-gate] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--with-rules] [--include-similarity] [--min-close-lead-seconds <n>]
sync run|once|start --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--paper|--dry-run|--execute-live|--execute] [--private-key <hex>] [--funder <address>] [--usdc <address>] [--trust-deploy] [--manifest-file <path>] [--skip-gate] [--daemon] [--stream|--no-stream] [--interval-ms <ms>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--hedge-ratio <n>] [--no-hedge] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <n>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--depth-slippage-bps <n>] [--min-time-to-close-sec <n>] [--iterations <n>] [--state-file <path>] [--kill-switch-file <path>] [--chain-id <id>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]
status --state-file <path>|--strategy-hash <hash> [--with-live] [--pandora-market-address <address>|--market-address <address>] [--polymarket-market-id <id>|--polymarket-slug <slug>]
close  --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug>|--all --dry-run|--execute [--wallet <address>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--indexer-url <url>] [--timeout-ms <ms>]
```

## Polymarket subcommands

```text
check [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]
approve --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]
preflight [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]
trade --condition-id <id>|--slug <slug>|--token-id <id> --token yes|no --amount-usdc <n> --dry-run|--execute [--side buy|sell] [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]
```

## Simulate and model subcommands

```text
simulate mc [--trials <n>] [--horizon <n>] [--start-yes-pct <0-100>] [--entry-yes-pct <0-100>] [--position yes|no] [--stake-usdc <n>] [--drift-bps <n>] [--vol-bps <n>] [--confidence <50-100>] [--var-level <50-100>] [--seed <n>] [--antithetic] [--stratified]
simulate particle-filter (--observations-json <json>|--input <path>|--stdin) [--particles <n>] [--process-noise <n>] [--observation-noise <n>] [--drift-bps <n>] [--initial-yes-pct <0-100>] [--initial-spread <n>] [--resample-threshold <0-1>] [--resample-method systematic|multinomial] [--credible-interval <50-100>] [--seed <n>]
simulate agents [--n-informed <n>] [--n-noise <n>] [--n-mm <n>] [--n-steps <n>] [--seed <int>]
model calibrate (--prices <csv>|--returns <csv>) [--dt <n>] [--jump-threshold-sigma <n>] [--min-jump-count <n>] [--model-id <id>] [--save-model <path>]
model correlation --series <id:v1,v2,...> --series <id:v1,v2,...> [--copula t|gaussian|clayton|gumbel] [--compare <csv>] [--tail-alpha <n>] [--df <n>] [--joint-threshold-z <n>] [--scenario-shocks <csv>] [--model-id <id>] [--save-model <path>]
model diagnose [--calibration-rmse <n>] [--drift-bps <n>] [--spread-bps <n>] [--depth-coverage <0..1>] [--informed-flow-ratio <0..1>] [--noise-ratio <0..1>] [--anomaly-rate <0..1>] [--manipulation-alerts <n>] [--tail-dependence <0..1>]
model score brier [--source <name>] [--market-address <address>] [--competition <id>] [--event-id <id>] [--model-id <id>] [--group-by source|market|competition|model|none] [--window-days <n>] [--bucket-count <n>] [--forecast-file <path>] [--include-records] [--include-unresolved] [--limit <n>]
```

## Sports command matrix

Use `pandora --output json schema` for the exact live contract and `pandora sports ... --help` for family routing. `capabilities` is the compact digest, not the full contract surface.

Execution note:
- `sports create run` is the mutating path. On CLI it uses `--dry-run|--execute`; on MCP execute-mode calls it also requires `agentPreflight` from `agent.market.validate`.

### Sports exact paths

```text
pandora [--output table|json] sports books list ...
pandora [--output table|json] sports events list ...
pandora [--output table|json] sports events live ...
pandora [--output table|json] sports odds snapshot ...
pandora [--output table|json] sports odds bulk ...
pandora [--output table|json] sports consensus ...
pandora [--output table|json] sports create plan ...
pandora [--output table|json] sports create run ...
pandora [--output table|json] sports sync once|run|start|stop|status ...
pandora [--output table|json] sports resolve plan ...
```

| Command | Purpose | Primary flags |
| --- | --- | --- |
| `sports books list` | Show sportsbook provider health and active book preference list. | `--provider`, `--book-priority`, `--timeout-ms` |
| `sports events list` | List normalized soccer events. | `--competition`, `--kickoff-after`, `--kickoff-before`, `--limit` |
| `sports events live` | List only live/in-play events. | `--competition`, `--limit`, `--provider` |
| `sports odds snapshot` | Fetch event odds snapshot plus consensus context. | `--event-id`, `--trim-percent`, `--min-tier1-books`, `--min-total-books` |
| `sports odds bulk` | Fetch all odds for a competition and refresh local cache. | `--competition`, `--provider`, `--timeout-ms`, `--limit` |
| `sports consensus` | Compute trimmed-median consensus from live or offline checks. | `--event-id` or `--checks-json`, `--trim-percent`, `--book-priority` |
| `sports create plan` | Build conservative creation plan and safety gates. | `--event-id`, `--selection`, `--market-type`, `--category`, `--creation-window-open-min`, `--creation-window-close-min` |
| `sports create run` | Dry-run or execute creation path. | `--event-id`, `--dry-run/--execute`, `--liquidity-usdc`, `--chain-id`, `--rpc-url`, `--category`, `--model-file`, `--model-stdin`, `agentPreflight` (MCP execute). For exact fields, inspect `schema` or the specific command descriptor. |
| `sports sync once|run|start|stop|status` | Evaluate and operate sports sync runtime state. | `--event-id` (required for `once|run|start`), `--risk-profile`, `--state-file`, `--paper/--execute-live` |
| `sports resolve plan` | Build manual-final resolution recommendation. | `--event-id` or `--checks-json/--checks-file`, `--poll-address`, `--settle-delay-ms`, `--consecutive-checks-required` |

## Sports policy defaults

### Consensus policy
- Odds are normalized to implied probability from decimal/American/fractional inputs.
- Consensus method is `trimmed-median` (v1), with default `--trim-percent 20`.
- Conservative coverage inputs default to `--min-tier1-books 3` and `--min-total-books 6`.

### Timing policy
- Creation planning defaults:
  - `--creation-window-open-min 1440` (24h before kickoff)
  - `--creation-window-close-min 90` (90m before kickoff)
- Core timing module defaults (spec-level fallbacks):
  - creation open lead `7d`
  - creation close lead `15m`
  - assumed event duration `3h`
  - resolve open delay `30m`
  - resolve target delay `2h`
  - resolve close delay `48h`
- Resolve plan safety defaults:
  - `--settle-delay-ms 600000` (10m)
  - `--consecutive-checks-required 2`

### Sync risk defaults
- Conservative (`--risk-profile conservative`):
  - `maxDataAgeMs=120000`
  - `minCoverageRatio=0.70`
  - `maxCoverageDropRatio=0.25`
  - `maxSpreadJumpBps=150`
  - `maxConsecutiveFailures=3`
  - `maxConsecutiveGateFailures=2`
- Balanced:
  - `maxDataAgeMs=150000`
  - `minCoverageRatio=0.60`
  - `maxCoverageDropRatio=0.30`
  - `maxSpreadJumpBps=200`
  - `maxConsecutiveFailures=4`
  - `maxConsecutiveGateFailures=3`
- Aggressive:
  - `maxDataAgeMs=180000`
  - `minCoverageRatio=0.50`
  - `maxCoverageDropRatio=0.40`
  - `maxSpreadJumpBps=250`
  - `maxConsecutiveFailures=5`
  - `maxConsecutiveGateFailures=4`

## Safe examples

### Read-only
```bash
pandora markets list --active --with-odds --limit 20
pandora markets get --id <market-id>
pandora scan --limit 25
pandora polls list --status 1 --category 1
pandora quote --market-address <0x...> --side yes --amount-usdc 50
pandora portfolio --wallet <0x...> --chain-id 1
pandora arb scan --source polymarket --output json --iterations 1 --min-net-spread-pct 2
pandora operations list --status planned,queued,running --limit 20
```

## Durable operations

Use the `operations` family to inspect and control persisted mutable-operation records created by the agent/runtime layer.

```text
operations get --id <operation-id>
operations list [--status <csv>] [--tool <name>] [--limit <n>]
operations cancel --id <operation-id> [--reason <text>]
operations close --id <operation-id> [--reason <text>]
```

Notes:
- `operations.get` returns one record plus lifecycle timestamps and checkpoints.
- `operations.list` is the compact queue/dashboard view for persisted records.
- `operations.cancel` is for cancelable in-flight records.
- `operations.close` is for terminal records after follow-up is complete.
- Current persisted records are local-state objects. Use `pandora --output json capabilities` / `schema` for the machine-facing contract.

### Mirror
```bash
pandora mirror browse --polymarket-tag-id 82 --min-yes-pct 20 --max-yes-pct 80 --min-volume-24h 100000 --limit 10
pandora mirror plan --source polymarket --polymarket-market-id <id> --with-rules --include-similarity
pandora mirror deploy --polymarket-slug <slug> --liquidity-usdc 10 --category Sports --sources <url1> <url2> --dry-run
pandora mirror go --polymarket-slug <slug> --liquidity-usdc 10 --category Sports --paper
pandora mirror sync once --pandora-market-address <0x...> --polymarket-market-id <id> --paper --hedge-ratio 1.0
pandora mirror close --pandora-market-address <0x...> --polymarket-market-id <id> --dry-run
```

### Legacy script wrappers
See [`legacy-launchers.md`](./legacy-launchers.md) for `launch` and `clone-bet` examples and their script-layer timing behavior.
