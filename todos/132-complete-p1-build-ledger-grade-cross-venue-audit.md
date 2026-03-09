---
status: complete
priority: p1
issue_id: "132"
tags: [mirror, pnl, accounting, audit, ledger, il]
dependencies: ["120", "127", "130", "131"]
---

# Build ledger-grade cross-venue audit

## Problem Statement

`mirror pnl` exists, but it is still an operator estimate built from live state, cumulative fee/cost approximations, and current inventory marks. It does not replace the manual cross-venue audit we performed across Ethereum trades, Polygon trades, funding flows, gas, and LP impermanent loss. That accounting gap remains one of the most important missing pieces in the product.

## Findings

- [`cli/lib/mirror_handlers/pnl.cjs`](../cli/lib/mirror_handlers/pnl.cjs) routes `mirror pnl` through the same live scenario model used by `mirror status --with-live`.
- [`cli/pandora.cjs`](../cli/pandora.cjs) computes `netPnlApproxUsdc` as cumulative LP fees minus cumulative hedge cost, then adds marked Polymarket inventory. This is explicitly approximate.
- [`docs/skills/mirror-operations.md`](../docs/skills/mirror-operations.md) says current PnL fields are not realized closeout proceeds, a full cross-chain trade ledger, or tax-ready accounting.
- [`cli/lib/mirror_replay_service.cjs`](../cli/lib/mirror_replay_service.cjs) compares modeled versus actual execution amounts from the audit log, but it does not reconcile on-chain settlements, Polymarket fills, or IL.
- [`cli/lib/mirror_sync/execution.cjs`](../cli/lib/mirror_sync/execution.cjs) already writes classified audit entries for sync actions, Pandora rebalances, and Polymarket hedges; this is a good seed for a normalized ledger but not the whole answer.
- Polymarket's public APIs expose current positions, closed positions, user activity, accounting snapshots, and market trade history that can enrich realized/unrealized attribution. Sources: [Polymarket Data API overview](https://docs.polymarket.com/developers/misc-endpoints/data-api-%2A), [User activity](https://docs.polymarket.com/api-reference/core/get-user-activity), [Accounting snapshot](https://docs.polymarket.com/api-reference/misc/download-an-accounting-snapshot-zip-of-csvs)
- Historical reserve tracing from issue `130` is needed to compute LP mark changes and impermanent-loss attribution without another custom script.

## Proposed Solutions

### Option 1: Extend the existing mirror ledger into a reconciled accounting service

**Approach:** Build a normalized ledger that joins Pandora receipts/history, Polymarket trades/activity/positions, funding events, gas, and traced reserve snapshots, then promote that model into `mirror audit` and `mirror pnl`.

**Pros:**
- Keeps the canonical user surface in existing commands
- Reuses current audit classifications and selector-first behavior
- Makes exports and future analytics consistent

**Cons:**
- Largest implementation scope in this batch
- Requires careful schema design and fixture coverage

**Effort:** 3-5 days

**Risk:** Medium

### Option 2: Add a separate `mirror accounting` command first

**Approach:** Leave existing PnL surfaces approximate and add a new advanced ledger-grade command.

**Pros:**
- Lower risk of breaking operator dashboards
- Easier to iterate behind a narrower contract

**Cons:**
- Splits the truth across two overlapping commands
- Defers cleanup of the current approximate story

**Effort:** 2-4 days

**Risk:** Medium

### Option 3: Export-only accounting pipeline

**Approach:** Produce CSV/JSON exports but no richer command surface.

**Pros:**
- Lowest product-surface risk

**Cons:**
- Still pushes core operator work into spreadsheets and custom analysis
- Leaves the original user complaint unresolved

**Effort:** 1-2 days

**Risk:** High

## Recommended Action

Use Option 1, staged in two passes:

1. Build a reconciled ledger service and expose it via `mirror audit --reconciled`
2. Promote validated summary fields into `mirror pnl`, keeping the existing approximate fields only until the reconciled model fully replaces them

This preserves current UX while moving the source of truth toward a ledger-grade accounting model.

## Surface Contract

- Do not introduce a separate long-lived `mirror accounting` command if the existing `mirror audit` and `mirror pnl` surfaces can carry the reconciled model.
- `mirror audit` should become the canonical ledger-grade cross-venue audit surface.
  - target semantics: normalized venue/funding/gas/IL ledger rows, deterministic provenance, and reconciliation status
  - rollout requirement: current operational/classified ledger wording must clearly say when the surface is still pre-reconciled
- `mirror pnl` should become the canonical summarized accounting surface built from that reconciled ledger.
  - target semantics: realized PnL, unrealized mark-to-market, LP fees, impermanent loss, gas, and funding effects separated explicitly
  - rollout requirement: current approximate scenario fields must stay labeled as approximate until the reconciled model replaces them
- Docs, schema descriptions, and agent contract text should treat `mirror audit` and `mirror pnl` as the durable public accounting surfaces, with no ambiguity about approximate-vs-reconciled status during rollout.

## Technical Details

**Likely files:**
- [`cli/lib/mirror_surface_service.cjs`](../cli/lib/mirror_surface_service.cjs)
- [`cli/lib/mirror_replay_service.cjs`](../cli/lib/mirror_replay_service.cjs)
- [`cli/lib/mirror_sync/execution.cjs`](../cli/lib/mirror_sync/execution.cjs)
- [`cli/lib/history_service.cjs`](../cli/lib/history_service.cjs)
- [`cli/lib/export_service.cjs`](../cli/lib/export_service.cjs)
- [`cli/lib/operation_receipt_store.cjs`](../cli/lib/operation_receipt_store.cjs)
- [`docs/skills/mirror-operations.md`](../docs/skills/mirror-operations.md)
- [`docs/skills/portfolio-closeout.md`](../docs/skills/portfolio-closeout.md)
- [`tests/unit/mirror_replay_service.test.cjs`](../tests/unit/mirror_replay_service.test.cjs)
- [`tests/cli/mirror_replay.integration.test.cjs`](../tests/cli/mirror_replay.integration.test.cjs)

**Implementation notes:**
- Normalize ledger rows by venue, leg type, tx hash, nonce, block/time, quantity, notional, fees, gas, and source
- Separate realized PnL, unrealized mark-to-market, LP fee income, IL, funding/bridge flows, and gas
- Reconcile Pandora trades from receipts/history rather than trusting only planned amounts
- Reconcile Polymarket from activity/trades plus current and closed positions
- Keep export schemas stable, but add explicit ledger-grade columns instead of only display fields

## Resources

- Polymarket Data API overview: [https://docs.polymarket.com/developers/misc-endpoints/data-api-%2A](https://docs.polymarket.com/developers/misc-endpoints/data-api-%2A)
- User activity: [https://docs.polymarket.com/api-reference/core/get-user-activity](https://docs.polymarket.com/api-reference/core/get-user-activity)
- Accounting snapshot: [https://docs.polymarket.com/api-reference/misc/download-an-accounting-snapshot-zip-of-csvs](https://docs.polymarket.com/api-reference/misc/download-an-accounting-snapshot-zip-of-csvs)
- Current positions: [https://docs.polymarket.com/api-reference/core/get-current-positions-for-a-user](https://docs.polymarket.com/api-reference/core/get-current-positions-for-a-user)
- Closed positions: [https://docs.polymarket.com/api-reference/core/get-closed-positions-for-a-user](https://docs.polymarket.com/api-reference/core/get-closed-positions-for-a-user)

## Acceptance Criteria

- [x] A normalized reconciled ledger exists for Pandora, Polymarket, and funding/gas legs
- [x] `mirror audit` can emit reconciled history with deterministic classification and source provenance
- [x] `mirror pnl` can show realized and unrealized components separately
- [x] LP fee income and impermanent loss are broken out explicitly rather than buried in one approximation
- [x] Cross-chain transaction hashes and timestamps are attached to ledger rows where available
- [x] Export surfaces include ledger-grade fields suitable for downstream accounting or spreadsheets
- [x] Tests cover fixture-based reconciliation across ETH trades, Polygon trades, funding, and reserve traces
- [x] Docs clearly distinguish approximate legacy fields from reconciled accounting outputs during rollout

## Work Log

### 2026-03-09 - Initial research

**By:** Codex

**Actions:**
- Reviewed current PnL and replay implementation paths
- Verified that the current docs intentionally disclaim accounting completeness
- Mapped Polymarket public endpoints that can support realized/unrealized ledger reconciliation

**Learnings:**
- The repo already has the seed of a ledger in the audit store; what is missing is chain/API reconciliation and IL attribution
- This issue should not start until historical reserve tracing and CTF inventory are in place

### 2026-03-09 - Docs and contract framing

**By:** Codex

**Actions:**
- Updated operator docs to describe `mirror audit` as the future reconciled ledger-grade surface and `mirror pnl` as the future summarized accounting surface
- Updated schema/contract wording so agents can distinguish current approximate outputs from the intended reconciled rollout

**Learnings:**
- The product surface should stay on `mirror audit` + `mirror pnl`; the real gap is accounting rigor, not command proliferation

### 2026-03-09 - Implemented reconciled ledger surfaces

**By:** Codex

**Actions:**
- Extended `mirror pnl` and `mirror audit` with a shared reconciled ledger attachment that carries normalized rows, component breakouts, provenance, and export-ready rows
- Preserved `state.accounting` in state loading and wired audit-log, accounting-row, and reserve-trace inputs into the reconciled builder
- Kept `mirror audit` deterministic by preventing it from synthesizing ledger rows from live-only marks and counters
- Expanded export and replay compatibility for ledger-grade rows, transaction/order ref hygiene, and explicit ignored-row diagnostics
- Updated contract/schema/docs/help text so `--reconciled` is machine-discoverable and operator-facing surfaces describe the rollout accurately

**Learnings:**
- The main correctness risks were stale completeness metadata, duplicate counting across accounting rows plus audit-log reconstruction, and treating order refs as transaction hashes
- Export compatibility needs an explicit schema bump whenever ledger columns widen; otherwise downstream consumers cannot distinguish the contract change

### 2026-03-09 - Audit and verification pass

**By:** Codex

**Actions:**
- Ran a six-agent audit pass across core ledger math, parser/help wiring, docs/contracts, and replay/export compatibility
- Fixed audit findings around dedupe, completeness derivation, live-only audit rows, transaction-hash hygiene, schema discoverability, docs drift, and Polymarket positions usage contracts
- Regenerated SDK contract artifacts with `npm run generate:sdk-contracts`
- Verified with:
  - `node --test tests/unit/mirror_surface_service.test.cjs tests/unit/mirror_replay_service.test.cjs tests/unit/export_service.test.cjs tests/unit/agent_contract_registry.test.cjs tests/unit/sdk_contract_service.test.cjs tests/unit/docs_skills_drift.test.cjs`
  - `node --test tests/cli/cli.integration.test.cjs tests/cli/mirror_replay.integration.test.cjs`

**Learnings:**
- The full CLI suite was necessary; it caught a residual help/descriptor mismatch and a mistaken test expectation in the history/export area that targeted tests missed
- `mirror audit --reconciled` and `mirror pnl --reconciled` are now stable public rollout surfaces, but runtime producers for richer persisted accounting inputs remain the next ceiling on coverage depth
