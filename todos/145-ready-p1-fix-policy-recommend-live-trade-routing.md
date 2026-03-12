---
status: ready
priority: p1
issue_id: "145"
tags: [policy, cli, recommendation, trade, onboarding]
dependencies: []
---

# Fix policy recommend live-trade routing

`policy.recommend` currently recommends `execute-with-risk-cap` for a live trade path even though the resulting policy decision still denies the trade and redirects the user back to quote. That weakens trust in the recommendation surface and wastes time during onboarding.

## Problem Statement

Pandora explicitly positions `policy.recommend` as a safe way to discover the right operating mode before mutation. If the recommendation it returns is not actually usable for the requested path, the surface becomes misleading instead of helpful.

## Findings

- The live scenario `policy-profile-audit` in [onboarding-cli-10.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/onboarding-cli-10.json) completed, but recorded one friction point:
  - `Policy recommend still points at a denying live-trade pack`
- The scenario detail states:
  - for live trade, `policy.recommend` chose `execute-with-risk-cap` even though the recommendation still denies trade and redirects to quote
- Relevant policy and recommendation code appears in:
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/policy_command_service.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/shared/policy_builtin_packs.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/error_recovery_service.cjs`

## Proposed Solutions

### Option 1: Filter recommendations to only actually-usable policy packs

**Approach:** Change `policy.recommend` so the top recommendation must permit the requested path, not merely resemble it.

**Pros:**
- Best user trust outcome
- Keeps recommendation semantics clear

**Cons:**
- May require more nuanced ranking logic
- Could reduce the candidate set in edge cases

**Effort:** 4-8 hours

**Risk:** Medium

---

### Option 2: Keep current ranking but return explicit next-tool guidance first

**Approach:** If the requested live path remains denied, return `quote` or another actually-usable next step as the primary recommendation contract, with the policy pack as secondary context.

**Pros:**
- Lower risk than changing ranking semantics
- Still improves user guidance materially

**Cons:**
- Recommendation semantics remain mixed between policy and workflow
- Could feel indirect if the user asked specifically about policy packs

**Effort:** 3-6 hours

**Risk:** Low

## Recommended Action

Prefer Option 1 if it can be done without destabilizing other policy recommendations. If not, implement Option 2 now so the top response clearly tells the user the actual safe next action. In either case, `policy.recommend` must stop presenting a denying policy as the best recommendation for live trade.

## Technical Details

**Likely affected files:**
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/policy_command_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/shared/policy_builtin_packs.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/error_recovery_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/tests/cli/policy_profile_cli.integration.test.cjs`

**Related scenario:**
- `policy-profile-audit`

## Resources

- Scenario report: [onboarding-cli-10.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/onboarding-cli-10.json)
- Journey runner: [user_journey_runner.cjs](/Users/mac/Desktop/pandora-market-setup-shareable/scripts/lib/user_journey_runner.cjs)

## Acceptance Criteria

- [ ] `policy.recommend` no longer recommends a still-denied live-trade path as the primary answer
- [ ] The returned recommendation contract makes the usable next action explicit when live trade is not allowed
- [ ] Existing policy/profile recommendation tests are updated or expanded
- [ ] The `policy-profile-audit` scenario still passes and no longer records this friction point

## Work Log

### 2026-03-13 - Todo creation

**By:** Codex

**Actions:**
- converted the live policy-audit friction into a worker-ready task
- scoped the issue around recommendation correctness rather than policy-pack philosophy
- identified the policy recommendation and recovery surfaces most likely to need changes

**Learnings:**
- the policy surface is strong overall, so mismatched recommendations stand out sharply
- onboarding trust depends on recommendation outputs being operationally true, not just directionally reasonable

## Notes

- Preserve machine-readable outputs. This surface is used by agents, not just humans.
