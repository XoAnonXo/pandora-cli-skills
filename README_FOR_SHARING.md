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
4. Validate and build:
   - `npm run doctor`
   - `npm run build`
5. Run:
   - `npm run dry-run`
   - `npm run dry-run:clone`
   - `node cli/pandora.cjs help`

## New CLI capabilities
- Global machine-readable output:
  - `pandora --output json doctor`
  - `pandora --output table polls list --limit 10`
  - `--output json` is for non-execution commands; `launch`/`clone-bet` stream script output directly.
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
  - `pandora webhook test ...`
  - `pandora leaderboard --metric profit|volume|win-rate`
  - `pandora analyze --market-address <0x...> --provider <name>`
  - `pandora suggest --wallet <0x...> --risk low|medium|high --budget <amount>`
  - ABI-gated placeholders: `pandora resolve`, `pandora lp`

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
- `pandora arbitrage --venues pandora,polymarket --min-spread-pct 2`
- `pandora autopilot once --market-address <0x...> --side no --amount-usdc 10 --trigger-yes-below 15 --paper`
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
- `--expand` and `--with-odds` are supported on `markets list` only.
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
  - source failures are emitted in diagnostics instead of hard crashes.
- `autopilot`:
  - envelope is `ok=true`, `command="autopilot"`, with `data.strategyHash`, `data.stateFile`, `data.snapshots[]`, and `data.actions[]`.
  - paper mode is default; live mode requires explicit caps (`--max-amount-usdc`, `--max-open-exposure-usdc`, `--max-trades-per-day`).
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

## ABI-gated commands
- `resolve` and `lp` are intentionally gated and return `ABI_READY_REQUIRED` until verified ABI signatures/events and integration tests are committed.

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
  - `pandora webhook test`
  - `pandora leaderboard`
  - `pandora analyze`
  - `pandora suggest`
  - `pandora resolve` (ABI-gated)
  - `pandora lp` (ABI-gated)
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
