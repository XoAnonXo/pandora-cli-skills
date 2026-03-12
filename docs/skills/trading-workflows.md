# Trading Workflows

Use this file for the canonical read -> quote -> buy/sell -> claim trading loop.

## Canonical tool order
1. `scan` or `markets list|get`
2. `quote`
3. `trade` for buy-side execution
4. `sell` for sell-side execution
5. `claim` for finalized winning-token redemption

## Fast quote triage

When a user asks to quote but omits the market selector or size:
- ask only for the missing market selector and amount
- if they need help identifying the market, use `scan` or `markets list|get` before asking another open-ended follow-up
- do not broaden the answer into bootstrap/capabilities/schema unless the user explicitly asked for setup help
- once the market and size are known, route straight to `quote`
- for a generic "I want to buy into a Pandora market" request, the first move is still `scan` or `markets list|get`, then `quote`; do not jump straight to `polymarket preflight`
- only mention `polymarket preflight` after the user is clearly on a Polymarket-specific execution path with a concrete market selector and trade inputs

## Discover candidate markets

```bash
pandora scan --output json --limit 25
pandora markets list --output json --active --with-odds --limit 25
pandora markets get --output json --id <market-id>
```

Use:
- `scan` for enriched discovery
- `markets list|get` for raw browse/get views

## Quote before every mutation

### Buy-side
```bash
pandora quote --output json \
  --market-address 0x... \
  --side yes \
  --amount-usdc 25
```

### Sell-side
```bash
pandora quote --output json \
  --market-address 0x... \
  --side no \
  --mode sell \
  --shares 25
```

### Curve sizing
```bash
pandora quote --output json \
  --market-address 0x... \
  --side no \
  --amounts 25,50,75,100
```

## Pari-mutuel specifics

Pari-mutuel markets are supported, but they behave differently from AMMs and need to be treated as a separate operator path.

Quick chooser:
- Use `amm` when users want active repricing and a live sell path before close.
- Use `parimutuel` when users want a pooled YES/NO market whose opening distribution expresses the prior view up front.
- A request like `99.9/0.1` usually means "seed an almost one-sided parimutuel pool," not "launch an AMM with normal two-way trading."

Creation:
- Use `pandora launch --market-type parimutuel` for the current generic scripted creation path.
- Use `pandora clone-bet` when you want a pari-mutuel market plus an immediate initial buy.
- `sports create plan --market-type parimutuel` can build a pari-mutuel template, but `sports create run --execute` is still AMM-only.

Quote interpretation:
- `pandora quote` on a pari-mutuel market emits pool/share math rather than AMM target-reserve math.
- Read `poolYes`, `poolNo`, and `totalPool` as the live pool composition.
- Read `sharePct` as the fraction of the selected winning pool your buy would own after the trade.
- Read `payoutIfWin` and `profitIfWin` as conditional outcomes if the selected side wins.
- Read `breakevenProbability` as the implied minimum win probability needed for neutral expected value.

Execution constraints:
- `trade` supports pari-mutuel buy execution.
- `sell` is not available for pari-mutuel markets.
- `quote --target-pct` is AMM-only and will reject pari-mutuel markets explicitly.

Valuation:
- `portfolio` normalizes pari-mutuel raw balances and micro-unit balances before computing `markValueUsdc`.
- Pari-mutuel mark value is derived from pool share against `totalPool`, not from AMM probability times token balance.

## Safe buy-side execution

### Dry-run first
```bash
pandora trade --output json --dry-run \
  --market-address 0x... \
  --side yes \
  --amount-usdc 25
```

### Execute only after the quote is acceptable
```bash
pandora trade --output json --execute \
  --market-address 0x... \
  --side yes \
  --amount-usdc 25
```

Key controls:
- `--slippage-bps`
- `--min-shares-out-raw`
- `--max-amount-usdc`
- `--min-probability-pct`
- `--max-probability-pct`
- `--fork`

## Safe sell-side execution

### Dry-run first
```bash
pandora sell --output json --dry-run \
  --market-address 0x... \
  --side yes \
  --shares 25
```

### Execute
```bash
pandora sell --output json --execute \
  --market-address 0x... \
  --side yes \
  --shares 25
```

Key controls:
- `--slippage-bps`
- `--min-amount-out-raw`
- `--fork`

Pari-mutuel note:
- `sell` is AMM-only. If the market is pari-mutuel, use `quote` plus `portfolio`/`claim` workflows instead of expecting a live exit trade.

## Fork mode
Use `--fork` for previewing chain execution without live settlement:

```bash
pandora trade --output json --dry-run --fork ...
pandora sell --output json --dry-run --fork ...
```

Fork output is the preferred safety path when an agent wants execution realism without live signing.

## Claim workflow

### Single market
```bash
pandora claim --output json --market-address 0x... --dry-run
```

### Batch claim
```bash
pandora claim --output json --all --wallet 0x... --dry-run
```

Claim should come after:
- market resolved
- poll finalized
- tokens are actually redeemable

## Cross-venue analysis

### Canonical scanner
```bash
pandora arb scan --output json --iterations 1 --source polymarket
```

### Compatibility wrapper (legacy/debug only)
```bash
pandora arbitrage --output json --limit 10
```

Prefer `arb scan`. Only use `arbitrage` when you must match an older caller's behavior or deliberately inspect the bounded compatibility wrapper.

## Related docs
- discovery and canonical routing:
  - [`capabilities.md`](./capabilities.md)
- portfolio and closeout:
  - [`portfolio-closeout.md`](./portfolio-closeout.md)
- machine-facing execution contracts:
  - [`agent-interfaces.md`](./agent-interfaces.md)
