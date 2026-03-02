---
name: pandora-cli-skills
summary: Canonical skill and operator guide for Pandora CLI including mirror, polymarket, resolve, and LP flows.
version: 1.1.44
---

# Pandora CLI & Skills

Create and publish Pandora prediction markets from deployed contracts.

## Purpose
Use this skill to launch Parimutuel or AMM markets with explicit market parameters, strict DAO-ready resolution rules, and optional scripted bet placement.

## Safety & Resolution Rules (enforced)
- At least **2 public source URLs** are required (`http/https` only).
- `--rules` must include explicit **Yes/No** outcomes and edge-case handling (cancel/postpone/abandoned/unresolved cases).
- `--target-timestamp` uses a `+1h` buffer by default (`--target-timestamp-offset-hours` to override).
- `deadline` must be in the future (12h+ window strongly recommended).
- `distribution-yes + distribution-no = 1_000_000_000`.
- `--liquidity` minimum is **10 USDC**.
- `--arbiter` cannot be zero-address.

## Setup
```bash
# Node.js >=18 required
npm install
npm run init-env
# or one-shot setup + diagnostics:
npm run setup
# edit scripts/.env with your values
npm run build
npm run doctor

# optional: expose "pandora" command globally in this checkout
npm link
```

## CLI ergonomics
- Global output mode: `--output table|json` (default `table`)
- `--output json` is supported for all commands except `launch`/`clone-bet`; those stream script output directly.
- Agent schema command: `pandora --output json schema`
- MCP server mode: `pandora mcp`
- Guided setup command: `pandora setup`
- Phase 1 discovery command: `pandora scan`
- Phase 1 lifecycle filters: `pandora markets list --active|--resolved|--expiring-soon`
- Phase 2 trading commands: `pandora quote`, `pandora trade`
- Phase 2 risk guardrails: `--max-amount-usdc`, `--min-probability-pct`, `--max-probability-pct`
- Phase 3 analytics command: `pandora portfolio`
- Phase 3 monitoring command: `pandora watch`
- Phase 3 watch alerts: `--alert-yes-*`, `--alert-net-liquidity-*`, `--fail-on-alert`
- Phase 4 commands:
  - `pandora history`
  - `pandora export`
  - `pandora arbitrage`
  - `pandora autopilot run|once`
  - `pandora mirror browse|plan|deploy|verify|lp-explain|hedge-calc|simulate|go|sync|status|close`
  - `pandora webhook test`
  - `pandora leaderboard`
  - `pandora analyze`
  - `pandora suggest`
  - `pandora resolve`
  - `pandora lp add|remove|positions`
  - `pandora stream prices|events`
- Fork runtime flags for transaction families:
  - `--fork`
  - `--fork-rpc-url <url>`
  - `--fork-chain-id <id>`
- JSON errors can include additive recovery hints:
  - `error.recovery = { action, command, retryable }`
- Doctor checks:
  - env presence + format validation
  - RPC reachability and chain id match
  - bytecode checks for `ORACLE` + `FACTORY` (`--check-usdc-code` optional)

## Lifecycle and risk notes
- `lifecycle start --config` expects a JSON object file in the current release.
- `risk show|panic` controls a global execution lock used by live write paths.
- Current risk-counter semantics:
  - `max_position_usd` guards per-operation notional.
  - `max_daily_loss_usd` is enforced as daily live notional (`counters.liveNotionalUsdc`).
  - `max_open_markets` is enforced as daily live operation count (`counters.liveOps`).

## Quant ABM baseline (module contract)
- Deterministic ABM core:
  - `cli/lib/quant/abm_market.cjs`
- Simulate-agents handler:
  - `cli/lib/simulate_handlers/agents.cjs`
- Handler flags:
  - `--n-informed|--n_informed`
  - `--n-noise|--n_noise`
  - `--n-mm|--n_mm`
  - `--n-steps|--n_steps`
  - `--seed`
- ABM payload fields:
  - `convergenceError`
  - `spreadTrajectory[]`
  - `volume` (`total`, `averagePerStep`, `byAgentType`)
  - `pnlByAgentType`
  - `runtimeBounds` (`complexity`, `estimatedAgentDecisions`, `estimatedWorkUnits`)
- Runtime complexity metadata: `O(n_steps * (n_informed + n_noise))`.
- Unit coverage:
  - `tests/unit/abm_market.test.cjs`
- Note:
  - This section documents the current module + handler contract. Top-level simulate namespace routing can consume this handler when wired by command service.

## Complete command + flag reference (authoritative)
This section mirrors live CLI help output so agent runs can rely on one source of truth.

```text
pandora [--output table|json] --version
pandora [--output table|json] help
pandora [--output table|json] init-env [--force] [--dotenv-path <path>] [--example <path>]
pandora [--output table|json] doctor [--dotenv-path <path>] [--skip-dotenv] [--check-usdc-code] [--check-polymarket] [--rpc-timeout-ms <ms>]
pandora [--output table|json] setup [--force] [--dotenv-path <path>] [--example <path>] [--check-usdc-code] [--check-polymarket] [--rpc-timeout-ms <ms>]
pandora [--output table|json] markets list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--expand] [--with-odds]
pandora [--output table|json] markets get [--id <id> ...] [--stdin]
pandora [--output table|json] sports books list|events list|events live|odds snapshot|odds bulk|consensus|create plan|create run|sync once|sync run|sync start|sync stop|sync status|resolve plan [flags]
pandora [--output table|json] lifecycle start --config <path>|status --id <id>|resolve --id <id> --confirm
pandora arb scan --markets <csv> --output ndjson|json [--min-net-spread-pct <n>] [--fee-pct-per-leg <n>] [--amount-usdc <n>] [--iterations <n>] [--interval-ms <ms>]
pandora [--output table|json] odds record --competition <id> --interval <sec> [--max-samples <n>] [--event-id <id>] [--venues pandora_amm,polymarket]
pandora [--output table|json] odds history --event-id <id> --output csv|json [--limit <n>]
pandora [--output table|json] polls list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--status <int>] [--category <int>] [--question-contains <text>] [--where-json <json>]
pandora [--output table|json] polls get --id <id>
pandora [--output table|json] events list [--type all|liquidity|oracle-fee|claim] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-direction asc|desc] [--chain-id <id>] [--wallet <address>] [--market-address <address>] [--poll-address <address>] [--tx-hash <hash>]
pandora [--output table|json] events get --id <id> [--type all|liquidity|oracle-fee|claim]
pandora [--output table|json] positions list [--wallet <address>] [--market-address <address>] [--chain-id <id>] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--where-json <json>]
pandora [--output table|json] portfolio --wallet <address> [--chain-id <id>] [--limit <n>] [--include-events|--no-events] [--with-lp] [--rpc-url <url>]
pandora [--output table|json] watch [--wallet <address>] [--market-address <address>] [--side yes|no] [--amount-usdc <amount>] [--iterations <n>] [--interval-ms <ms>] [--chain-id <id>] [--include-events|--no-events] [--yes-pct <0-100>] [--alert-yes-below <0-100>] [--alert-yes-above <0-100>] [--alert-net-liquidity-below <amount>] [--alert-net-liquidity-above <amount>] [--fail-on-alert]
pandora [--output table|json] scan [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--expand]
pandora [--output table|json] quote [--indexer-url <url>] [--timeout-ms <ms>] --market-address <address> --side yes|no --amount-usdc <amount> [--yes-pct <0-100>] [--slippage-bps <0-10000>]
pandora [--output table|json] trade [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --amount-usdc <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-shares-out-raw <uint>] [--max-amount-usdc <amount>] [--min-probability-pct <0-100>] [--max-probability-pct <0-100>] [--allow-unquoted-execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]
pandora [--output table|json] history --wallet <address> [--chain-id <id>] [--market-address <address>] [--side yes|no|both] [--status all|open|won|lost|closed] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by timestamp|pnl|entry-price|mark-price] [--order-direction asc|desc] [--include-seed]
pandora [--output table|json] export --wallet <address> --format csv|json [--chain-id <id>] [--year <yyyy>] [--from <unix>] [--to <unix>] [--out <path>]
pandora [--output table|json] arbitrage [--chain-id <id>] [--venues pandora,polymarket] [--limit <n>] [--min-spread-pct <n>] [--min-liquidity-usdc <n>] [--max-close-diff-hours <n>] [--similarity-threshold <0-1>] [--cross-venue-only|--allow-same-venue] [--with-rules] [--include-similarity] [--question-contains <text>] [--polymarket-host <url>] [--polymarket-mock-url <url>]
pandora [--output table|json] autopilot run|once --market-address <address> --side yes|no --amount-usdc <amount> [--trigger-yes-below <0-100>] [--trigger-yes-above <0-100>] [--paper|--execute-live] [--interval-ms <ms>] [--cooldown-ms <ms>] [--max-amount-usdc <amount>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--state-file <path>] [--kill-switch-file <path>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]
pandora [--output table|json] mirror browse|plan|deploy|verify|lp-explain|hedge-calc|simulate|go|sync|status|close ...
pandora [--output table|json] polymarket check|approve|preflight|trade ...
pandora [--output table|json] webhook test [--webhook-url <url>] [--webhook-template <json>] [--webhook-secret <secret>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>] [--webhook-timeout-ms <ms>] [--webhook-retries <n>]
pandora [--output table|json] leaderboard [--metric profit|volume|win-rate] [--chain-id <id>] [--limit <n>] [--min-trades <n>]
pandora [--output table|json] analyze --market-address <address> [--provider <name>] [--model <id>] [--max-cost-usd <n>] [--temperature <n>] [--timeout-ms <ms>]
pandora [--output table|json] suggest --wallet <address> --risk low|medium|high --budget <amount> [--count <n>] [--include-venues pandora,polymarket]
pandora [--output table|json] resolve --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>]
pandora [--output table|json] lp add|remove|positions [--market-address <address>] [--wallet <address>] [--amount-usdc <n>] [--lp-tokens <n>] [--dry-run|--execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>] [--deadline-seconds <n>] [--indexer-url <url>] [--timeout-ms <ms>]
pandora [--output table|json] risk show|panic [--risk-file <path>] [--clear] [--reason <text>] [--actor <id>]
pandora stream prices|events [--indexer-url <url>] [--indexer-ws-url <url>] [--timeout-ms <ms>] [--interval-ms <ms>] [--market-address <address>] [--chain-id <id>] [--limit <n>]
pandora [--output json] schema
pandora mcp
pandora launch [--dotenv-path <path>] [--skip-dotenv] [script args...]
pandora clone-bet [--dotenv-path <path>] [--skip-dotenv] [script args...]
```

Mirror subcommand detail:

```text
browse --min-yes-pct <n> --max-yes-pct <n> --min-volume-24h <n> [--closes-after <date>] [--closes-before <date>] [--question-contains <text>] [--limit <n>] [--chain-id <id>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
plan   --source polymarket --polymarket-market-id <id>|--polymarket-slug <slug> [--chain-id <id>] [--target-slippage-bps <n>] [--turnover-target <n>] [--depth-slippage-bps <n>] [--safety-multiplier <n>] [--min-liquidity-usdc <n>] [--max-liquidity-usdc <n>] [--with-rules] [--include-similarity] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
deploy --plan-file <path>|--polymarket-market-id <id>|--polymarket-slug <slug> --dry-run|--execute [--liquidity-usdc <n>] [--fee-tier <500-50000>] [--max-imbalance <n>] [--arbiter <address>] [--category <n>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--oracle <address>] [--factory <address>] [--usdc <address>] [--distribution-yes <parts>] [--distribution-no <parts>] [--sources <url...>] [--min-close-lead-seconds <n>] [--manifest-file <path>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
verify --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--trust-deploy] [--manifest-file <path>] [--include-similarity] [--with-rules] [--allow-rule-mismatch] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
lp-explain --liquidity-usdc <n> [--source-yes-pct <0-100>] [--distribution-yes <parts>] [--distribution-no <parts>]
hedge-calc [--reserve-yes-usdc <n> --reserve-no-usdc <n>] [--excess-yes-usdc <n>] [--excess-no-usdc <n>] [--polymarket-yes-pct <0-100>] [--hedge-ratio <n>] [--hedge-cost-bps <n>] [--volume-scenarios <csv>] [--pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug>] [--trust-deploy] [--manifest-file <path>]
simulate --liquidity-usdc <n> [--source-yes-pct <0-100>] [--target-yes-pct <0-100>] [--distribution-yes <parts>] [--distribution-no <parts>] [--fee-tier <500-50000>] [--volume-scenarios <csv>] [--hedge-ratio <n>] [--hedge-cost-bps <n>] [--polymarket-yes-pct <0-100>]
go     --polymarket-market-id <id>|--polymarket-slug <slug> [--liquidity-usdc <n>] [--fee-tier <500-50000>] [--max-imbalance <n>] [--arbiter <address>] [--category <n>] [--paper|--dry-run|--execute-live|--execute] [--auto-sync] [--sync-once] [--sync-interval-ms <ms>] [--hedge-ratio <n>] [--no-hedge] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <n>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>] [--usdc <address>] [--oracle <address>] [--factory <address>] [--sources <url...>] [--manifest-file <path>] [--trust-deploy] [--skip-gate] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--with-rules] [--include-similarity] [--min-close-lead-seconds <n>]
sync run|once|start --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--paper|--dry-run|--execute-live|--execute] [--private-key <hex>] [--funder <address>] [--usdc <address>] [--trust-deploy] [--manifest-file <path>] [--skip-gate] [--daemon] [--stream|--no-stream] [--interval-ms <ms>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--hedge-ratio <n>] [--no-hedge] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <n>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--depth-slippage-bps <n>] [--min-time-to-close-sec <n>] [--iterations <n>] [--state-file <path>] [--kill-switch-file <path>] [--chain-id <id>] [--rpc-url <url>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]
status --state-file <path>|--strategy-hash <hash> [--with-live] [--pandora-market-address <address>|--market-address <address>] [--polymarket-market-id <id>|--polymarket-slug <slug>]
close  --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> --dry-run|--execute
```

Daemon selector detail:

```text
sync stop --pid-file <path>|--strategy-hash <hash>
sync status --pid-file <path>|--strategy-hash <hash>
```

Polymarket subcommand detail:

```text
check [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]
approve --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]
preflight [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]
trade --condition-id <id>|--slug <slug>|--token-id <id> --token yes|no --amount-usdc <n> --dry-run|--execute [--side buy|sell] [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]
```

## Sports command matrix
| Command | Purpose | Primary flags |
| --- | --- | --- |
| `sports books list` | Show sportsbook provider health and active book preference list. | `--provider`, `--book-priority`, `--timeout-ms` |
| `sports events list` | List normalized soccer events. | `--competition`, `--kickoff-after`, `--kickoff-before`, `--limit` |
| `sports events live` | List only live/in-play events. | `--competition`, `--limit`, `--provider` |
| `sports odds snapshot` | Fetch event odds snapshot plus consensus context. | `--event-id`, `--trim-percent`, `--min-tier1-books`, `--min-total-books` |
| `sports odds bulk` | Fetch all odds for a competition and refresh local cache. | `--competition`, `--provider`, `--timeout-ms`, `--limit` |
| `sports consensus` | Compute trimmed-median consensus from live or offline checks. | `--event-id` or `--checks-json`, `--trim-percent`, `--book-priority` |
| `sports create plan` | Build conservative creation plan and safety gates. | `--event-id`, `--selection`, `--market-type`, `--creation-window-open-min`, `--creation-window-close-min` |
| `sports create run` | Dry-run or execute creation path. | `--event-id`, `--dry-run/--execute`, `--liquidity-usdc`, `--chain-id`, `--rpc-url`, `--model-file`, `--model-stdin` |
| `sports sync once|run|start|stop|status` | Evaluate and operate sports sync runtime state. | `--event-id` (required for `once|run|start`), `--risk-profile`, `--state-file`, `--paper/--execute-live` |
| `sports resolve plan` | Build manual-final resolution recommendation. | `--event-id` or `--checks-json/--checks-file`, `--poll-address`, `--settle-delay-ms`, `--consecutive-checks-required` |

## Sports consensus policy
- Odds are normalized to implied probability from decimal/American/fractional inputs.
- Consensus method is `trimmed-median` (v1), with default `--trim-percent 20`.
- Conservative coverage inputs default to `--min-tier1-books 3` and `--min-total-books 6`.
- Confidence can degrade when coverage policy is not satisfied.
- Consensus payload includes:
  - `method`
  - `tier1Coverage`
  - `totalBooks`
  - `includedBooks`
  - `excludedBooks`
  - `outliers`
  - `consensusYesPct`
  - `consensusNoPct`

## Sports timing policy
- Creation planning defaults:
  - `--creation-window-open-min 1440` (24h before kickoff)
  - `--creation-window-close-min 90` (90m before kickoff)
- Core timing module defaults (spec-level fallbacks):
  - creation open lead `7d`, creation close lead `15m`
  - assumed event duration `3h`
  - resolve open delay `30m`, resolve target delay `2h`, resolve close delay `48h`
- Resolve plan safety defaults:
  - `--settle-delay-ms 600000` (10m)
  - `--consecutive-checks-required 2`

## Manual resolve workflow (sports)
1. Build resolve plan:
   - `pandora --output json sports resolve plan --event-id <id> --poll-address <0x...>`
2. Confirm plan safety:
   - require `safeToResolve=true`
   - read `recommendedAnswer`, `stableWindowStartAt`, and diagnostics
3. Execute resolution:
   - run `recommendedCommand` when present
   - or run manual command: `pandora resolve --poll-address <0x...> --answer yes|no|invalid --reason "<text>" --execute`
4. If unsafe:
   - continue collecting checks (`--checks-json`/`--checks-file`) and rerun until safety gates pass.

## Sports sync risk defaults
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

## Read-only indexer commands
Indexer URL resolution order:
1. `--indexer-url`
2. `PANDORA_INDEXER_URL`
3. `INDEXER_URL`
4. default public indexer

```bash
pandora markets list --limit 20 --order-by createdAt --order-direction desc
pandora markets list --active --with-odds --limit 20
pandora markets list --expand --limit 20
pandora markets list --with-odds --limit 20
pandora markets get --id <market-id>
pandora markets get --id <market-id-a> --id <market-id-b>
pandora scan --limit 25
pandora quote --market-address <0x...> --side yes --amount-usdc 50
pandora trade --dry-run --market-address <0x...> --side no --amount-usdc 25 --max-amount-usdc 30 --min-probability-pct 20
pandora portfolio --wallet <0x...> --chain-id 1
pandora watch --wallet <0x...> --iterations 5 --interval-ms 2000 --alert-net-liquidity-below -100

pandora polls list --status 1 --category 3
pandora polls get --id <poll-id>

pandora events list --type all --wallet <0x...> --limit 25
pandora events get --id <event-id>

pandora positions list --wallet <0x...> --limit 50
```

JSON mode for automation:
```bash
pandora --output json polls list --limit 5
pandora --output json markets list --expand --with-odds --limit 5
pandora --output json scan --limit 25
pandora --output json quote --market-address <0x...> --side yes --amount-usdc 10
pandora --output json trade --dry-run --market-address <0x...> --side no --amount-usdc 10 --max-amount-usdc 20
pandora --output json portfolio --wallet <0x...> --chain-id 1
pandora --output json watch --wallet <0x...> --iterations 3 --interval-ms 1000 --alert-net-liquidity-above 1000 --fail-on-alert
pandora --output json history --wallet <0x...> --limit 50
pandora --output json export --wallet <0x...> --format csv --out ./trades.csv
pandora --output json arbitrage --venues pandora,polymarket --min-spread-pct 3 --cross-venue-only --with-rules --include-similarity
pandora --output json autopilot once --market-address <0x...> --side no --amount-usdc 10 --trigger-yes-below 15 --paper
pandora --output json mirror browse --min-yes-pct 20 --max-yes-pct 80 --min-volume-24h 100000 --limit 10
pandora --output json mirror plan --source polymarket --polymarket-market-id <id> --with-rules --include-similarity
pandora --output json mirror lp-explain --liquidity-usdc 10000 --source-yes-pct 58
pandora --output json mirror hedge-calc --reserve-yes-usdc 8 --reserve-no-usdc 12 --excess-no-usdc 2 --polymarket-yes-pct 60
pandora --output json mirror simulate --liquidity-usdc 10000 --source-yes-pct 58 --target-yes-pct 58 --volume-scenarios 1000,5000,10000
pandora --output json mirror go --polymarket-slug <slug> --liquidity-usdc 10 --paper
pandora --output json mirror verify --pandora-market-address <0x...> --polymarket-market-id <id> --include-similarity
pandora --output json mirror sync once --pandora-market-address <0x...> --polymarket-market-id <id> --paper --hedge-ratio 1.0
pandora --output json mirror status --strategy-hash <hash> --with-live
pandora --output json mirror close --pandora-market-address <0x...> --polymarket-market-id <id> --dry-run
pandora --output json webhook test --webhook-url https://example.com/hook
pandora --output json leaderboard --metric profit --limit 20
pandora --output json analyze --market-address <0x...> --provider mock
pandora --output json suggest --wallet <0x...> --risk medium --budget 50 --include-venues pandora
pandora --output json schema
```

## Phase 1 JSON contracts
- `markets list --expand`:
  - each item includes `poll` with `id`, `question`, `status`, `category`, `deadlineEpoch`.
- `markets list --with-odds`:
  - each item includes `odds` with numeric `yesPct` and `noPct` (normalized to 100 total).
- `scan`:
  - response envelope is `ok=true`, `command="scan"`, with `data.indexerUrl`, `data.generatedAt`, `data.count`, and `data.items[]`.
  - each scan item includes at minimum `id`, `chainId`, `marketType`, `question`, `marketCloseTimestamp`, and `odds`.

## Phase 1 limitations
- `scan` always includes odds; `--with-odds` is accepted for backward compatibility.
- `--expand` is supported on both `markets list` and `scan`.
- `--active|--resolved|--expiring-soon` are client-side filters over fetched pages.
- Odds are indexer-derived and read-only; missing upstream liquidity/price fields can produce partial odds in some environments.
- `scan` is indexer-backed only (no direct chain reads); freshness depends on indexer sync state.

## Phase 2 JSON contracts
- `quote`:
  - envelope is `ok=true`, `command="quote"`, with `data.marketAddress`, `data.side`, `data.amountUsdc`, `data.odds`, `data.quoteAvailable`, and `data.estimate` (or `null`).
- `trade --dry-run`:
  - envelope is `ok=true`, `command="trade"`, with `data.mode="dry-run"`, `data.quote`, `data.selectedProbabilityPct`, `data.riskGuards`, and `data.executionPlan.steps`.
- `trade --execute`:
  - envelope is `ok=true`, `command="trade"`, with tx metadata (`approveTxHash` optional, `buyTxHash` required on success) plus `selectedProbabilityPct` and `riskGuards`.

## Phase 2 limitations
- `trade` currently targets PariMutuel-compatible `buy(bool,uint256,uint256)` markets.
- `--min-shares-out-raw` is the explicit slippage guard input for on-chain execution.
- If indexer odds are unavailable, `quote` still returns structured output with `quoteAvailable=false`.
- `trade --execute` blocks unquoted execution by default unless `--min-shares-out-raw` or `--allow-unquoted-execute` is provided.

## Phase 3 JSON contracts
- `portfolio`:
  - envelope is `ok=true`, `command="portfolio"`, with `data.wallet`, `data.summary`, `data.positions[]`, and `data.events.{liquidity,claims}`.
  - summary includes `positionCount`, `uniqueMarkets`, `liquidityAdded`, `liquidityRemoved`, `netLiquidity`, `claims`, `cashflowNet`, and `pnlProxy`.
- `watch`:
  - envelope is `ok=true`, `command="watch"`, with `data.parameters`, `data.iterationsRequested`, `data.snapshots[]`, and aggregated `data.alerts[]`.
  - snapshots include timestamped `portfolioSummary` and/or `quote` blocks based on chosen targets, plus `alertCount`/`alerts`.

## Phase 3 limitations
- P&L values are indexer-derived activity metrics, not full realized/unrealized accounting.
- Claim events are not chain-filtered by indexer schema and may include cross-chain entries.
- Use `--no-events` when you only need position snapshots.
- `watch` is polling-based and terminal-oriented, not a long-running background service manager.
- `--fail-on-alert` exits non-zero when any configured threshold triggers.

## Phase 4 contracts
- `history`: analytics-grade trade journal with per-trade approximate P&L and diagnostics.
- `export`: deterministic CSV/JSON materialization from history rows.
- `arbitrage`: duplicate/correlated market spread detection across Pandora + Polymarket.
  - `--cross-venue-only` is default to suppress same-venue duplicate noise.
  - `--allow-same-venue` opts back into same-venue matching.
  - `--with-rules` includes per-leg rule/source context where indexer data exists.
  - `--include-similarity` includes pairwise similarity diagnostics for agent verification.
- `autopilot`: paper-first trigger loop with persisted local state and idempotency.
- `mirror plan`: Polymarket mirror sizing plan with liquidity recommendation and distribution hint.
- `mirror browse`: Polymarket candidate discovery with optional Pandora mirror hints.
- `mirror deploy`: dry-run/execute Pandora AMM deployment from mirror plan inputs, with execute-time wallet preflight and trust-manifest persistence.
- `mirror verify`: explicit question/rules similarity endpoint for AI-subagent validation, with optional `--trust-deploy` manifest bypass for similarity.
- `mirror lp-explain`: complete-set liquidity walkthrough (minted YES/NO, seeded pool reserves, returned excess inventory).
- `mirror hedge-calc`: reserve/excess-driven hedge sizing (`deltaTotalUsdc`, target hedge leg, break-even volume).
- `mirror simulate`: planning-grade LP + hedge scenario simulation with customizable `--volume-scenarios`.
- `mirror go`: one-command orchestration for plan → deploy → verify, with optional auto-sync start.
- `mirror sync`: paper-first delta-neutral loop with strict gates, state persistence, and optional live hedging (`--hedge-ratio <n>`, `--no-hedge`).
  - live hedge env: `POLYMARKET_PRIVATE_KEY`, `POLYMARKET_FUNDER`, `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_API_PASSPHRASE`, `POLYMARKET_HOST`.
  - `POLYMARKET_FUNDER` must be the Polymarket proxy wallet (Gnosis Safe), not the EOA address.
  - Polymarket trading collateral is Polygon USDC.e on the proxy wallet.
  - rebalance sizing is pool-aware and bounded by `--max-rebalance-usdc`.
  - endpoint resilience: Polymarket snapshots are cached under `~/.pandora/polymarket`; paper/read flows can reuse cache during outages, while live sync blocks cached sources.
  - daemon verification note: `mirror sync start` launches a child process that executes `cli/pandora.cjs` and enters the same CLI `main()` handlers, so crash/error handling remains covered by the normal command dispatcher + structured error envelopes.
- `mirror status`: local mirror state inspection with optional live market diagnostics (`--with-live`).
  - `--with-live` uses the same `POLYMARKET_*` env keys for optional position visibility (YES/NO balances, open orders count, estimated value) and adds `netDeltaApprox` / `pnlApprox`.
  - missing credentials or unavailable position endpoints do not hard-fail status; diagnostics are returned with null position fields.
- `mirror close`: deterministic unwind scaffold for LP withdrawal + hedge unwind flow.
- `webhook test`: channel validation for generic, Telegram, and Discord payload delivery.
- `leaderboard`: ranked user aggregates by profit/volume/win-rate.
  - invalid indexer aggregates are sanitized (win-rate capped to 0-100%) and emitted in diagnostics.
- `analyze`: provider-agnostic market analysis interface (fails with structured error when provider is not configured).
- `suggest`: risk/budget-ranked opportunities seeded from arbitrage output and wallet history.
- `resolve` and `lp`: enabled command paths with strict flag/runtime validation and decoded on-chain revert reporting.

### Resolve command
- Usage:
  - `pandora [--output table|json] resolve --poll-address <address> --answer yes|no --reason <text> --dry-run|--execute [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>]`
- Behavior:
  - `--dry-run` returns the call plan and decode-ready payload.
  - `--execute` submits on-chain resolution through configured oracle/operator path.
  - Reverts are surfaced through decoded custom errors when ABI matches.

### LP command
- Usage:
  - `pandora [--output table|json] lp add --market-address <address> --amount-usdc <n> --dry-run|--execute [--deadline-seconds <n>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]`
  - `pandora [--output table|json] lp remove --market-address <address> --lp-tokens <n> --dry-run|--execute [--deadline-seconds <n>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]`
  - `pandora [--output table|json] lp positions --wallet <address> [--market-address <address>] [--chain-id <id>] [--indexer-url <url>] [--timeout-ms <ms>]`
- Behavior:
  - `add/remove` path runs transaction simulation before submit.
  - `positions` combines indexer + on-chain LP state when available.

## Polymarket command group
- `pandora polymarket check [--rpc-url <url>] [--private-key <hex>] [--funder <address>]`
  - Discovers signer + proxy wallet readiness and reports balances/allowances/ownership checks.
- `pandora polymarket approve --dry-run|--execute [--rpc-url <url>] [--private-key <hex>] [--funder <address>]`
  - Validates and applies required USDC.e + CTF approvals for hedge execution paths.
- `pandora polymarket preflight [--rpc-url <url>] [--private-key <hex>] [--funder <address>]`
  - Aggregated readiness gate for live Polymarket trading operations.
- `pandora polymarket trade --condition-id <id>|--slug <slug>|--token-id <id> --token yes|no --amount-usdc <n> --dry-run|--execute [--side buy|sell] [--polymarket-host <url>] [--timeout-ms <ms>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]`
  - Direct Polymarket order path outside `mirror sync`.

## Mirror workflow guide
1. Plan:
   - `pandora mirror plan --source polymarket --polymarket-slug <slug> --with-rules --include-similarity`
2. Deploy:
   - `pandora mirror deploy --polymarket-slug <slug> --liquidity-usdc 10 --dry-run|--execute`
3. Verify:
   - `pandora mirror verify --market-address <pandora-market> --polymarket-slug <slug> --include-similarity --with-rules`
4. Run sync:
   - `pandora mirror sync run --market-address <pandora-market> --polymarket-slug <slug> --paper`
   - live: `--execute-live --max-open-exposure-usdc <n> --max-trades-per-day <n>`
5. Inspect status:
   - `pandora mirror status --state-file <path> --with-live`

Mode aliases:
- Mirror commands accept both mode styles:
  - paper/live: `--paper` or `--dry-run`, and `--execute-live` or `--execute`
- Mirror commands accept either market flag name:
  - `--pandora-market-address` or `--market-address`

Common compatibility aliases:
- `--env-file` = `--dotenv-path`
- `--no-env-file` = `--skip-dotenv`
- `--amount` = `--amount-usdc` (trade/watch/autopilot paths)
- `--market-id` = `--condition-id` (polymarket trade)
- `--force-gate` = `--skip-gate` (deprecated; use `--skip-gate`)

## Distribution format (ppb)
- Distribution inputs use parts-per-billion (ppb):
  - `--distribution-yes 580000000` means YES seed weight = `58%`.
  - `--distribution-no 420000000` means NO seed weight = `42%`.
  - Constraint: `distributionYes + distributionNo = 1_000_000_000`.

## Error code guide
Common structured error codes for automation:
- `MISSING_REQUIRED_FLAG`: required flag absent.
- `INVALID_FLAG_VALUE`: wrong type/range/format for a flag.
- `INVALID_ARGS`: conflicting or incompatible argument combinations.
- `UNKNOWN_FLAG`: unrecognized flag for a command.
- `UNKNOWN_COMMAND`: unrecognized top-level command.
- `NOT_FOUND`: requested entity not found.
- `INDEXER_HTTP_ERROR` / `INDEXER_TIMEOUT`: indexer transport failure.
- `MIRROR_*`: mirror pipeline/service failures (plan/deploy/verify/sync/go/status).
- `POLYMARKET_*`: Polymarket resolution/auth/order/preflight failures.
- `RISK_*`: risk state/guardrail/panic failures (`RISK_PANIC_ACTIVE`, `RISK_GUARDRAIL_BLOCKED`, etc.).
- `LIFECYCLE_*`: lifecycle state-machine file operations (`LIFECYCLE_EXISTS`, `LIFECYCLE_NOT_FOUND`).
- `ODDS_*`: odds record/history storage and connector failures.
- `ARB_*`: arb scan parsing/execution output-mode failures.
- `CONFIG_*`: config read/parse failures (for example `CONFIG_FILE_NOT_FOUND`).
- `MCP_FILE_ACCESS_BLOCKED`: MCP-mode file path denied outside workspace root.
- `WEBHOOK_DELIVERY_FAILED`: webhook hard-fail when `--fail-on-webhook-error` is set.

Error envelope:
- `{ ok: false, error: { code, message, details?, recovery?: { action, command, retryable } } }`

## MCP server mode
- Start server:
  - `pandora mcp`
- Transport:
  - MCP stdio JSON-RPC.
- Tool model:
  - one tool per command family entrypoint (for example `markets.list`, `trade`, `mirror.plan`, `polymarket.check`).
- Exclusions in v1:
  - `launch`, `clone-bet` are intentionally not exposed because they stream interactive script output.
- Guardrails in v1:
  - mutating tools require explicit execute intent (`intent.execute=true`) for live execution.
  - long-running modes are blocked (`watch`, `autopilot run`, `mirror sync run|start`) with actionable structured errors.

## Next Best Action recovery hints
- JSON errors may include additive recovery guidance:
  - `error.recovery.action`: short recovery label.
  - `error.recovery.command`: copy-pasteable remediation command.
  - `error.recovery.retryable`: whether retry is expected to succeed after recovery.
- `details.hints` is preserved for human operators.

## Fork runtime (attach-only)
- Shared flags:
  - `--fork`
  - `--fork-rpc-url <url>`
  - `--fork-chain-id <id>`
- URL precedence in fork mode:
  1. `--fork-rpc-url`
  2. `FORK_RPC_URL` (when `--fork`)
  3. command live RPC path
- Commands annotate runtime mode in payload:
  - `runtime.mode = "fork" | "live"`.
- `polymarket trade` in fork mode:
  - default is simulation-only.
  - `--execute` requires `--polymarket-mock-url`.

## Stream command (NDJSON)
- Usage:
  - `pandora stream prices|events [--indexer-url <url>] [--indexer-ws-url <url>] [--timeout-ms <ms>] [--interval-ms <ms>] [--market-address <address>] [--chain-id <id>] [--limit <n>]`
- Output:
  - NDJSON only (one JSON object per line to stdout), regardless of table/json global mode.
- Tick envelope fields:
  - `type`, `ts`, `seq`, `channel`, `source.transport`, `source.url`, `data`.
- Transport behavior:
  - WebSocket-first when `--indexer-ws-url` is provided/derivable.
  - polling fallback with `source.transport = "polling"`.

## Additional JSON response shapes
- `doctor`:
  - `{ ok: true, command: "doctor", data: { schemaVersion, generatedAt, env, rpc, codeChecks, polymarket, summary } }`
- `history`:
  - `{ ok: true, command: "history", data: { schemaVersion, generatedAt, indexerUrl, wallet, chainId, filters, pagination, pageInfo, summary, count, items[] } }`
  - each `items[]` row includes `entryPriceUsdcPerToken`, `markPriceUsdcPerToken`, `currentValueUsdc`, `pnlUnrealizedApproxUsdc`, `pnlRealizedApproxUsdc`, `status`, and `diagnostics[]`.
- `export`:
  - `{ ok: true, command: "export", data: { schemaVersion, generatedAt, format: "csv"|"json", wallet, chainId, count, filters, columns[], outPath, rows[], content } }`
  - `content` is the deterministic serialized payload written to `outPath` when `--out` is provided.
- `arbitrage`:
  - `{ ok: true, command: "arbitrage", data: { schemaVersion, generatedAt, indexerUrl, venues, filters, count, opportunities[], diagnostics[] } }`
- `autopilot`:
  - `{ ok: true, command: "autopilot", data: { schemaVersion, generatedAt, strategyHash, mode, executeLive, stateFile, killSwitchFile, iterationsRequested, iterationsCompleted, stoppedReason?, parameters: { marketAddress, side, amountUsdc, triggerYesBelow?, triggerYesAbove?, intervalMs, cooldownMs, maxAmountUsdc?, maxOpenExposureUsdc, dailySpendCapUsdc, maxTradesPerDay }, state, actionCount, actions[], snapshots[], webhookReports[] } }`
- `mirror browse`:
  - `{ ok: true, command: "mirror.browse", data: { schemaVersion, generatedAt, source, gammaApiError, filters, count, items[], diagnostics[] } }`
  - each candidate row can include `existingMirror: { marketAddress, similarity } | null`.
- `mirror go`:
  - `{ ok: true, command: "mirror.go", data: { schemaVersion, generatedAt, mode, plan, deploy, verify, sync, polymarketPreflight, suggestedSyncCommand, trustManifest, diagnostics[] } }`
  - `plan` is the same payload shape as `mirror.plan`; `deploy` is the same payload shape as `mirror.deploy`; `sync` is null unless `--auto-sync` is used.
- close peers:
  - `mirror close`: `{ ok: true, command: "mirror.close", data: { schemaVersion, generatedAt, mode, pandoraMarketAddress, polymarketMarketId?, polymarketSlug?, steps[], diagnostics[] } }`
  - `mirror sync start|status|stop`: `{ ok: true, command: "mirror.sync.start|mirror.sync.status|mirror.sync.stop", data: { strategyHash, pid?, pidFile, logFile?, alive, status, metadata? } }`
- `resolve`:
  - dry-run: `{ ok: true, command: "resolve", data: { schemaVersion, generatedAt, mode: "dry-run", txPlan } }`
  - execute: `{ ok: true, command: "resolve", data: { schemaVersion, generatedAt, mode: "execute", tx } }`
- `lp`:
  - `lp add|remove`: `{ ok: true, command: "lp", data: { schemaVersion, generatedAt, action: "add"|"remove", mode, txPlan, tx? } }`
  - `lp positions`: `{ ok: true, command: "lp", data: { schemaVersion, generatedAt, action: "positions", mode: "read", wallet, count, items[] } }`
- `polymarket`:
  - `check|preflight|approve|trade` all return `{ ok: true, command, data }` with `schemaVersion` and `generatedAt`; execute paths include `result`/`tx` blocks.
- `leaderboard`:
  - `{ ok: true, command: "leaderboard", data: { schemaVersion, generatedAt, indexerUrl, metric, limit, minTrades, count, items[], diagnostics[] } }`
- `analyze`:
  - `{ ok: true, command: "analyze", data: { schemaVersion, generatedAt, indexerUrl, marketAddress, provider, model, market, quote, result } }`
- `suggest`:
  - `{ ok: true, command: "suggest", data: { schemaVersion, generatedAt, wallet, risk, budget, count, items[], indexerUrl, includeVenues, historySummary, arbitrageCount } }`

## Pandora mainnet deployment reference
- PredictionOracle (Factory): `0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442`
- PredictionPoll (Implementation): `0xC49c177736107fD8351ed6564136B9ADbE5B1eC3`
- MarketFactory: `0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c`
- OutcomeToken (Implementation): `0x15AF9A6cE764a7D2b6913e09494350893436Ab3d`
- PredictionAMM (Implementation): `0x7D45D4835001347B31B722Fb830fc1D9336F09f4`
- PredictionPariMutuel (Implementation): `0x5CaF2D85f17A8f3b57918d54c8B138Cacac014BD`
- Initial collateral (USDC): `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- Platform treasury: `0x8789F22a0456FEddaf9074FF4cEE55E4122095f0`
- Protocol fee rate: `20000` (`2%`)
- Indexer URL: `https://pandoraindexer.up.railway.app/`
- Source of truth doc: `references/contracts.md`

## Release verification
- CI coverage includes Linux, macOS, and Windows.
- Release artifacts are signed keylessly with cosign in the release workflow.
- Installer verifies checksum + cosign signature by default:
  - `scripts/release/install_release.sh --repo <owner/repo> --tag <tag>`
- `cosign` is required unless you explicitly pass `--skip-signature-verify` for legacy unsigned tags.

## Launch Parimutuel + auto-bet
Use `--allow-duplicate` only if you intentionally want to bypass duplicate-question checks.

```bash
pandora clone-bet \
  --dry-run \
  --question "Will Arsenal FC win against Chelsea FC on 2026-03-01?" \
  --rules "Resolves YES if Arsenal FC wins in regulation time on March 1, 2026. Resolves NO for draw/Chelsea win. If cancelled, postponed beyond 48h, abandoned, or unresolved by official competition records, resolves NO." \
  --sources "https://www.premierleague.com" "https://www.bbc.com/sport/football" \
  --target-timestamp 1772323200 \
  --target-timestamp-offset-hours 1 \
  --arbiter 0x0D7B957C47Da86c2968dc52111D633D42cb7a5F7 \
  --category 3 \
  --liquidity 10 \
  --curve-flattener 7 \
  --curve-offset 30000 \
  --bet-usd 10 \
  --bet-on yes
```

For live execution, replace `--dry-run` with `--execute`.
If `pandora` is not linked yet, use `node cli/pandora.cjs clone-bet ...`.

Default arbiter (whitelisted): `0x0D7B957C47Da86c2968dc52111D633D42cb7a5F7`

## Launch AMM/Parimutuel (market launcher)
```bash
pandora launch \
  --dry-run \
  --market-type amm \
  --question "Will BTC close above $100k by end of 2026?" \
  --rules "Resolves YES if BTC/USD closes above 100000 on 2026-12-31 per listed public sources. Resolves NO otherwise. If data feed is cancelled, postponed, abandoned, or unresolved by 2027-01-02, resolves NO." \
  --sources "https://coinmarketcap.com/currencies/bitcoin/" "https://www.coingecko.com/en/coins/bitcoin" \
  --target-timestamp 1798675200 \
  --target-timestamp-offset-hours 1 \
  --category 3 \
  --liquidity 100 \
  --fee-tier 3000 \
  --distribution-yes 600000000 \
  --distribution-no 400000000
```

If `pandora` is not linked yet, use `node cli/pandora.cjs launch ...`.

## Notes
- For AMM launch: `--market-type amm --fee-tier ...`.
- For PariMutuel launch: `--market-type parimutuel` with `--curve-flattener` and `--curve-offset`.
- If `createPariMutuel` reverts with `transfer amount exceeds balance`, top up USDC and retry.
- Duplicate guard checks recent on-chain poll questions and blocks repeats unless `--allow-duplicate` is set.
