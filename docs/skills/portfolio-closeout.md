# Portfolio And Closeout

Use this file for wallet-level inspection, claim-all flows, LP exits, mirror closeout, and operation tracking.

## Portfolio inspection

### Unified snapshot
```bash
pandora portfolio --output json --wallet 0x...
```

Useful flags:
- `--with-lp`
- `--all-chains`
- `--include-events`

### Historical activity
```bash
pandora history --output json --wallet 0x... --limit 100
pandora export --output json --wallet 0x... --format json
```

## LP exit workflow

### Single market
```bash
pandora lp remove --output json --market-address 0x... --all --dry-run
```

### All markets
```bash
pandora lp remove --output json --all-markets --all --dry-run
```

Use `--execute` only after the dry-run shows the expected balances and token movement.

## Claim workflow

### Dry-run claim-all
```bash
pandora claim --output json --all --wallet 0x... --dry-run
```

### Execute claim-all
```bash
pandora claim --output json --all --wallet 0x... --execute
```

## Mirror closeout

For mirrored markets, prefer the dedicated closeout surface:

```bash
pandora mirror close --output json \
  --pandora-market-address 0x... \
  --polymarket-market-id <id> \
  --dry-run
```

`mirror close` is the deterministic operator workflow for:
- daemon stop
- LP withdrawal
- claim/redeem eligibility inspection
- closeout summary

It is not a cross-venue atomic close.
- the command runs `stop-daemons`, `withdraw-lp`, then `claim-winnings`
- remaining Polymarket hedge inventory or settlement stays manual in this command version
- use `lp simulate-remove --market-address <0x...> --all` when you want a dedicated LP-removal preview before executing
- use `mirror pnl` for the canonical accounting-summary surface and `mirror audit` for the canonical ledger surface
  - the default fields still expose approximate/operator P&L and operational/classified audit history
  - add `--reconciled` on those same two commands when you want the normalized accounting attachment rather than moving to a separate closeout-only accounting command
- `mirror close`, `mirror status --with-live`, `mirror pnl`, and `mirror audit` are operator surfaces, not tax-ready accounting exports

## Operations tracking

Use operations for persisted mutable workflows:

```bash
pandora operations list --output json --limit 20
pandora operations get --output json --id <operation-id>
pandora operations cancel --output json --id <operation-id>
pandora operations close --output json --id <operation-id>
```

Use this when an agent needs:
- resumability
- status polling
- cancellation
- explicit checkpoint visibility

Terminal mutable operations also emit a durable receipt artifact beside the operation state store:
- local CLI:
  - `~/.pandora/operations/<operation-id>.receipt.json`
- MCP/workspace-guarded runtime:
  - `./.pandora/operations/<operation-id>.receipt.json`

Use the receipt when you need:
- a tamper-evident post-execution record
- checkpoint digest verification
- an audit artifact that complements release verification and benchmark evidence

If you are operating through a hosted remote gateway, confirm receipt-routing support through `bootstrap`, `capabilities`, `schema`, or remote `/tools` before assuming a public receipt endpoint is enabled.

## Closeout order of operations
1. inspect `portfolio`
2. inspect `operations`
3. dry-run `claim --all`
4. dry-run `lp remove --all-markets`
5. dry-run `mirror close` for mirrored positions
6. execute only the flows that are actually claimable or withdrawable

## Resolve and claim runbook for mirrors

`mirror close` does not auto-resolve Pandora and does not auto-redeem Polymarket inventory.

### 1. Inspect the final operator dashboard
```bash
pandora mirror status --output json --strategy-hash <hash> --with-live
pandora mirror pnl --output json --strategy-hash <hash>
pandora mirror audit --output json --strategy-hash <hash> --with-live
pandora polymarket balance --output json --funder <proxy-wallet>
pandora polymarket positions --output json --funder <proxy-wallet> --condition-id <condition_id> --source auto
```

Interpret those closeout accounting surfaces carefully:
- `mirror pnl --reconciled` is the current accounting-summary attachment
- `mirror audit --reconciled` is the current ledger-grade audit attachment
- keep `history`, `export`, receipts, and token inventory checks in the loop when either command reports `reconciliation.mode = partial` or non-empty `reconciliation.missing`

### 2. Wait for Pandora finalization with prechecks instead of guessing
```bash
pandora resolve --output json \
  --poll-address 0x... \
  --answer yes \
  --reason "Official final result" \
  --dry-run \
  --watch
```

Use this when `resolve` is still too early. The dry-run precheck is the current surface for finalization progress such as remaining epochs and claimability.

### 3. Promote to execute once the market becomes executable
```bash
pandora resolve --output json \
  --poll-address 0x... \
  --answer yes \
  --reason "Official final result" \
  --execute \
  --watch
```

### 4. Claim after resolution
```bash
pandora claim --output json --market-address 0x... --dry-run
pandora claim --output json --market-address 0x... --execute
```

### 5. Finish Polygon-side cleanup separately
- use `pandora polymarket balance` to confirm whether the proxy or signer still holds USDC.e or outcome tokens
- use `pandora polymarket withdraw --amount-usdc <n>` when you need a preview of moving remaining proxy collateral back to the signer; if the proxy differs from the signer, follow the dry-run plan and execute the ERC20 transfer from the proxy wallet manually
- use venue-native redemption flows when the remaining work is Polymarket token settlement rather than Pandora claim

## Related docs
- buy/sell workflows:
  - [`trading-workflows.md`](./trading-workflows.md)
- mirror-specific workflow:
  - [`mirror-operations.md`](./mirror-operations.md)
- contract and MCP semantics:
  - [`agent-interfaces.md`](./agent-interfaces.md)
