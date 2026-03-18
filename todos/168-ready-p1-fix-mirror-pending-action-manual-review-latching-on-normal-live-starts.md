---
status: ready
priority: p1
issue_id: "168"
tags: [mirror, daemon, pending-action, polymarket, incident]
dependencies: []
---

# Fix Mirror Pending-Action / Manual-Review Latching On Normal Live Starts

## Problem Statement

Shipped `1.1.117` mirror daemon can enter `PENDING_ACTION_LOCK_REVIEW` and later `LAST_ACTION_REQUIRES_REVIEW` shortly after startup, even when tick 1 performs no hedge and the operator's starting venue state is legitimate pre-existing Polymarket inventory. In the reported UCL incidents, force unlock, lock deletion, state resets, and reducing inventory to dust did not restore native hedging. This blocks live operation and forces operators onto wrapper-based fallback.

## Findings

- The operator postmortem at `/Users/mac/Desktop/pandora-daemon-postmortem-v2.md` documents two `2026-03-18` incidents where:
  - tick 1 executed with `hedge=$0`
  - tick 2 blocked with `PENDING_ACTION_LOCK_REVIEW`
  - later unlock attempts still ended in `LAST_ACTION_REQUIRES_REVIEW`
- In the current source, live mode acquires a pending-action lock on any gate-ok live tick before execution, not only when a hedge order actually fires:
  - `cli/lib/mirror_sync/execution.cjs:1535`
- In the current source, execution can block on both:
  - a persisted pending-action lock file
  - persisted `state.lastExecution.requiresManualReview`
  - `cli/lib/mirror_sync/execution.cjs:1340`
  - `cli/lib/mirror_sync/execution.cjs:1378`
- Current help/source contract says unlock is intended to clear the matching persisted manual-review blocker when it corresponds to the same action:
  - `cli/lib/mirror_handlers/sync.cjs:395`
  - `cli/lib/mirror_sync/state.cjs:210`
- That means the observed shipped behavior is likely one of:
  - a `1.1.117` branch/runtime gap versus current source
  - a different branch promoting the state back into manual review
  - a broader false-positive lock/review path triggered by normal startup state
- Non-zero pre-existing Polymarket balances are a strong operational correlate, including dust, but they are not yet proven to be the sole trigger.
- This overlaps with, but is not identical to:
  - issue `154` pending-action/manual-review recovery ergonomics
  - issue `160` Polymarket inventory/auth routing correctness
  - issue `162` Polymarket adoption unit correctness
  - issue `164` blocked-runtime investigation and logging clarity

## Proposed Solutions

### Option 1: Reproduce the exact blocked tick and patch the failing branch

**Approach:** Build a deterministic fixture from the state file, pending-action file, and runtime log that reproduces the first blocked tick in the reported `1.1.117` incident shape. Trace the exact branch that creates or retains manual-review state, then patch only that branch and add focused regressions.

**Pros:**
- Produces a real root cause instead of a symptom-level fix
- Avoids weakening the safety model blindly
- Lets us distinguish startup inventory, stale state, and true failed execution

**Cons:**
- Requires a reproducible incident bundle or equivalent synthetic fixture
- May uncover more than one contributing bug

**Effort:** 4-8 hours

**Risk:** Medium

---

### Option 2: Relax the pending-action/manual-review model broadly

**Approach:** Stop promoting startup/live state into manual review as aggressively, tolerate more pre-existing inventory, and rely on operator override for ambiguous cases.

**Pros:**
- Faster short-term operational relief
- Lower chance of another live block from the same symptom

**Cons:**
- Risks masking the real fault path
- Can weaken the intended fail-closed guarantees
- Harder to reason about if multiple state bugs are involved

**Effort:** 1-3 hours

**Risk:** High

## Recommended Action

Take Option 1 first.

Reproduce the first blocked tick from the reported incident shape, identify whether the latched state came from:

1. contested/retained pending-action lock
2. persisted `lastExecution.requiresManualReview`
3. startup inventory adoption / reconciliation side effects
4. another live execution branch that re-promotes manual review after unlock

Then patch that exact branch. If current source already contains the intended unlock behavior, backport that recovery logic to the shipped path and add regression coverage for the postmortem scenario.

## Technical Details

**Likely affected files:**
- `cli/lib/mirror_sync/execution.cjs`
- `cli/lib/mirror_sync/state.cjs`
- `cli/lib/mirror_sync_service.cjs`
- `cli/lib/mirror_handlers/sync.cjs`
- `tests/unit/mirror_sync_execution.test.cjs`
- `tests/unit/new-features.test.cjs`
- any fixture or integration test that exercises live daemon state transitions

**Likely investigation artifacts:**
- state file at the first blocked tick
- corresponding `.pending-action.json`
- audit log / runtime log around tick 1 through first blocked tick
- any pre-existing Polymarket inventory snapshot used in the run

## Resources

- Postmortem:
  - `/Users/mac/Desktop/pandora-daemon-postmortem-v2.md`
- Relevant code:
  - `cli/lib/mirror_sync/execution.cjs:1535`
  - `cli/lib/mirror_sync/execution.cjs:1340`
  - `cli/lib/mirror_sync/execution.cjs:1378`
  - `cli/lib/mirror_sync/state.cjs:210`
  - `cli/lib/mirror_handlers/sync.cjs:395`

## Acceptance Criteria

- [ ] The first blocked tick in the reported `1.1.117` incident shape is traced to a specific execution/state branch
- [ ] A normal live startup with legitimate pre-existing Polymarket inventory does not latch into manual-review state without an actual failed or ambiguous execution
- [ ] `mirror sync unlock` clears both the lock file and matching persisted review state in the reproduced incident shape, or the product contract is explicitly changed and documented
- [ ] Runtime diagnostics expose the true block source (`pending lock`, `lastExecution review`, `contested lock`, `execution failure`, etc.)
- [ ] Focused regression coverage reproduces the original bad behavior or its exact trigger and proves the fix

## Work Log

### 2026-03-18 - Initial triage from postmortem review

**By:** Codex

**Actions:**
- Reviewed and tightened the operator postmortem to separate confirmed runtime evidence from inference
- Audited the current mirror pending-action/manual-review paths in source
- Confirmed the current tree acquires locks on any gate-ok live tick and blocks on both lock file and `lastExecution.requiresManualReview`
- Created this focused todo to isolate the incident from adjacent routing/adoption work

**Learnings:**
- The original claim "any pre-existing Poly position directly creates the lock" is too strong without deterministic repro
- The real issue is narrower and more actionable: live pending-action/manual-review state can latch during normal startup and supported recovery was not reliable enough in the shipped runtime
