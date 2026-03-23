---
status: ready
priority: p1
issue_id: "147"
tags: [sports, cli, onboarding, providers, error-handling]
dependencies: []
---

# Improve sports provider onboarding and remediation hints

Sports onboarding currently has a sharp cliff: `sports books list` explains missing provider configuration cleanly, but follow-up commands like `sports schedule`, `sports events list`, and `sports scores` hard-fail immediately. That is technically correct, but it is still poor onboarding for a supported CLI surface.

## Problem Statement

A user exploring sports workflows without provider credentials should be able to understand what is missing and exactly how to fix it. Right now Pandora exposes the missing-config state in one command, then makes the next commands fail without keeping the remediation path front and center.

## Findings

- The live scenario `sports-no-provider` in [onboarding-cli-10.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/onboarding-cli-10.json) completed with user goal status `blocked-on-provider-configuration`.
- The scenario recorded one high-severity friction point:
  - `Sports discovery is blocked entirely without provider setup`
- The detail in the report is precise:
  - `sports books list` reports the missing-provider state cleanly
  - `sports schedule`, `events list`, and `scores` then hard-fail as soon as the user continues
- Relevant implementation surfaces include:
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/sports_provider_registry.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/error_recovery_service.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/sports_command_service.cjs`

## Proposed Solutions

### Option 1: Improve missing-provider remediation for failing sports commands

**Approach:** Keep the current failures, but return stronger structured remediation that points back to provider setup and `sports books list`.

**Pros:**
- Low-risk
- Preserves correct command semantics

**Cons:**
- Still a blocked workflow
- Does not reduce the number of failing steps

**Effort:** 2-4 hours

**Risk:** Low

---

### Option 2: Route sports onboarding through an explicit provider preflight contract

**Approach:** Make schedule/events/scores surface an explicit preflight recommendation contract instead of a plain configuration failure when no providers exist.

**Pros:**
- Better onboarding
- More consistent machine-readable behavior across sports commands

**Cons:**
- Slightly broader behavioral change
- Needs careful compatibility review for existing callers

**Effort:** 4-8 hours

**Risk:** Medium

## Recommended Action

Start with Option 1 and make sure all sports discovery failures point users directly at the provider setup path and the diagnostic preflight command. If that still feels too abrupt in the journey rerun, follow up with Option 2.

## Technical Details

**Likely affected files:**
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/sports_provider_registry.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/error_recovery_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/sports_command_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/tests/cli/sports.integration.test.cjs`

**Related scenario:**
- `sports-no-provider`

## Resources

- Scenario report: [onboarding-cli-10.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/onboarding-cli-10.json)
- Journey runner: [user_journey_runner.cjs](/Users/mac/Desktop/pandora-market-setup-shareable/scripts/lib/user_journey_runner.cjs)

## Acceptance Criteria

- [ ] `sports schedule`, `sports events list`, and `sports scores` return clear remediation guidance when providers are missing
- [ ] The suggested recovery path points back to `sports books list` and provider setup, not just a raw missing-config error
- [ ] Existing sports integration tests are updated or expanded to cover the missing-provider path
- [ ] The `sports-no-provider` scenario still passes and reports a clearer onboarding experience

## Work Log

### 2026-03-13 - Todo creation

**By:** Codex

**Actions:**
- converted the sports onboarding blocker into a worker-ready todo
- scoped the task around structured remediation and discovery flow
- tied the item to the exact no-provider journey output

**Learnings:**
- the provider registry already exposes enough information to make this better
- this is an onboarding and error-recovery problem, not a sports-data correctness problem

## Notes

- Preserve current behavior for properly configured providers. This item is only about the missing-provider path.
