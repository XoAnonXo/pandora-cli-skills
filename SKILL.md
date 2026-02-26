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
- `--output json` applies to non-execution commands; `launch`/`clone-bet` stream script output directly.
- Guided setup command: `pandora setup`
- Phase 1 discovery command: `pandora scan`
- Phase 1 lifecycle filters: `pandora markets list --active|--resolved|--expiring-soon`
- Phase 2 trading commands: `pandora quote`, `pandora trade`
- Phase 2 risk guardrails: `--max-amount-usdc`, `--min-probability-pct`, `--max-probability-pct`
- Phase 3 analytics command: `pandora portfolio`
- Phase 3 monitoring command: `pandora watch`
- Phase 3 watch alerts: `--alert-yes-*`, `--alert-net-liquidity-*`, `--fail-on-alert`
- Doctor checks:
  - env presence + format validation
  - RPC reachability and chain id match
  - bytecode checks for `ORACLE` + `FACTORY` (`--check-usdc-code` optional)

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
- `--expand` and `--with-odds` are supported on `markets list` only.
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
  --arbiter 0x818457C9e2b18D87981CCB09b75AE183D107b257 \
  --category 3 \
  --liquidity 10 \
  --curve-flattener 7 \
  --curve-offset 30000 \
  --bet-usd 10 \
  --bet-on yes
```

For live execution, replace `--dry-run` with `--execute`.
If `pandora` is not linked yet, use `node cli/pandora.cjs clone-bet ...`.

Default arbiter (whitelisted): `0x818457C9e2b18D87981CCB09b75AE183D107b257`

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
