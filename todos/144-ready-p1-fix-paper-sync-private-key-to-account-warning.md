---
status: ready
priority: p1
issue_id: "144"
tags: [mirror-sync, cli, bug, paper-mode, runtime]
dependencies: []
---

# Fix paper sync privateKeyToAccount runtime warning

The paper sync path currently completes, but it emits a concrete runtime warning during a live onboarding scenario: `privateKeyToAccount is not a function`. That is a real bug, not just rough UX, and it undermines trust in the mirror sync diagnostics.

## Problem Statement

An operator should be able to run `mirror sync once --paper` against an existing Pandora market and inspect the result without live hedge credentials. The flow currently works at the harness level, but it leaks a runtime warning from the inventory-offset path. Paper mode should be clean and deterministic.

## Findings

- The live scenario `mirror-sync-paper-existing-market` in [onboarding-cli-10.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/onboarding-cli-10.json) completed with status `achieved-with-runtime-warning`.
- The scenario recorded a high-severity friction point:
  - `Paper sync emits a concrete runtime warning from inventory offset handling`
- The exact warning captured in the payload summary was:
  - `privateKeyToAccount is not a function`
- Likely relevant code already exists in:
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_sync_service.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/pandora_deploy_service.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/pandora.cjs`
- The report recommendation is explicit: treat this as a real bug before trusting paper sync as a clean onboarding experience.

## Proposed Solutions

### Option 1: Add a runtime fallback for account derivation

**Approach:** Harden the paper-sync runtime so `privateKeyToAccount` is always resolved from a safe fallback when viem runtime wiring is partial.

**Pros:**
- Fastest direct fix
- Minimal user-visible change

**Cons:**
- Could mask a deeper dependency-wiring bug
- May not fix the real paper-mode contract if signer derivation should not run at all

**Effort:** 2-4 hours

**Risk:** Low

---

### Option 2: Remove signer/account derivation from pure paper-sync paths when not needed

**Approach:** Audit the inventory-offset path and skip private-key-to-account derivation entirely in bounded paper runs unless a live hedge action truly requires it.

**Pros:**
- Better paper-mode design
- Less surprising runtime behavior

**Cons:**
- Requires more careful reasoning about sync state and diagnostics
- Slightly broader refactor

**Effort:** 4-8 hours

**Risk:** Medium

## Recommended Action

Start with root-cause analysis in `mirror_sync_service.cjs`. If the paper path is deriving account data unnecessarily, remove that dependency from paper mode. If the call is legitimate, harden the viem runtime contract so `privateKeyToAccount` is always present when invoked. Add a regression test and rerun the user journey so the warning disappears from the output.

## Technical Details

**Likely affected files:**
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_sync_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/polymarket_ops_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/tests/unit/user_journey_runner.test.cjs`

**Related scenario:**
- `mirror-sync-paper-existing-market`

## Resources

- Scenario report: [onboarding-cli-10.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/onboarding-cli-10.json)
- Journey runner: [user_journey_runner.cjs](/Users/mac/Desktop/pandora-market-setup-shareable/scripts/lib/user_journey_runner.cjs)

## Acceptance Criteria

- [ ] `mirror sync once --paper` no longer emits `privateKeyToAccount is not a function`
- [ ] The paper sync path still returns a strategy hash, snapshots, and status metadata in isolated mode
- [ ] A regression test covers the failing path or the fixed inventory-offset contract
- [ ] The `mirror-sync-paper-existing-market` scenario still passes and no longer reports a runtime warning

## Work Log

### 2026-03-13 - Todo creation

**By:** Codex

**Actions:**
- converted the live mirror-sync warning into a tracked bug
- linked it to the exact user-journey scenario and warning text
- narrowed likely ownership to the paper sync and runtime account-derivation code paths

**Learnings:**
- the paper path is usable today, which makes this a high-value cleanup target
- a warning in a clean onboarding flow is still a product bug even if the command returns `ok: true`

## Notes

- Do not treat this as a docs-only issue. The observed warning is concrete runtime behavior.
