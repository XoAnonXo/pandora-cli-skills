# Trading Workflows

Use this file for the canonical read -> quote -> buy/sell -> claim trading loop.

## Canonical tool order
1. `scan` or `markets list|get`
2. `quote`
3. `trade` for buy-side execution
4. `sell` for sell-side execution
5. `claim` for finalized winning-token redemption

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
