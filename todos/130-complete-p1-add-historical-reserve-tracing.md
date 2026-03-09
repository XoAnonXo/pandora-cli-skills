---
status: complete
priority: p1
issue_id: "130"
tags: [mirror, tracing, onchain, archive, replay]
dependencies: ["118"]
---

# Add historical reserve tracing

## Problem Statement

The CLI can refresh Pandora reserves from latest on-chain balances during live sync, but it still cannot answer the postmortem question "what were the pool reserves at block N, N+1, N+2..." without custom scripts. That leaves reserve forensics, LP attribution, and replay-grade research outside the shipped product.

## Findings

- [`cli/lib/mirror_sync/reserve_source.cjs`](../cli/lib/mirror_sync/reserve_source.cjs) reads outcome-token balances and `tradingFee`, but only against the latest state of the configured RPC. No `blockNumber` or `blockTag` is threaded through the reserve read path.
- [`cli/lib/mirror_replay_service.cjs`](../cli/lib/mirror_replay_service.cjs) replays modeled versus executed spend from the audit log, but it does not re-sample historical chain state.
- [`docs/skills/mirror-operations.md`](../docs/skills/mirror-operations.md) documents reserve provenance for live sync only. There is no canonical read-only tracing command.
- Viem's `readContract` API supports `blockNumber` and `blockTag`, so the repo can do historical reads without custom raw-RPC encoding. Source: [Viem readContract](https://viem.sh/docs/contract/readContract)
- Geth's `eth_call` documentation states calls against blocks older than 128 only work on archive nodes, and the archive docs explain the historical-state requirement. Sources: [Geth eth namespace](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-eth), [Geth archive mode](https://geth.ethereum.org/docs/fundamentals/archive), [Geth sync modes](https://geth.ethereum.org/docs/fundamentals/sync-modes)

## Proposed Solutions

### Option 1: Add a reusable historical-state service and canonical trace command

**Approach:** Introduce a block-aware reserve reader plus a read-only `mirror trace` command that samples reserves over a block range or explicit block list.

**Pros:**
- Reusable by postmortems, accounting, replay, and future analytics
- Keeps the historical read path first-class and machine-readable
- Makes archive-node requirements explicit in one place

**Cons:**
- Requires new CLI surface, parser work, and tests
- Needs careful handling of block ranges, timestamps, and RPC failure modes

**Effort:** 1-2 days

**Risk:** Medium

### Option 2: Hide historical reads inside `mirror replay`

**Approach:** Extend replay only, with no standalone trace surface.

**Pros:**
- Smaller surface-area change
- Useful for immediate replay work

**Cons:**
- Repeats the current "custom script" problem under a different name
- Harder to reuse from accounting and operator workflows

**Effort:** 0.5-1 day

**Risk:** Medium

### Option 3: Approximate history from indexer snapshots only

**Approach:** Rely on recorded verify payloads and action logs instead of historical RPC state.

**Pros:**
- Lowest implementation cost

**Cons:**
- Does not solve the actual postmortem requirement
- Cannot support reserve-grounded IL or block-by-block analysis

**Effort:** 0.5 day

**Risk:** High

## Recommended Action

Use Option 1.

Add a block-aware historical read service, then expose it through a canonical `mirror trace` read-only command. The service should accept a market address plus either a block range with `--step`, a list of explicit blocks, or a timestamp-to-block resolver when available. Fail closed when the selected RPC cannot serve the requested state history.

## Technical Details

**Likely files:**
- [`cli/lib/mirror_sync/reserve_source.cjs`](../cli/lib/mirror_sync/reserve_source.cjs)
- [`cli/lib/mirror_command_service.cjs`](../cli/lib/mirror_command_service.cjs)
- [`cli/lib/agent_contract_registry.cjs`](../cli/lib/agent_contract_registry.cjs)
- [`docs/skills/mirror-operations.md`](../docs/skills/mirror-operations.md)
- [`docs/skills/command-reference.md`](../docs/skills/command-reference.md)
- [`tests/unit/new-features.test.cjs`](../tests/unit/new-features.test.cjs)
- [`tests/cli/cli.integration.test.cjs`](../tests/cli/cli.integration.test.cjs)

**Implementation notes:**
- Add a block-aware helper rather than duplicating `eth_call` wiring in handlers
- Return block number, block hash when available, timestamp, reserveYes, reserveNo, derived yesPct, feeTier, and source metadata
- Detect archive insufficiency distinctly from generic RPC failure
- Thread traced snapshots into replay/accounting work as an optional input instead of recomputing later

## Resources

- Viem historical contract reads: [https://viem.sh/docs/contract/readContract](https://viem.sh/docs/contract/readContract)
- Geth `eth_call` historical-state limits: [https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-eth](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-eth)
- Geth archive mode: [https://geth.ethereum.org/docs/fundamentals/archive](https://geth.ethereum.org/docs/fundamentals/archive)
- Geth sync-mode historical state retention: [https://geth.ethereum.org/docs/fundamentals/sync-modes](https://geth.ethereum.org/docs/fundamentals/sync-modes)

## Acceptance Criteria

- [x] A canonical read-only reserve tracing surface exists for historical block sampling
- [x] The service accepts a market plus block range or explicit block list and returns structured reserve snapshots
- [x] Payloads include reserve values, derived price, fee tier, block metadata, and RPC provenance
- [x] Archive-node insufficiency returns a distinct, operator-actionable error
- [x] `mirror replay` and later accounting code can consume traced snapshots without duplicating RPC logic
- [x] Unit and CLI tests cover happy-path reads, fallback RPCs, and archive-missing failures
- [x] Docs explain that deep history requires archive-capable RPC infrastructure

## Work Log

### 2026-03-09 - Initial research

**By:** Codex

**Actions:**
- Confirmed latest-only reserve reads in the current sync reserve service
- Verified that replay does not re-query historical state
- Checked official Viem and Geth docs for historical read support and archive limits

**Learnings:**
- The repo is technically close: it already knows how to read the right contracts, it just does not expose block-aware state queries
- This work is a prerequisite for ledger-grade IL analysis

### 2026-03-09 - Implementation, audit, and verification

**By:** Codex

**Actions:**
- Added `mirror trace` end-to-end: parser support, handler wiring, command registration, SDK contract metadata, and operator docs
- Extended [`cli/lib/mirror_sync/reserve_source.cjs`](../cli/lib/mirror_sync/reserve_source.cjs) with historical block-aware reserve tracing, selector metadata, fallback RPC provenance, block metadata, and archive-state error classification
- Fixed audit findings from the six-agent validation pass:
  - reject unsupported named block tags instead of silently falling back to latest-state reads
  - treat named tags like `safe` and `finalized` as non-archive selectors
  - allow block `0` and descending ranges in the CLI parser
  - apply `--limit` before the 1000-snapshot expansion guard for range traces
  - preserve explicit-block versus range selector semantics in emitted payloads
  - publish a typed `MirrorTracePayload` contract instead of leaving the surface generic
- Regenerated the shared SDK artifacts after contract changes
- Ran targeted verification:
  - `node --test tests/unit/new-features.test.cjs`
  - `node --test tests/unit/agent_contract_registry.test.cjs tests/unit/sdk_contract_service.test.cjs tests/unit/docs_skills_drift.test.cjs`
  - `node --test --test-name-pattern 'generated SDK contract bundle stays in parity with live schema and capabilities commands|mirror trace --help json includes historical reserve tracing usage and archive notes|mirror trace returns structured historical reserve snapshots for explicit block lists|mirror trace range sampling honors step and limit while preserving the requested selector|mirror trace fails with an explicit archive-state error when historical reserves are unavailable|mirror trace preserves generic rpc failures instead of relabeling them as archive errors' tests/cli/cli.integration.test.cjs`

**Learnings:**
- Contract parity tests were useful, but they did not initially catch malformed `oneOf` schema branches for the new command; explicit trace-schema assertions are now in place
- Operator-facing historical-read tooling needs two separate concepts in the payload: the selector used and whether archive infrastructure may be needed
- The reusable trace service is now in place for later replay/accounting consumers without requiring duplicated historical RPC wiring
