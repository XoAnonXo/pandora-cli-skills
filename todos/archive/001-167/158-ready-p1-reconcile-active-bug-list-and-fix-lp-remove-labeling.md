---
status: ready
priority: p1
issue_id: "158"
tags: [bugs, cli, mcp, lp, claimability, flashbots, amm]
dependencies: []
---

# Reconcile Active Bug List And Fix Remaining LP Remove Labeling Gap

Bring the active bug list back in sync with the current codebase, then verify and fix the remaining `lp remove` preview labeling issue against the affected live market family.

## Problem Statement

The current active bug list is stale.

- `BUG-002`, `BUG-003`, and `BUG-004` are still listed as active even though the core code paths have already been fixed and covered by focused tests.
- `BUG-001` is no longer accurate in its original “claimability invisible across CLI/MCP” wording. Current code now surfaces claimable exposure in multiple discovery paths, but some discovery surfaces still have narrower gaps.
- `BUG-005` is the one item that still looks plausibly active. Current code assumes a fixed `calcRemoveLiquidity` tuple order and lacks live/integration coverage proving the reported collateral/outcome label swap is resolved.

This matters because the bug list is being used operationally. If it is stale, workers and operators will chase already-fixed issues and miss the one remaining high-risk surface.

## Findings

- `BUG-002` should be closed as a code bug. Flashbots runtime validation and route fallback behavior are implemented in `cli/lib/flashbots_service.cjs` and `cli/lib/trade_execution_route_service.cjs`, and focused route tests pass.
- `BUG-003` should be split or closed in its old form. Poll ABI compatibility for `getArbiter()`, bool-status finalized tuples, and modern resolve method selection is implemented in `cli/lib/market_admin_service.cjs`, with targeted regression coverage in `tests/unit/market_admin_resolution_state.test.cjs`.
- `BUG-004` should be closed. Probability-native AMM inputs now exist via `--initial-yes-pct` / `--initial-no-pct`, while the old distribution flags are explicitly documented as reserve weights in parser/help/agent surfaces.
- `BUG-001` is partially stale. Claimable exposure is now surfaced through outcome visibility and owned-market discovery:
  - `cli/lib/market_admin_service.cjs`
  - `cli/lib/markets_mine_service.cjs`
  - `tests/unit/new-features.test.cjs`
- The remaining parts of `BUG-001` that may still be valid are narrower:
  - `scan --resolved` is still indexer-backed, not on-chain
  - `history` still hides seed trades unless `--include-seed` is set
  - `debug market` still summarizes claim events, not claimability state
- `BUG-005` remains the main unresolved issue. `cli/lib/market_admin_service.cjs` still assumes `calcRemoveLiquidity` returns `(collateralOut, yesOut, noOut)` and maps tuple positions directly into preview labels. Current unit coverage in `tests/unit/market_admin_preview.test.cjs` only validates that assumed mapping; it does not prove correctness for the affected live market family.

## Proposed Solutions

### Option 1: Bug List Cleanup Only

**Approach:** Update the active bug list to close `BUG-002`, `BUG-003`, and `BUG-004`, rewrite `BUG-001` more narrowly, and leave `BUG-005` open without further investigation.

**Pros:**
- Fastest path to an accurate status board
- Removes noise from already-fixed bugs

**Cons:**
- Does not resolve the remaining `lp remove` risk
- Leaves the highest-confidence open bug unverified

**Effort:** 30-60 minutes

**Risk:** Medium

---

### Option 2: Reconcile Statuses And Drive A Focused `lp remove` Repro/Fix

**Approach:** First clean up the bug list statuses, then reproduce `BUG-005` against the reported market family or equivalent fixture, fix the preview mapping if needed, and add focused regression coverage.

**Pros:**
- Leaves the active bug list accurate and actionable
- Resolves the remaining likely product bug instead of just rewording it
- Produces durable test coverage for LP remove preview semantics

**Cons:**
- Requires live repro evidence or a faithful fixture
- May uncover ABI variation across market families that needs a broader compatibility layer

**Effort:** 2-5 hours depending on repro availability

**Risk:** Low to Medium

---

### Option 3: Broader Discovery/Claimability Follow-Up Sweep

**Approach:** In addition to Option 2, add a broader worker pass on the remaining `BUG-001` discovery surfaces (`scan`, `history`, `debug market`) to decide whether they warrant a new narrower follow-up issue.

**Pros:**
- Produces a cleaner long-term bug taxonomy
- Catches remaining UX gaps around claimability discovery

**Cons:**
- Broader than the immediate operational need
- Could turn into a second feature pass rather than a bug reconciliation task

**Effort:** 4-8 hours

**Risk:** Medium

## Recommended Action

Take Option 2.

1. Update the bug list so `BUG-002`, `BUG-003`, and `BUG-004` are no longer tracked as active product bugs.
2. Rewrite `BUG-001` as a narrower discovery-gap issue if, after recheck, it still reproduces on specific surfaces.
3. Reproduce `BUG-005` against the original or equivalent market family.
4. If the tuple/order assumption is wrong for that family, fix `calcRemoveLiquidity` preview decoding and user-facing labels in the LP remove path.
5. Add focused regression coverage that proves the corrected preview semantics end-to-end.

## Technical Details

**Affected files:**
- `cli/lib/flashbots_service.cjs`
- `cli/lib/trade_execution_route_service.cjs`
- `cli/lib/market_admin_service.cjs`
- `cli/lib/markets_mine_service.cjs`
- `cli/lib/scan_command_service.cjs`
- `cli/lib/history_service.cjs`
- `cli/lib/debug_command_service.cjs`
- `tests/unit/flashbots_service.test.cjs`
- `tests/unit/trade_execution_route_service.test.cjs`
- `tests/unit/market_admin_resolution_state.test.cjs`
- `tests/unit/market_admin_preview.test.cjs`
- `tests/unit/new-features.test.cjs`

**Likely code path for `BUG-005`:**
- `readCalcRemoveLiquidity()` in `cli/lib/market_admin_service.cjs`
- `buildRemoveLiquidityPreviewPayload()` in `cli/lib/market_admin_service.cjs`
- `lp remove` rendering in CLI output surfaces

**Operational artifact to update:**
- `/Users/mac/Desktop/pandora-bug-list.md`

## Resources

- Bug report: `/Users/mac/Desktop/pandora-bug-list.md`
- Active bug list review notes from 2026-03-16
- Focused tests that already passed during review:
  - `node --test tests/unit/market_admin_preview.test.cjs tests/unit/market_admin_visibility.test.cjs tests/unit/claim_command_service.test.cjs tests/unit/flashbots_service.test.cjs tests/unit/trade_execution_route_service.test.cjs`

## Acceptance Criteria

- [ ] `BUG-002`, `BUG-003`, and `BUG-004` are removed from the active-bug list or explicitly marked resolved with accurate dates/notes.
- [ ] `BUG-001` is either narrowed to the remaining real discovery gap or closed if it no longer reproduces.
- [ ] `BUG-005` is reproduced against the affected market family or a faithful fixture.
- [ ] If `BUG-005` is real, the LP remove preview payload/labels are fixed in code.
- [ ] Focused tests cover the corrected `lp remove` preview semantics.
- [ ] Worker documents whether any remaining claimability discovery gaps should become a separate follow-up todo.

## Work Log

### 2026-03-16 - Active Bug List Review

**By:** Codex

**Actions:**
- Reviewed the current active bug list against the repository state.
- Confirmed AMM probability contract changes are present in parser/help/agent surfaces.
- Confirmed Flashbots route/runtime fixes and regression coverage are present.
- Confirmed poll ABI compatibility fixes for `getArbiter()` / `resolveArbitration()` are present.
- Reviewed claimability-discovery code paths in `market_admin_service.cjs` and `markets_mine_service.cjs`.
- Reviewed LP remove preview decoding in `market_admin_service.cjs`.
- Ran focused verification:
  - `node --test tests/unit/market_admin_preview.test.cjs tests/unit/market_admin_visibility.test.cjs tests/unit/claim_command_service.test.cjs tests/unit/flashbots_service.test.cjs tests/unit/trade_execution_route_service.test.cjs`

**Learnings:**
- The active bug list currently overstates how much claimability is still broken.
- The one bug that still needs concrete market-family validation is LP remove preview labeling.
- `scan`, `history`, and `debug market` may still deserve a smaller follow-up claimability-discovery issue, but they should not be conflated with the old “invisible everywhere” claim.

## Notes

- Treat this as a status-reconciliation todo plus one remaining real bug investigation.
- Do not reopen `BUG-002`, `BUG-003`, or `BUG-004` unless the worker can reproduce a fresh regression on the current tree.
