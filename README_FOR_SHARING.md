# Pandora CLI & Skills — Shareable Package

This is a sanitized, shareable copy of the Pandora market setup skill.

## What is included
- `SKILL.md` (usage/behavior)
- `package.json`
- `package-lock.json`
- `.gitignore`
- `scripts/.env.example`
- `scripts/create_market_launcher.ts`
- `scripts/create_polymarket_clone_and_bet.ts`
- `references/creation-script.md`
- `references/contracts.md`
- `references/checklist.md`

## What is intentionally omitted
- `.env` (contains PRIVATE_KEY / RPC overrides)
- `wallet.json` (contains privateKey/address)
- any local runtime secrets
- `node_modules`

## Setup
Prerequisite: Node.js `>=18`.

1. Install dependencies:
   - `npm install`
2. Initialize env file:
   - `npm run init-env`
   - or one-shot guided flow: `npm run setup`
3. Fill `scripts/.env`:
   - `CHAIN_ID`
   - `PRIVATE_KEY`
   - `RPC_URL`
   - `ORACLE`
   - `FACTORY`
   - `USDC`
   - optional for live mirror hedging and `mirror status --with-live` position diagnostics:
     - `POLYMARKET_PRIVATE_KEY`
     - `POLYMARKET_FUNDER` (Polymarket proxy wallet / Gnosis Safe address, not your EOA)
     - `POLYMARKET_API_KEY`
     - `POLYMARKET_API_SECRET`
     - `POLYMARKET_API_PASSPHRASE`
     - `POLYMARKET_HOST`
   - note: live Polymarket trading settles with Polygon USDC.e collateral on the proxy wallet.
4. Validate and build:
   - `npm run doctor`
   - `npm run build`
5. Run:
   - `npm run dry-run`
   - `npm run dry-run:clone`
   - `node cli/pandora.cjs help`

## Quickstart (Sports)
- List soccer events:
  - `pandora --output json sports events list --competition <id-or-slug> --limit 5`
- Compute sportsbook consensus:
  - `pandora --output json sports consensus --event-id <event-id> --trim-percent 20`
- Build creation plan:
  - `pandora --output json sports create plan --event-id <event-id> --selection home`
- Build manual resolve recommendation:
  - `pandora --output json sports resolve plan --event-id <event-id> --poll-address <0x...>`

## New CLI capabilities
- Global machine-readable output:
  - `pandora --output json doctor`
  - `pandora --output table polls list --limit 10`
  - `--output json` is supported for all commands except `launch`/`clone-bet`; those stream script output directly.
- Agent-native schema + MCP:
  - `pandora --output json schema`
  - `pandora mcp`
  - MCP exposes one tool per command family entrypoint and reuses CLI JSON envelopes.
- Next Best Action recovery hints:
  - JSON errors can include `error.recovery = { action, command, retryable }`.
  - existing `error.code`, `error.message`, and `error.details` fields are preserved.
- Attach-only fork runtime:
  - shared flags: `--fork`, `--fork-rpc-url <url>`, `--fork-chain-id <id>`.
  - payloads include runtime marker (`runtime.mode = "fork" | "live"`).
  - precedence: `--fork-rpc-url` > `FORK_RPC_URL` (when `--fork`) > normal runtime path.
- NDJSON streaming:
  - `pandora stream prices|events [--indexer-url <url>] [--indexer-ws-url <url>] [--interval-ms <ms>] [--limit <n>]`.
  - always emits NDJSON lines to stdout; WebSocket-first with polling fallback.
- Guided setup:
  - `pandora setup`
  - `pandora setup --check-usdc-code`
- Stronger doctor checks:
  - Required env and value validation
  - RPC reachability + chain-id match
  - Contract bytecode checks (`ORACLE`, `FACTORY`, optional `USDC`)
- Read-only indexer commands (GraphQL-backed):
  - `pandora markets list|get`
  - `pandora scan`
  - `pandora quote`
  - `pandora portfolio`
  - `pandora watch`
  - `pandora polls list|get`
  - `pandora events list|get`
  - `pandora positions list`
- Phase 1 market discovery helpers:
  - `pandora markets list --expand` (include linked poll metadata inline)
  - `pandora markets list --with-odds` (include YES/NO percentage odds inline)
  - `pandora markets list --active|--resolved|--expiring-soon` (lifecycle convenience filters)
  - `pandora markets get --id <market-id> --id <market-id>` (batch lookup in one call)
- `pandora --output json scan` (single-pass market discovery payload for automation)
- `pandora stream prices` (reactive market ticks in NDJSON)
- `pandora stream events` (reactive event feed in NDJSON)
- Phase 2 trading helpers:
  - `pandora quote --market-address <0x...> --side yes|no --amount-usdc <amount>`
  - `pandora trade --dry-run --market-address <0x...> --side yes|no --amount-usdc <amount> [--max-amount-usdc <amount>] [--min-probability-pct <0-100>] [--max-probability-pct <0-100>]`
  - `pandora trade --execute ...` performs allowance check, conditional USDC approve, then `buy`.
- Phase 3 wallet analytics:
  - `pandora portfolio --wallet <0x...> [--chain-id <id>] [--limit <n>] [--include-events|--no-events]`
  - `pandora watch --wallet <0x...> --iterations 10 --interval-ms 5000`
  - `pandora watch --market-address <0x...> --side yes --amount-usdc 10 --iterations 5 --alert-yes-above 65 --fail-on-alert`
- Phase 4 intelligence and automation:
  - `pandora history --wallet <0x...> --limit 50`
  - `pandora export --wallet <0x...> --format csv --year 2026 --out ./trades-2026.csv`
  - `pandora arbitrage --venues pandora,polymarket --min-spread-pct 3`
  - `pandora autopilot run|once ...`
  - `pandora mirror browse|plan|deploy|verify|lp-explain|hedge-calc|simulate|go|sync|status|close ...`
  - `pandora webhook test ...`
  - `pandora leaderboard --metric profit|volume|win-rate`
  - `pandora analyze --market-address <0x...> --provider <name>`
  - `pandora suggest --wallet <0x...> --risk low|medium|high --budget <amount>`
  - `pandora resolve`
- `pandora lp add|remove|positions`

## Agent-native expansion details

### MCP server (`pandora mcp`)
- Runs MCP server over stdio with tool discovery + execution.
- `tools/list` includes JSON-capable command tools (for example `markets.list`, `trade`, `mirror.plan`, `polymarket.check`).
- `launch` and `clone-bet` are intentionally not exposed over MCP because they stream script output.
- MCP safety rails:
  - mutating tools require explicit execute intent (`intent.execute=true`) for live execution.
  - long-running modes are blocked in v1 (`watch`, `autopilot run`, `mirror sync run/start`).

### Next Best Action recovery hints
- Structured JSON errors may include:
  - `error.recovery.action`
  - `error.recovery.command`
  - `error.recovery.retryable`
- This supports automatic recovery flows in agents while keeping backward compatibility for existing JSON parsers.

### Fork runtime support
- Supported families:
  - `trade`
  - `resolve`
  - `lp`
  - `polymarket check|approve|preflight|trade`
- `polymarket trade --execute` in fork mode is simulation-only unless `--polymarket-mock-url` is provided.

### NDJSON stream command
- `pandora stream prices|events` always emits NDJSON (ignores table rendering path for active stream output).
- Tick envelope includes:
  - `type`
  - `ts`
  - `seq`
  - `channel`
  - `source.transport`
  - `data`
- Transport behavior:
  - primary: WebSocket (`--indexer-ws-url` or derived URL)
  - fallback: polling (`source.transport = "polling"`)

Mirror advanced flags (for operator tuning):
- `--sync-interval-ms <ms>` on `mirror go` to control auto-sync tick cadence.
- `--oracle <address>` / `--factory <address>` on `mirror deploy` and `mirror go` for explicit contract overrides.
- `--polymarket-gamma-mock-url <url>` on `mirror browse|plan|verify|go|sync|status` for deterministic mock-source testing.
- `--no-stream` on `mirror sync` to disable per-tick stdout line streaming in run mode.
- `--pid-file <path>` on `mirror sync stop|status` for explicit daemon process selection.

## Read-only examples
- `pandora markets list --limit 20 --order-by createdAt --order-direction desc`
- `pandora markets list --active --with-odds --limit 20`
- `pandora markets list --expand --limit 20`
- `pandora markets list --with-odds --limit 20`
- `pandora markets get --id <market-id>`
- `pandora markets get --id <market-id-a> --id <market-id-b>`
- `pandora --output json scan --limit 25`
- `pandora quote --market-address <0x...> --side yes --amount-usdc 50`
- `pandora trade --dry-run --market-address <0x...> --side no --amount-usdc 25 --max-amount-usdc 30 --min-probability-pct 20`
- `pandora portfolio --wallet <0x...> --chain-id 1`
- `pandora watch --wallet <0x...> --iterations 3 --interval-ms 1000 --alert-net-liquidity-below -100`
- `pandora history --wallet <0x...> --limit 50`
- `pandora export --wallet <0x...> --format csv --out ./trades.csv`
- `pandora arbitrage --venues pandora,polymarket --min-spread-pct 2 --cross-venue-only --with-rules --include-similarity`
- `pandora autopilot once --market-address <0x...> --side no --amount-usdc 10 --trigger-yes-below 15 --paper`
- `pandora mirror browse --min-yes-pct 20 --max-yes-pct 80 --min-volume-24h 100000 --limit 10`
- `pandora mirror plan --source polymarket --polymarket-market-id <id> --with-rules --include-similarity`
- `pandora mirror go --polymarket-slug <slug> --liquidity-usdc 10 --paper`
- `pandora mirror verify --pandora-market-address <0x...> --polymarket-market-id <id> --include-similarity`
- `pandora mirror lp-explain --liquidity-usdc 10000 --source-yes-pct 58`
- `pandora mirror hedge-calc --reserve-yes-usdc 8 --reserve-no-usdc 12 --excess-no-usdc 2 --polymarket-yes-pct 60`
- `pandora mirror simulate --liquidity-usdc 10000 --source-yes-pct 58 --target-yes-pct 58 --volume-scenarios 1000,5000,10000`
- `pandora mirror sync once --pandora-market-address <0x...> --polymarket-market-id <id> --paper --hedge-ratio 1.0`
- `pandora mirror status --strategy-hash <hash> --with-live`
- `pandora mirror close --pandora-market-address <0x...> --polymarket-market-id <id> --dry-run`
- `pandora webhook test --webhook-url https://example.com/hook`
- `pandora leaderboard --metric volume --limit 20`
- `pandora analyze --market-address <0x...> --provider mock`
- `pandora suggest --wallet <0x...> --risk medium --budget 50 --include-venues pandora`
- `pandora polls list --status 1 --category 3`
- `pandora events list --type all --wallet <0x...> --limit 25`
- `pandora positions list --wallet <0x...> --limit 50`

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
- `--active|--resolved|--expiring-soon` are client-side filters on fetched list pages.
- Odds are indexer-derived and read-only; missing upstream liquidity/price fields can produce partial odds in some environments.
- `scan` is indexer-backed only (no direct chain reads); freshness depends on indexer sync state.

## Phase 2 JSON contracts
- `quote`:
  - envelope is `ok=true`, `command="quote"`, with `data.marketAddress`, `data.side`, `data.amountUsdc`, `data.odds`, `data.quoteAvailable`, and `data.estimate` (or `null` when unavailable).
- `trade --dry-run`:
  - envelope is `ok=true`, `command="trade"`, with `data.mode="dry-run"`, `data.quote`, `data.selectedProbabilityPct`, `data.riskGuards`, and `data.executionPlan.steps`.
- `trade --execute`:
  - envelope is `ok=true`, `command="trade"`, with tx metadata (`approveTxHash` optional, `buyTxHash` required on success) plus `selectedProbabilityPct` and `riskGuards`.

## Phase 2 limitations
- `trade` currently targets PariMutuel-compatible `buy(bool,uint256,uint256)` markets.
- `minSharesOut` protection defaults to raw `0` unless explicitly set with `--min-shares-out-raw`.
- If indexer odds are unavailable, `quote` still returns a structured payload with `quoteAvailable=false`.
- `trade --execute` blocks unquoted execution by default unless `--min-shares-out-raw` or `--allow-unquoted-execute` is provided.

## Phase 3 JSON contracts
- `portfolio`:
  - envelope is `ok=true`, `command="portfolio"`, with `data.wallet`, `data.summary`, `data.positions[]`, and `data.events.{liquidity,claims}`.
  - summary includes `positionCount`, `uniqueMarkets`, `liquidityAdded`, `liquidityRemoved`, `netLiquidity`, `claims`, `cashflowNet`, and `pnlProxy`.
- `watch`:
  - envelope is `ok=true`, `command="watch"`, with `data.parameters`, `data.iterationsRequested`, `data.snapshots[]`, and aggregated `data.alerts[]`.
  - each snapshot can include `portfolioSummary` and/or `quote` depending on selected targets, plus `alertCount`/`alerts`.

## Phase 3 limitations
- P&L values are indexer-derived activity metrics, not full realized/unrealized accounting.
- Claim events are not chain-filtered by indexer schema and may include cross-chain entries.
- Event-based aggregation can be disabled with `--no-events`.
- `watch` polls on an interval and is intended for terminal monitoring, not background daemonization.
- `--fail-on-alert` exits non-zero when any configured threshold is hit.

## Phase 4 JSON contracts
- `history`:
  - envelope is `ok=true`, `command="history"`, with `data.schemaVersion`, `data.summary`, and per-trade `data.items[]`.
  - P&L fields are analytics-grade approximations with row diagnostics where precision is limited.
- `export`:
  - envelope is `ok=true`, `command="export"`, with `data.format`, `data.columns`, `data.count`, optional `data.outPath`, and materialized `data.content`.
- `arbitrage`:
  - envelope is `ok=true`, `command="arbitrage"`, with `data.parameters`, `data.sources`, and `data.opportunities[]`.
  - agent-focused flags:
    - `--cross-venue-only` (default) prevents same-venue duplicate-market noise.
    - `--allow-same-venue` re-enables same-venue matching.
    - `--with-rules` includes per-leg rules/source metadata where available.
    - `--include-similarity` includes pairwise similarity diagnostics for each group.
  - source failures are emitted in diagnostics instead of hard crashes.
- `autopilot`:
  - envelope is `ok=true`, `command="autopilot"`, with `data.strategyHash`, `data.stateFile`, `data.snapshots[]`, and `data.actions[]`.
  - paper mode is default; live mode requires explicit caps (`--max-amount-usdc`, `--max-open-exposure-usdc`, `--max-trades-per-day`).
- `mirror plan`:
  - envelope is `ok=true`, `command="mirror.plan"`, with `data.sourceMarket`, `data.match`, `data.sizingInputs`, `data.liquidityRecommendation`, and `data.distributionHint`.
- `mirror browse`:
  - envelope is `ok=true`, `command="mirror.browse"`, with `data.filters`, `data.count`, and `data.items[]`.
- `mirror deploy`:
  - envelope is `ok=true`, `command="mirror.deploy"`, with `data.planDigest`, `data.deploymentArgs`, `data.tx`, `data.preflight`, `data.pandora`, `data.postDeployChecks`, and optional `data.trustManifest`.
- `mirror verify`:
  - envelope is `ok=true`, `command="mirror.verify"`, with `data.matchConfidence`, `data.ruleHashLeft`, `data.ruleHashRight`, `data.ruleDiffSummary`, `data.expiry`, optional `data.trustManifest`, `data.similarityChecks[]`, and `data.gateResult`.
- `mirror lp-explain`:
  - envelope is `ok=true`, `command="mirror.lp-explain"`, with complete-set flow fields (`mintedCompleteSets`, `seededPoolReserves`, `returnedExcessTokens`, `totalLpInventory`).
  - this command explains the `addLiquidity` mechanics explicitly: complete sets are minted first, only a weighted slice is seeded into pool reserves, and excess YES/NO tokens are returned to LP wallet inventory.
- `mirror hedge-calc`:
  - envelope is `ok=true`, `command="mirror.hedge-calc"`, with `data.metrics` (`deltaPoolUsdc`, `deltaTotalUsdc`, `targetHedgeUsdcSigned`, `hedgeToken`, `hedgeSharesApprox`, `breakEvenVolumeUsdc`) and `data.scenarios[]` fee-vs-hedge estimates.
- `mirror simulate`:
  - envelope is `ok=true`, `command="mirror.simulate"`, with `data.initialState`, `data.targeting`, and `data.scenarios[]` for volume-based LP/hedge planning.
  - simulation keeps the complete-set split exact (raw integer math), then models directional AMM flow with fee-in-reserve behavior for planning-grade projections.
- `mirror go`:
  - envelope is `ok=true`, `command="mirror.go"`, with staged results for `data.plan`, `data.deploy`, `data.verify`, optional `data.sync`, and `data.suggestedSyncCommand`.
- `mirror sync`:
  - envelope is `ok=true`, `command="mirror.sync"`, with `data.strategyHash`, `data.stateFile`, `data.parameters`, `data.snapshots[]`, and `data.actions[]`.
  - hedge controls: `--hedge-trigger-usdc`, `--max-hedge-usdc`, `--hedge-ratio <n>` (default `1`), and `--no-hedge` to disable hedge execution while keeping drift rebalancing active.
  - trust controls: `--trust-deploy`.
  - streaming: `--stream` emits per-tick logs for `mirror sync run` (table mode streams by default).
  - rebalance sizing is pool-aware: drift notional scales with `reserveYes + reserveNo`, then bounded by `--max-rebalance-usdc`.
  - Polymarket resilience: when Polymarket endpoints are unreachable, cached snapshots under `~/.pandora/polymarket` are reused for read paths; live sync blocks execution if source data is cached/stale.
- `mirror status`:
  - envelope is `ok=true`, `command="mirror.status"`, with `data.stateFile`, `data.strategyHash`, persisted `data.state`, and optional `data.live` when `--with-live` is used.
  - `data.live` now includes additive position diagnostics: `polymarketPosition.{yesBalance,noBalance,openOrdersCount,estimatedValueUsd,diagnostics[]}` plus `netDeltaApprox` and `pnlApprox`.
  - if Polymarket credentials/endpoints are unavailable, `--with-live` remains non-fatal and returns diagnostics with null position fields.
- `mirror close`:
  - envelope is `ok=true`, `command="mirror.close"`, with `data.mode` and unwind `data.steps[]` scaffold.
- `webhook test`:
  - envelope is `ok=true`, `command="webhook.test"`, with per-target delivery and retry metadata.
- `leaderboard`:
  - envelope is `ok=true`, `command="leaderboard"`, with ranked rows for selected metric.
  - inconsistent indexer aggregates are sanitized (win-rate capped to 0-100%) and exposed in diagnostics.
- `analyze`:
  - envelope is `ok=true`, `command="analyze"`, with provider/model metadata, market context, and `{ fairYesPct, confidence, rationale }`.
  - provider-agnostic interface; missing provider returns `ANALYZE_PROVIDER_NOT_CONFIGURED`.
- `suggest`:
  - envelope is `ok=true`, `command="suggest"`, with ranked suggestions, sizing, and risk notes.

## Resolve/LP commands
- `resolve` and `lp` are active command paths with strict flag validation, runtime preflight checks, and decoded on-chain revert reporting.

## Compatibility aliases
- `--env-file` = `--dotenv-path`
- `--no-env-file` = `--skip-dotenv`
- `--amount` = `--amount-usdc` (trade/watch/autopilot paths)
- `--market-id` = `--condition-id` (polymarket trade)
- `--force-gate` = `--skip-gate` (deprecated; prefer `--skip-gate`)

## Additional JSON response shapes
- `doctor`: `{ ok: true, command: "doctor", data: { schemaVersion, generatedAt, env, rpc, codeChecks, polymarket, summary } }`
- `resolve`:
  - dry-run: `{ ok: true, command: "resolve", data: { schemaVersion, generatedAt, mode: "dry-run", txPlan } }`
  - execute: `{ ok: true, command: "resolve", data: { schemaVersion, generatedAt, mode: "execute", tx } }`
- `lp`:
  - add/remove: `{ ok: true, command: "lp", data: { schemaVersion, generatedAt, action: "add"|"remove", mode, txPlan, tx? } }`
  - positions: `{ ok: true, command: "lp", data: { schemaVersion, generatedAt, action: "positions", mode: "read", wallet, count, items } }`
- `polymarket` (`check|preflight|approve|trade`):
  - `{ ok: true, command, data: { schemaVersion, generatedAt, ... } }`

### Resolve command
- Usage:
  - `pandora [--output table|json] resolve --poll-address <address> --answer yes|no --reason <text> --dry-run|--execute [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>]`
- Behavior:
  - `--dry-run` returns a deterministic execution plan.
  - `--execute` submits the resolution transaction with decoded revert diagnostics on failure.

### LP command
- Usage:
  - `pandora [--output table|json] lp add --market-address <address> --amount-usdc <n> --dry-run|--execute [--deadline-seconds <n>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]`
  - `pandora [--output table|json] lp remove --market-address <address> --lp-tokens <n> --dry-run|--execute [--deadline-seconds <n>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--usdc <address>]`
  - `pandora [--output table|json] lp positions --wallet <address> [--market-address <address>] [--chain-id <id>] [--indexer-url <url>] [--timeout-ms <ms>]`
- Behavior:
  - `add/remove` use simulation-first transaction flow.
  - `positions` returns LP holdings and preview diagnostics.

## Pandora Mainnet Reference
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
- Full deployment notes: `references/contracts.md`

## Release and verified install
- CI workflow: `.github/workflows/ci.yml` runs on Linux/macOS/Windows and covers install, lint/typecheck, full tests, and `npm pack --dry-run`.
- Release workflow: `.github/workflows/release.yml` runs on pushed `v*` tags, runs tests, builds `npm pack`, generates `checksums.sha256`, and uploads both workflow artifacts + GitHub Release assets.
- Verified install helper:
  - `scripts/release/install_release.sh --repo <owner/repo> --tag <tag> --no-install`
  - `scripts/release/install_release.sh --repo <owner/repo> --tag <tag>`
  - optional out-of-band digest pin: `scripts/release/install_release.sh --repo <owner/repo> --tag <tag> --expected-sha256 <64-hex>`
- The helper downloads `checksums.sha256` from the tag release, verifies SHA-256 for the tarball, verifies keyless cosign signature (`<asset>.sig` + `<asset>.pem`) against the release workflow identity, then installs via npm (global by default).
- `cosign` is required for default secure install. Use `--skip-signature-verify` only for legacy unsigned releases.

## CLI
- Entry command: `pandora` (from package `bin`) or `node cli/pandora.cjs`.
- Commands:
  - `pandora init-env`
  - `pandora setup`
  - `pandora doctor`
  - `pandora markets list|get`
  - `pandora scan`
  - `pandora quote`
  - `pandora trade`
  - `pandora portfolio`
  - `pandora watch`
  - `pandora history`
  - `pandora export`
  - `pandora arbitrage`
  - `pandora autopilot`
  - `pandora mirror`
  - `pandora webhook test`
  - `pandora leaderboard`
  - `pandora analyze`
  - `pandora suggest`
  - `pandora resolve`
  - `pandora lp add|remove|positions`
  - `pandora polls list|get`
  - `pandora events list|get`
  - `pandora positions list`
  - `pandora launch ...`
  - `pandora clone-bet ...`
- Optional global link in this checkout:
  - `npm link`
  - then run `pandora help`

## Security
Never share real private keys. Use environment files only locally.
