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

## Related docs
- buy/sell workflows:
  - [`trading-workflows.md`](./trading-workflows.md)
- mirror-specific workflow:
  - [`mirror-operations.md`](./mirror-operations.md)
- contract and MCP semantics:
  - [`agent-interfaces.md`](./agent-interfaces.md)
