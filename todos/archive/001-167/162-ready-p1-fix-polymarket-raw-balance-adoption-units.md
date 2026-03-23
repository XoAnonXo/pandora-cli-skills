---
status: ready
priority: p1
issue_id: "162"
tags: [mirror, polymarket, daemon, accounting, tests]
dependencies: []
---

# Fix Polymarket Raw Balance Adoption Units

## Problem Statement

Mirror live adoption can persist Polymarket inventory in raw base units instead of display-share units. When that happens, the daemon seeds `managedPolymarketYesShares` / `managedPolymarketNoShares` with values like `50,000,000` and `250,000,000`, but subsequent live hedge executions only advance state by display-share deltas like `50`. That makes the hedge gap effectively uncloseable and can drive repeated buy loops.

## Findings

- The incident evidence bundle proves the broken state contract:
  - `daemon-state-live.json` shows adopted inventory as `50,000,000 / 250,000,000` and `currentHedgeShares = -199998850`
  - the same live state shows the hedge leg only applying `stateDeltaUsdc: 50`
  - the live audit log shows repeated YES hedge buys with the same `stateDeltaUsdc: 50`
- The likely fault path is upstream of adoption itself:
  - `cli/lib/polymarket_trade_adapter.cjs` trusts `row.size` / `row.balance` directly in `extractPositionBalance`
  - `normalizePositionBalanceEntry` prefers an existing numeric `entry.balance` over formatting `balanceRaw`
  - if an API or authenticated CLOB payload supplies base-unit-sized balances in `balance`, adoption faithfully persists the wrong units as shares
- Current adoption coverage only exercises normalized share inputs and would not catch a `50,000,000` style payload.

## Proposed Solutions

### Option 1: Normalize all Polymarket balance surfaces to display-share units before adoption

**Approach:** Harden the Polymarket position parsing path so raw/base-unit payloads are converted into display-share values before inventory summary construction, then keep adoption state strictly share-denominated end to end.

**Pros:**
- Fixes the live failure mode directly
- Preserves current operator workflow and adoption surface
- Aligns accounting, hedge deltas, and diagnostics around one unit contract

**Cons:**
- Requires careful handling of mixed payload shapes from API, authenticated CLOB, and on-chain fallback reads

**Effort:** 3-5 hours

**Risk:** Medium

---

### Option 2: Fail closed when balance payloads look raw-sized or internally inconsistent

**Approach:** Add sanity checks around adoption so suspicious balance magnitudes or unit mismatches block live adoption and require operator review.

**Pros:**
- Reduces blast radius even if normalization is incomplete
- Easier to implement as a first safety net

**Cons:**
- Leaves the underlying normalization defect unresolved
- Can block legitimate runs unless heuristics are chosen carefully

**Effort:** 1-2 hours

**Risk:** Medium

## Recommended Action

Implement Option 1 and keep a narrow fail-closed guard from Option 2 where it is cheap and reliable. Normalize API/CLOB balance payloads into display shares before `buildInventorySummary` / adoption state, then add focused regressions using raw-sized balances so the incident class cannot recur silently.

## Technical Details

**Affected files:**
- `cli/lib/polymarket_trade_adapter.cjs`
- `cli/lib/mirror_sync_service.cjs`
- `tests/unit/new-features.test.cjs`
- `tests/unit/polymarket_trade_adapter.test.cjs`
- optionally focused CLI/integration coverage if adoption behavior is exercised there

## Acceptance Criteria

- [ ] Raw/base-unit Polymarket balances from API or authenticated CLOB payloads are normalized into display-share units before inventory adoption
- [ ] `--adopt-existing-positions` seeds `managedInventorySeed`, `managedPolymarketYesShares`, `managedPolymarketNoShares`, and `currentHedgeShares` in share-denominated values, not raw base units
- [ ] Hedge execution deltas and adopted inventory remain in the same unit system during live sync
- [ ] A focused regression test covers a raw-sized input like `50,000,000` and proves adoption stores `50`
- [ ] A focused regression test covers the live accounting path so repeated `stateDeltaUsdc: 50` updates do not operate against raw-sized adopted balances

## Resources

- Evidence bundle:
  - `/Users/mac/Desktop/evidence/daemon-state-live.json`
  - `/Users/mac/Desktop/evidence/daemon-state-stale.json.bak`
  - `/Users/mac/Desktop/evidence/daemon-audit-live.jsonl`
- Related review findings:
  - `cli/lib/polymarket_trade_adapter.cjs:1934`
  - `tests/unit/new-features.test.cjs:5832`

## Work Log

### 2026-03-18 - Initial Triage

**By:** Codex

**Actions:**
- Audited the evidence bundle for the Real Madrid / Manchester City mirror incident
- Confirmed the live and stale state files contain adopted inventory in raw-sized values (`50,000,000 / 250,000,000`) while the live hedge leg only applies `stateDeltaUsdc: 50`
- Traced the likely code path to Polymarket balance normalization and identified the regression-test gap around raw-sized balance inputs

**Learnings:**
- The incident is not just an operator post-mortem claim; the machine evidence proves a unit mismatch between adopted inventory state and subsequent hedge deltas
- The most likely durable fix is to harden Polymarket balance normalization before adoption rather than only patching `--adopt-existing-positions` downstream
