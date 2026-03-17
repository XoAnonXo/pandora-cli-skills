---
status: ready
priority: p1
issue_id: "160"
tags: [mirror, polymarket, auth, inventory, daemon]
dependencies: []
---

# Fix Mirror Polymarket Profile And Inventory Routing

## Problem Statement

Mirror live flows can still fail or hedge incorrectly when the operator relies on profile-based auth or reusable inventory. The Polymarket leg still depends on raw env credentials in key places, adoption can resolve the wrong account, and sell-side recycling is effectively dead because live depth data is incomplete and freshness is not enforced for the orderbooks used by hedge gating.

## Findings

- Mirror profile selectors currently help the Pandora signer but do not fully propagate into Polymarket inventory lookup and hedge execution.
- `--adopt-existing-positions` omits key auth/runtime context, so it can inspect the wrong account or fail to find inventory.
- Live sell-side recycling depends on `sellYesDepth` / `sellNoDepth`, but the live depth fetcher only provides buy-side depth.
- Depth-based gating can approve hedges from cached or mock orderbooks without freshness guarantees.

## Proposed Solutions

### Option 1: Thread resolved Polymarket execution context through all mirror inventory and hedge paths

**Approach:** Materialize one Polymarket execution context from profile/env/runtime inputs, reuse it for adoption, inventory lookup, and live hedge execution, and extend depth payloads plus freshness checks for sell-side routing.

**Pros:**
- Fixes the live correctness issues directly
- Keeps the current surface area intact
- Provides one coherent execution model

**Cons:**
- Touches several coupled mirror/Polymarket services

**Effort:** 4-6 hours

**Risk:** Medium

---

### Option 2: Disable profile-only mirror hedge flows until full support exists

**Approach:** Fail closed unless raw Polymarket env credentials are provided.

**Pros:**
- Simpler implementation
- Safer than partial support

**Cons:**
- Regresses the intended profile-based product direction
- Does not fix inventory recycling

**Effort:** 1-2 hours

**Risk:** Medium

## Recommended Action

Implement Option 1. Resolve and propagate a single Polymarket auth/runtime context into mirror sync, adoption, and hedge execution; add sell-side orderbook depth plus freshness checks; update docs/tests so profile-based mirror guidance matches reality.

## Technical Details

**Affected files:**
- `cli/lib/mirror_sync_service.cjs`
- `cli/lib/mirror_command_service.cjs`
- `cli/lib/polymarket_trade_adapter.cjs`
- `cli/lib/mirror_sync/execution.cjs`
- `cli/lib/mirror_sync/gates.cjs`
- `docs/skills/mirror-operations.md`
- `tests/unit/new-features.test.cjs`
- `tests/unit/mirror_sync_execution.test.cjs`
- `tests/unit/polymarket_trade_adapter.test.cjs`

## Acceptance Criteria

- [x] Profile-based mirror runs can authenticate the Polymarket leg without raw key env fallbacks
- [x] `--adopt-existing-positions` uses the correct authenticated account context
- [x] Live reusable inventory can route sell-side hedges from real sell depth
- [x] Depth gating rejects stale/mock orderbooks for live hedges
- [x] Focused unit/integration coverage exercises the corrected mirror behavior

## Work Log

### 2026-03-17 - Initial Triage

**By:** Codex

**Actions:**
- Consolidated the Polymarket auth, adoption, sell-depth, and freshness issues into one mirror-routing workstream
- Defined shared acceptance criteria for mirror live correctness

**Learnings:**
- These failures share one missing concept: a single resolved Polymarket execution context that survives across planning, adoption, and live execution

### 2026-03-17 - Implementation Complete

**By:** Codex

**Actions:**
- Added a resolved Polymarket execution context in mirror sync and threaded it through inventory resolution, adoption position summary reads, and live hedge execution
- Added Polymarket read-client propagation into adoption to enable on-chain fallback when API credentials are unavailable or mismatched
- Extended depth snapshots with sell-side depth (`sellYesDepth` / `sellNoDepth`) and depth provenance metadata (`depthSourceType`, `usedCachedOrMockDepth`, `depthFreshness`)
- Updated strict gate depth checks to fail live DEPTH_COVERAGE when depth comes from cached/mock or otherwise untrusted depth sources
- Aligned strict gate hedge-depth selection with the actual hedge execution planner so live recyclable sells validate against sell-side depth instead of buy-side depth
- Updated mirror operations skill docs to clarify profile-backed Polymarket auth behavior and external-signer constraints
- Added focused unit coverage for profile-context hedge routing, adoption auth propagation, sell-depth payloads, and cached/mock depth blocking

**Verification:**
- `node --check cli/lib/mirror_sync_service.cjs`
- `node --check cli/lib/mirror_sync/execution.cjs`
- `node --check cli/lib/mirror_sync/gates.cjs`
- `node --check cli/lib/polymarket_trade_adapter.cjs`
- `node --check tests/unit/mirror_sync_execution.test.cjs`
- `node --check tests/unit/new-features.test.cjs`
- `node --check tests/unit/polymarket_trade_adapter.test.cjs`
- `node --test tests/unit/mirror_sync_execution.test.cjs tests/unit/polymarket_trade_adapter.test.cjs`
- `node --test --test-name-pattern="runMirrorSync live mode uses resolved polymarket auth context when explicit credentials are absent|runMirrorSync adoption forwards resolved polymarket auth context and on-chain fallback client|runMirrorSync live mode blocks hedge execution when depth coverage comes from cached/mock orderbooks|buildTickGateContext uses sell-side depth for recyclable live hedges|runMirrorSync live mode prioritizes CLI hedge credentials over env defaults" tests/unit/new-features.test.cjs`
- `node --test --test-name-pattern="runMirrorSync live mode blocks stale polled sports source data before executing|runMirrorSync live mode blocks fresh polled sports source data when stream transport is still required" tests/unit/new-features.test.cjs`
- `npm run typecheck`
