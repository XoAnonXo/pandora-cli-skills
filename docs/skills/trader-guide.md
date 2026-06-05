# Trader Guide

This guide is for users who want to discover prediction markets, buy and sell positions, track a portfolio, and claim winnings. If you are deploying and operating markets instead, see the [Operator Guide](./operator-guide.md).

## What a trader does

A trader uses Pandora to find prediction markets, evaluate pricing, execute buy/sell trades, monitor positions, and claim winnings after resolution. All trader commands are read-safe by default; live execution requires explicit `--execute` or `--execute-live` flags.

## Command map

| Category | Command | What it does |
|---|---|---|
| **Discovery** | `scan` | Enriched market discovery with odds, TVL, and metadata |
| | `markets list` | Browse markets with filters (active, resolved, expiring, TVL) |
| | `markets get --id <id>` | Get details for specific market(s) |
| | `polls list` / `polls get` | Browse and inspect polls |
| | `positions list` | List positions for a wallet |
| **Pricing** | `quote --side yes --amount-usdc 25` | Buy-side quote |
| | `quote --mode sell --shares 25` | Sell-side quote |
| | `quote --amounts 25,50,75,100` | Multi-size curve comparison |
| **Execution** | `trade --dry-run` | Preview a buy without signing |
| | `trade --execute` | Execute a buy |
| | `sell --dry-run` | Preview a sell without signing |
| | `sell --execute` | Execute a sell |
| | `claim --market-address 0x...` | Claim winnings from one resolved market |
| | `claim --all --wallet 0x...` | Batch-claim all resolved positions |
| **Portfolio** | `portfolio --wallet 0x...` | Current portfolio snapshot (positions, mark values) |
| | `history --wallet 0x...` | Trade history with P&L |
| | `export --wallet 0x... --format csv` | Export trades for tax/accounting |
| | `watch` | Live position monitoring with price alerts |
| **Cross-venue** | `arb scan --source polymarket` | Find cross-venue arbitrage opportunities |
| **Automation** | `autopilot run` | Automated trading within trigger rules |
| | `suggest --wallet 0x... --risk medium` | AI-powered trade suggestions |
| | `analyze --market-address 0x...` | AI analysis of a specific market |

## Canonical workflow

```text
1. Discover  -->  2. Quote  -->  3. Execute  -->  4. Monitor  -->  5. Claim
   scan              quote          trade            watch          claim
   markets list                     sell             portfolio
   markets get                                       history
```

### 1. Discover markets

```bash
pandora scan --output json --limit 25
pandora markets list --output json --active --with-odds --limit 25
pandora markets get --output json --id <market-id>
```

### 2. Get a quote

Always quote before executing. The quote shows expected shares, slippage, and probability impact.

```bash
pandora quote --output json \
  --market-address 0x... \
  --side yes \
  --amount-usdc 25
```

For sell-side:

```bash
pandora quote --output json \
  --market-address 0x... \
  --side yes \
  --mode sell \
  --shares 25
```

### 3. Execute

Dry-run first, then execute:

```bash
pandora trade --output json --dry-run \
  --market-address 0x... --side yes --amount-usdc 25

pandora trade --output json --execute \
  --market-address 0x... --side yes --amount-usdc 25
```

Key safety flags: `--slippage-bps`, `--min-probability-pct`, `--max-probability-pct`, `--fork`

### 4. Monitor

```bash
pandora portfolio --output json --wallet 0x...
pandora watch --wallet 0x... --alert-yes-below 30 --alert-yes-above 80
```

### 5. Claim

After a market resolves:

```bash
pandora claim --output json --market-address 0x... --dry-run
pandora claim --output json --market-address 0x... --execute
```

## Pari-mutuel markets

Pari-mutuel markets work differently from AMM markets:
- Buy via `trade` is supported
- `sell` is **not available** — positions are held until resolution
- Quote fields show pool composition (`poolYes`, `poolNo`, `sharePct`, `payoutIfWin`)
- Use `portfolio` and `claim` for exit

## Cross-venue arbitrage

```bash
pandora arb scan --output json --source polymarket --iterations 1
```

Finds price differences between Pandora and Polymarket. Execution is manual (two separate platforms).

## Related docs

- Detailed trading workflows: [`trading-workflows.md`](./trading-workflows.md)
- Portfolio and closeout: [`portfolio-closeout.md`](./portfolio-closeout.md)
- Full flag reference: [`command-reference.md`](./command-reference.md)
