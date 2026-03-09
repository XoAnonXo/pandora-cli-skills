---
status: complete
priority: p1
issue_id: "131"
tags: [polymarket, ctf, positions, inventory, erc1155]
dependencies: ["121"]
---

# Add Polymarket CTF position inventory

## Problem Statement

`polymarket balance` currently answers the funding question "how much USDC.e is available?", but it does not answer the position question "how many YES/NO shares does this wallet hold?". Operators still need raw ERC1155 calls or the Polymarket APIs to inspect CTF inventory, which makes closeout, hedge validation, and postmortem accounting harder than it should be.

## Findings

- [`cli/lib/polymarket_ops_service.cjs`](../cli/lib/polymarket_ops_service.cjs) implements `runPolymarketBalance` strictly as USDC.e balance snapshots for signer, funder, and owner roles.
- [`cli/lib/polymarket_trade_adapter.cjs`](../cli/lib/polymarket_trade_adapter.cjs) already knows how to build a market-scoped position summary by reading conditional token balances and open orders, but that logic is only used indirectly by mirror status/PnL.
- The Polymarket Data API exposes current positions, market positions, closed positions, total value, and user activity with `asset`, `conditionId`, `size`, `cashPnl`, `realizedPnl`, and related fields. Sources: [Current positions](https://docs.polymarket.com/api-reference/core/get-current-positions-for-a-user), [Market positions](https://docs.polymarket.com/api-reference/core/get-positions-for-a-market), [Closed positions](https://docs.polymarket.com/api-reference/core/get-closed-positions-for-a-user), [User activity](https://docs.polymarket.com/api-reference/core/get-user-activity), [Accounting snapshot](https://docs.polymarket.com/api-reference/misc/download-an-accounting-snapshot-zip-of-csvs)
- The Conditional Tokens contract represents positions as ERC-1155 tokens indexed by position IDs, and exposes standard balance transfer/query semantics. Source: [Conditional Tokens developer guide](https://conditional-tokens.readthedocs.io/en/latest/developer-guide.html)
- The Polymarket docs also distinguish Gamma discovery, Data API analytics, and CLOB trading/auth paths, which fits a hybrid source model. Source: [Polymarket API introduction](https://docs.polymarket.com/api-reference)

## Proposed Solutions

### Option 1: Add a new `polymarket positions` command with hybrid sourcing

**Approach:** Keep `polymarket balance` focused on funding, and add a dedicated `polymarket positions` surface that can read from API, on-chain CTF balances, or both.

**Pros:**
- Clear contract boundary between funding and inventory
- Lets operators choose `auto`, `api`, or `on-chain`
- Reuses existing position-summary logic

**Cons:**
- Adds a new command family member and generated contract surface

**Effort:** 1-2 days

**Risk:** Medium

### Option 2: Extend `polymarket balance` with `--include-ctf`

**Approach:** Keep one command and widen its output.

**Pros:**
- Smaller visible surface area

**Cons:**
- Mixes collateral and inventory semantics
- Makes funding payloads noisier for automation

**Effort:** 1 day

**Risk:** Medium

### Option 3: API-only inventory surface

**Approach:** Depend entirely on public Data API or authenticated CLOB reads for positions.

**Pros:**
- Faster implementation
- Richer PnL fields available immediately

**Cons:**
- No raw on-chain fallback
- Harder to trust when external APIs are stale or filtered

**Effort:** 0.5-1 day

**Risk:** High

## Recommended Action

Use Option 1.

Add `polymarket positions` as the canonical inventory surface. Default to `--source auto`: use public Polymarket APIs for metadata, open orders, and PnL enrichment when available; fall back to raw CTF balance reads when only token IDs and RPC are available. Keep `polymarket balance` narrowly focused on collateral/funding readiness.

## Technical Details

**Likely files:**
- [`cli/lib/polymarket_command_service.cjs`](../cli/lib/polymarket_command_service.cjs)
- [`cli/lib/polymarket_ops_service.cjs`](../cli/lib/polymarket_ops_service.cjs)
- [`cli/lib/polymarket_trade_adapter.cjs`](../cli/lib/polymarket_trade_adapter.cjs)
- [`cli/lib/parsers/polymarket_flags.cjs`](../cli/lib/parsers/polymarket_flags.cjs)
- [`cli/lib/agent_contract_registry.cjs`](../cli/lib/agent_contract_registry.cjs)
- [`docs/skills/command-reference.md`](../docs/skills/command-reference.md)
- [`docs/skills/mirror-operations.md`](../docs/skills/mirror-operations.md)
- [`tests/unit/new-features.test.cjs`](../tests/unit/new-features.test.cjs)
- [`tests/cli/cli.integration.test.cjs`](../tests/cli/cli.integration.test.cjs)

**Implementation notes:**
- Reuse existing position-summary normalization instead of creating another position schema
- Support selectors by wallet, proxy wallet, market/condition ID, slug, and explicit token IDs
- Include source provenance for each field: API, authenticated CLOB, raw on-chain, or mixed
- Ensure the new command can operate without private trading credentials when public data is enough

## Resources

- Polymarket API introduction: [https://docs.polymarket.com/api-reference](https://docs.polymarket.com/api-reference)
- Current positions: [https://docs.polymarket.com/api-reference/core/get-current-positions-for-a-user](https://docs.polymarket.com/api-reference/core/get-current-positions-for-a-user)
- Market positions: [https://docs.polymarket.com/api-reference/core/get-positions-for-a-market](https://docs.polymarket.com/api-reference/core/get-positions-for-a-market)
- Closed positions: [https://docs.polymarket.com/api-reference/core/get-closed-positions-for-a-user](https://docs.polymarket.com/api-reference/core/get-closed-positions-for-a-user)
- User activity: [https://docs.polymarket.com/api-reference/core/get-user-activity](https://docs.polymarket.com/api-reference/core/get-user-activity)
- Accounting snapshot: [https://docs.polymarket.com/api-reference/misc/download-an-accounting-snapshot-zip-of-csvs](https://docs.polymarket.com/api-reference/misc/download-an-accounting-snapshot-zip-of-csvs)
- Conditional Tokens developer guide: [https://conditional-tokens.readthedocs.io/en/latest/developer-guide.html](https://conditional-tokens.readthedocs.io/en/latest/developer-guide.html)

## Acceptance Criteria

- [x] A canonical `polymarket positions` read surface exists
- [x] The surface can return YES/NO balances, token IDs, condition IDs, open orders, and value estimates for a wallet or market
- [x] Funding balances remain available separately via `polymarket balance`
- [x] Raw on-chain CTF balance fallback works when API enrichment is unavailable
- [x] Output clearly marks which fields came from API versus on-chain reads
- [x] CLI docs, MCP/SDK contracts, and tests are updated for the new surface
- [x] Mirror status/PnL code can call the same normalized inventory service instead of maintaining a private-only path

## Acceptance Notes

- The docs contract now treats `polymarket positions` as the canonical CTF inventory surface and keeps `polymarket balance` scoped to Polygon USDC.e collateral/funding.
- Operator docs now call out `--source auto|api|on-chain`, expected inventory/value/open-order fields, and the requirement to fall back to raw on-chain CTF reads when API enrichment is unavailable.
- The shipped surface is `pandora polymarket positions`, with `auto|api|on-chain` source selection, wallet/market/token selectors, typed SDK contracts, and docs drift coverage.
- `polymarket balance` remains the funding/collateral surface; `polymarket positions` now owns YES/NO inventory and open-order exposure.
- Shared mirror inventory logic now lives behind the Polymarket trade adapter and the public positions surface, rather than a mirror-only private path.

## Work Log

### 2026-03-09 - Initial research

**By:** Codex

**Actions:**
- Confirmed that the current balance command only reads USDC.e
- Traced the existing internal position-summary logic used by mirror surfaces
- Reviewed official Polymarket Data API coverage for positions, activity, and accounting snapshots

**Learnings:**
- Most of the normalization work already exists; the biggest product gap is the lack of a standalone canonical command
- This issue should unblock cleaner hedge validation and feed directly into the full accounting todo

### 2026-03-09 - Docs contract update

**By:** Codex

**Actions:**
- Updated the skill docs to route operators to `polymarket positions` for CTF YES/NO inventory and open-order visibility
- Kept `polymarket balance` documented as the collateral/funding surface for signer and proxy USDC.e
- Added source-mode guidance for `auto`, `api`, and `on-chain`, including on-chain fallback expectations when enrichment is unavailable

**Acceptance progress:**
- Documentation expectations for the new command are now written down
- Runtime implementation, generated contracts, and tests are still pending

### 2026-03-09 - Implementation, verification, and audit pass

**By:** Codex

**Actions:**
- Completed the `polymarket positions` parser, command handler, ops wrapper, and trade-adapter inventory path
- Regenerated SDK/contract artifacts so the new surface is exposed through the shipped descriptors and MCP tool definitions
- Added unit and CLI coverage for parser behavior, mock/API normalization, on-chain fallback, command routing, contract/schema parity, and docs drift
- Ran the same six-agent audit loop used on phase `130`; no additional findings were returned within the review window

**Verification:**
- `npm run generate:sdk-contracts`
- `node --test tests/unit/polymarket_ops_service.test.cjs tests/unit/new-features.test.cjs tests/unit/agent_contract_registry.test.cjs tests/unit/docs_skills_drift.test.cjs`
- `node --test --test-name-pattern 'polymarket positions help advertises source selection and data api controls|polymarket positions returns normalized inventory from a mock payload' tests/cli/cli.integration.test.cjs`

**Learnings:**
- The repo already had partial `polymarket positions` contract/schema stubs; the real missing work was the adapter/ops/command path and fixture-backed verification
- Mock-mode inventory needs to prefer supplied mock open orders over live authenticated reads to keep deterministic fixture behavior
