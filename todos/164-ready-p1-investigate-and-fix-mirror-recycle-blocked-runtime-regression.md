---
status: ready
priority: p1
issue_id: "164"
tags: [mirror, daemon, runtime, polymarket, incident]
dependencies: []
---

# Investigate And Fix Mirror Recycle Blocked Runtime Regression

## Problem Statement

A shipped `1.1.114` mirror daemon reportedly entered 200+ consecutive blocked ticks during live play with `recycle=insufficient-managed-inventory`, including ticks where `gate=ok`, and stopped hedging despite continued adverse pool flow. Current source says recycle insufficiency should fall back to buy-side hedging, so this needs to be treated as a real shipped-runtime regression or binary/source mismatch until proven otherwise.

## Findings

- User-supplied runtime evidence from Chelsea/PSG on `2026-03-17` shows repeated lines shaped like:
  - `tick=624 drift=176bps hedge=$172 action=blocked gate=ok recycle=insufficient-managed-inventory`
  - `tick=640 drift=1141bps hedge=$500 action=blocked gate=blocked recycle=insufficient-managed-inventory`
- The user reports 6 successful hedges before kickoff, then permanent blocking from tick `624` onward despite roughly `$1,600` of pool trades.
- In the current tree, `buildHedgeExecutionPlan` defaults to buy-side when recycle inventory is insufficient or live sell depth is unavailable:
  - `cli/lib/mirror_sync/execution.cjs:548-575`
- In the current tree, `action=blocked` with `gate=ok` implies some later fail-closed path, such as pending-action lock/manual review, contested lock acquisition, or similar execution-state blockage:
  - `cli/lib/mirror_sync/execution.cjs:1205-1390`
- So there are only a few viable explanations:
  - the 1.1.114 binary diverged from current source around hedge execution fallback
  - a downstream fail-closed path blocked execution after planning, while logs kept surfacing the recycle reason from the hedge plan
  - the runtime logging/reporting contract is conflating planning telemetry with the true execution block reason

## Proposed Solutions

### Option 1: Reproduce the incident shape and fix the failing branch

**Approach:** Use the full incident log/state bundle to identify the first blocked tick, determine whether the actual block reason was gate, pending-action/manual-review state, or execution-plan regression, then patch the failing branch and add a focused regression.

**Pros:**
- Produces a real root cause instead of guesswork
- Most likely to fix the shipped behavior correctly
- Can improve runtime diagnostics at the same time

**Cons:**
- Requires the full log/state bundle or a reliable reproduction fixture
- May uncover multiple contributing bugs rather than one small fix

**Effort:** 3-6 hours

**Risk:** Medium

---

### Option 2: Add a hard buy-side escape hatch immediately

**Approach:** Force the live hedge path to ignore recycle state entirely whenever `gate.ok` is true and a hedge is still required.

**Pros:**
- Reduces the chance of another live block quickly
- Simple operational behavior

**Cons:**
- Risks papering over the real fail-closed branch
- Could change intended inventory/accounting behavior more broadly than necessary

**Effort:** 1-2 hours

**Risk:** High

## Recommended Action

Implement Option 1 first. Reproduce the block using the full incident log/state history, identify the exact execution branch that produced `action=blocked` after a planned hedge with recycle insufficiency, then patch that branch. As part of the fix, make runtime diagnostics distinguish between:
- hedge planning telemetry (`recycleReason`, `hedgeExecutionMode`)
- actual action block reason (`gate`, `pending action`, `manual review`, `execution failure`, etc.)

## Technical Details

**Affected files:**
- `cli/lib/mirror_sync/execution.cjs`
- `cli/lib/mirror_sync/state.cjs`
- `cli/lib/mirror_handlers/sync.cjs`
- any logging/surface code that renders per-tick `action`, `gate`, and `recycle` fields
- focused tests in `tests/unit/mirror_sync_execution.test.cjs` and/or `tests/unit/new-features.test.cjs`

## Resources

- User report / postmortem:
  - `/Users/mac/Desktop/pandora-mirror-daemon-postmortem.md`
- Relevant code:
  - `cli/lib/mirror_sync/execution.cjs:548`
  - `cli/lib/mirror_sync/execution.cjs:1205`
  - `cli/lib/mirror_sync/execution.cjs:1337`
  - `cli/lib/mirror_sync/state.cjs:656`
- Known evidence already on disk:
  - `/Users/mac/Desktop/evidence/daemon-state-live.json`
  - `/Users/mac/Desktop/evidence/daemon-state-stale.json.bak`
  - `/Users/mac/Desktop/evidence/daemon-audit-live.jsonl`
- Additional requested evidence:
  - full `1,667`-line Chelsea/PSG runtime log from the `1.1.114` daemon

## Acceptance Criteria

- [ ] The first blocked live tick in the reported incident shape is traced to a specific execution branch, not just described symptomatically
- [ ] `recycle=insufficient-managed-inventory` alone does not cause `action=blocked` when live hedging should proceed buy-side
- [ ] If another fail-closed branch is the real blocker, the runtime surfaces that reason explicitly in tick diagnostics and status/audit output
- [ ] A focused regression reproduces the original bad behavior or its root cause and proves the fix
- [ ] The fix is verified against the user-provided incident artifacts or an equivalent deterministic fixture

## Work Log

### 2026-03-18 - Initial Triage

**By:** Codex

**Actions:**
- Re-reviewed the postmortem after the user supplied stronger live log evidence
- Confirmed the current source contract says recycle insufficiency should fall back to buy-side hedging
- Narrowed the likely failure classes to build divergence, later fail-closed execution state, or misleading tick logging

**Learnings:**
- The user evidence is now strong enough to treat this as a real shipped-runtime issue on `1.1.114`
- The remaining uncertainty is the exact failing branch, not whether the live runtime got stuck
