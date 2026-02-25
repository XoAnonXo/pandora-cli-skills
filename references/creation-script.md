# Creator Script Guide

The skill includes `scripts/create_market_launcher.ts`, which performs:

1. Reads deployer balances (native + USDC)
2. Fetches Oracle fees and computes required poll fee
3. Calls `PredictionOracle.createPoll(...)` with fee value
4. Waits for `PollCreated` and extracts poll address
5. Approves USDC for `MarketFactory` when needed
6. Calls:
   - `createMarket(...)` for AMM
   - `createPariMutuel(...)` for PariMutuel
7. Prints transaction hashes and created market artifacts

## Core CLI options

- `--question` (required): market question
- `--rules` (required): must include explicit Yes/No + edge-case handling
- `--sources` (required, repeatable): at least 2 public `http/https` URLs
- `--arbiter` (optional): defaults to whitelisted arbiter
- `--deadline-epoch` or `--target-timestamp` (required): unix timestamp in seconds
- `--target-timestamp-offset-hours` (optional): default `1`
- `--category` (optional): category id (default `0`)
- `--market-type` (required): `amm` or `parimutuel`
- `--liquidity` (required): initial liquidity in USDC (**minimum 10 USDC**)
- `--distribution-yes` / `--distribution-no`: distribution hint (1e9 scale, must sum to `1000000000`)

AMM-only:
- `--fee-tier`: `500`, `3000`, `10000` (default `3000`)
- `--max-imbalance`: `maxPriceImbalancePerHour` (default `10000`)

PariMutuel-only:
- `--curve-flattener` (default `7`)
- `--curve-offset` (default `30000`)

## Core execution

```bash
npm run init-env
# edit scripts/.env values
npm run doctor

pandora launch \
  --dry-run \
  --question "Will BTC close above $100k by end of 2026?" \
  --rules "Resolves YES if BTC/USD closes above 100000 on 2026-12-31 per listed public sources. Resolves NO otherwise. If cancelled, postponed, abandoned, or unresolved by 2027-01-02, resolves NO." \
  --sources "https://coinmarketcap.com/currencies/bitcoin/" "https://www.coingecko.com/en/coins/bitcoin" \
  --target-timestamp 1798675200 \
  --target-timestamp-offset-hours 1 \
  --arbiter 0x818457C9e2b18D87981CCB09b75AE183D107b257 \
  --category 3 \
  --market-type amm \
  --liquidity 100 \
  --fee-tier 3000 \
  --distribution-yes 600000000 \
  --distribution-no 400000000
```

If `pandora` is not linked yet, use `node cli/pandora.cjs launch ...`.

Execution example (live):

```bash
pandora launch --execute --market-type parimutuel --liquidity 250 ...
```

Use `--dry-run` before `--execute` on first run.
