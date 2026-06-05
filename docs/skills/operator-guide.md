# Operator Guide

This guide is for users who deploy prediction markets, run mirroring daemons, manage hedging, and handle market lifecycle. If you are trading on existing markets instead, see the [Trader Guide](./trader-guide.md).

## What an operator does

An operator creates prediction markets on Pandora, provides liquidity, mirrors odds from Polymarket, hedges exposure, monitors health, and closes markets at resolution. The operator earns AMM fees from trading volume.

## Command map

| Category | Command | What it does |
|---|---|---|
| **Setup** | `setup --interactive` | Guided environment setup |
| | `doctor --goal live-mirror` | Check readiness for a specific goal |
| | `init-env` | Scaffold `.env` file |
| **Market creation** | `markets create plan\|run` | Plan and deploy a new market |
| | `markets hype plan\|run` | Plan and deploy from trending news |
| | `sports create plan\|run` | Plan and deploy a sports market |
| **Mirror lifecycle** | `mirror browse` | Find Polymarket markets to mirror |
| | `mirror plan` | Compute deployment parameters |
| | `mirror deploy --dry-run\|--execute` | Deploy a mirror market on Pandora |
| | `mirror verify` | Verify market pair alignment |
| | `mirror go` | One-command deploy + sync |
| | `mirror sync once\|run\|start` | Run the mirroring daemon |
| | `mirror close` | Close a mirror market |
| **Mirror monitoring** | `mirror dashboard` | Active mirror summary |
| | `mirror status` | Detailed state of one mirror |
| | `mirror health` | Health check |
| | `mirror drift` | Current drift from source |
| | `mirror hedge-check` | Hedge gap readiness |
| | `mirror pnl` | Profit and loss breakdown |
| | `mirror audit` | Full audit report |
| | `mirror panic` | Emergency stop |
| **Hedge** | `mirror hedge` | Polymarket Hedge Mode daemon |
| | `mirror calc --target-pct 55` | Sizing calculator |
| | `mirror hedge-calc` | Offline hedge inventory calculator |
| | `mirror sync unlock` | Clear a stuck pending-action lock |
| **Polymarket ops** | `polymarket check` | Readiness check |
| | `polymarket approve` | Approve USDC spending |
| | `polymarket preflight` | Pre-trade validation |
| | `polymarket balance` | Polygon USDC.e collateral |
| | `polymarket positions` | CTF YES/NO inventory |
| | `polymarket deposit\|withdraw` | Fund management |
| **Sports** | `sports sync once\|run\|start\|stop\|status` | Sports odds sync daemon |
| | `sports schedule\|scores\|books list` | Sports data queries |
| | `sports resolve plan` | Plan sports resolution |
| | `odds record` | Record price history |
| | `odds history` | Query recorded prices |
| **Resolve** | `resolve --dry-run\|--execute` | Submit market resolution |
| **Risk / ops** | `risk show\|panic` | Risk surface and emergency stop |
| | `fund-check` | Shortfall analysis + suggested commands |
| | `dashboard` | Cross-market summary |
| | `operations list\|get\|receipt` | Durable operation tracking |
| | `explain <error-code>` | Error code lookup |

## Key workflows

### Deploy and mirror a market

```text
1. Browse    -->  2. Plan  -->  3. Deploy  -->  4. Verify  -->  5. Sync
   mirror browse     mirror plan   mirror deploy   mirror verify   mirror sync start
```

The fast path: `mirror go` combines deploy + verify + sync in one command.

```bash
pandora mirror go \
  --polymarket-slug "will-x-happen" \
  --liquidity-usdc 500 \
  --auto-sync \
  --execute-live
```

### Monitor health

```bash
pandora mirror dashboard --with-live
pandora mirror drift --strategy-hash abc123
pandora mirror hedge-check --strategy-hash abc123
pandora mirror pnl --strategy-hash abc123
```

### Close a market

```bash
pandora resolve --output json \
  --poll-address 0x... \
  --answer yes \
  --reason "Event confirmed by source" \
  --execute

pandora mirror close --strategy-hash abc123
```

## Safety features

The daemon has built-in safety layers:

| Feature | Flag | What it does |
|---|---|---|
| **Auto-withdraw** | `--auto-withdraw-on-expiry` | Withdraws LP tokens before market expires |
| **Hedge retry** | `--hedge-retry-count 3` | Retries failed hedges with exponential backoff |
| **Hedge gap alert** | `--hedge-gap-alert-usdc 50` | Webhook when unhedged exposure exceeds threshold |
| **Emergency withdrawal** | `--hedge-gap-critical-usdc 200` | Auto-withdraws all LP tokens on critical gap |
| **Slippage alert** | `--hedge-slippage-alert-usdc 5` | Webhook when per-trade slippage is excessive |
| **Net P&L tracking** | Automatic | Alerts when cumulative slippage exceeds earned fees |
| **Kill switch** | `--kill-switch-file <path>` | Touch file to stop daemon gracefully |

## Operating modes

| Mode | Command | Use case |
|---|---|---|
| **Pandora Mirroring** | `mirror sync --no-hedge` | Keep Pandora odds aligned to Polymarket, no hedging |
| **Polymarket Hedge** | `mirror hedge` | Stay delta-neutral on Polymarket, earn Pandora fees |
| **Hybrid** | `mirror sync` (default) | Rebalance Pandora + hedge on Polymarket |
| **Paper mode** | `--paper` or `--dry-run` | Simulate everything, no live execution |
| **Live mode** | `--execute-live` or `--execute` | Real transactions on both venues |

## Related docs

- Detailed mirror operations: [`mirror-operations.md`](./mirror-operations.md)
- Policy and profiles: [`policy-profiles.md`](./policy-profiles.md)
- Setup and onboarding: [`setup-and-onboarding.md`](./setup-and-onboarding.md)
- Full flag reference: [`command-reference.md`](./command-reference.md)
