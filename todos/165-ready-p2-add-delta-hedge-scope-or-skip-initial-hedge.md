---
status: ready
priority: p2
issue_id: "165"
tags: [mirror, daemon, product, hedge, ux]
dependencies: []
---

# Add Delta Hedge Scope Or Skip Initial Hedge

## Problem Statement

Operators currently have two hedge scopes for mirror sync:
- `pool`: hedge the AMM reserve imbalance only
- `total`: hedge pool reserves plus held Pandora outcome tokens

Neither mode supports the operational strategy “hedge only trader-driven reserve changes from the deployment/startup baseline.” That leads operators to misuse `pool` for a workflow it was never designed to support and to interpret the initial startup hedge as a bug.

## Findings

- Current contract explicitly defines `pool` as pool-only hedging:
  - `cli/lib/agent_contract_registry.cjs:3528`
- Current tests assert that `pool` ignores same-side Pandora wallet inventory relief:
  - `tests/unit/new-features.test.cjs:7425`
- The recent postmortem discussion clarified that the real ask is not to change `pool` semantics; it is to add a third mode such as `delta` / `flow` or a simpler `--skip-initial-hedge` control.
- This is a product/strategy gap, not a correctness bug in the documented current behavior.

## Proposed Solutions

### Option 1: Add a new baseline-aware hedge scope (`delta` / `flow`)

**Approach:** On startup, snapshot the chosen reserve baseline and only hedge changes relative to that baseline on subsequent ticks.

**Pros:**
- Matches the requested operator mental model directly
- Cleanly separates current `pool` semantics from flow-only hedging
- Scales beyond tick 1 by modeling reserve deltas explicitly

**Cons:**
- More product/design work
- Needs careful persistence, restart semantics, and docs

**Effort:** 4-8 hours

**Risk:** Medium

---

### Option 2: Add `--skip-initial-hedge` without a new hedge scope

**Approach:** Preserve current `pool` / `total` logic but suppress the first eligible hedge after startup.

**Pros:**
- Smaller implementation
- Solves the most visible tick-1 operator surprise

**Cons:**
- Does not fully implement flow-only hedging after restarts or state resets
- Can still diverge from the desired “since deployment baseline” semantics

**Effort:** 1-3 hours

**Risk:** Medium

## Recommended Action

Decide the product contract first. If the real intent is ongoing flow-based hedging, implement Option 1 with a new explicit scope and clear restart/baseline semantics. If the immediate need is only to suppress the startup surprise, Option 2 is an acceptable interim step, but it should be documented as a narrower control rather than a full flow-based strategy.

## Technical Details

**Affected files:**
- `cli/lib/mirror_sync/planning.cjs`
- `cli/lib/parsers/mirror_sync_flags.cjs`
- `cli/lib/agent_contract_registry.cjs`
- `cli/lib/mirror_handlers/sync.cjs`
- docs/help surfaces for mirror sync
- focused tests around planning behavior and CLI contract

## Resources

- Postmortem / operator report:
  - `/Users/mac/Desktop/pandora-mirror-daemon-postmortem.md`
- Current contract/test references:
  - `cli/lib/agent_contract_registry.cjs:3528`
  - `tests/unit/new-features.test.cjs:7425`

## Acceptance Criteria

- [ ] The chosen operator-facing contract is explicit: either new `delta` / `flow` scope or `--skip-initial-hedge`
- [ ] Current `pool` and `total` semantics remain documented accurately
- [ ] Planning logic and persisted state handle startup/restart behavior deterministically
- [ ] Help text, schema, and docs explain the new behavior without implying that `pool` changed meaning
- [ ] Focused regressions cover the startup tick and at least one subsequent reserve-change tick

## Work Log

### 2026-03-18 - Initial Triage

**By:** Codex

**Actions:**
- Reframed the earlier “phantom startup hedge” claim as a feature request
- Confirmed the current code and tests document `pool` as reserve-only hedging
- Split the operator ask into two viable product directions: baseline-aware flow hedging or a narrower skip-initial-hedge control

**Learnings:**
- This should not be bundled into a bug-fix patch for current `pool` behavior
- Product clarification is the first step; implementation should follow the chosen contract
