---
status: ready
priority: p1
issue_id: "143"
tags: [onboarding, cli, deploy, mirror, profiles, ux]
dependencies: []
---

# Smooth zero-prereq AMM deploy and paper mirror onboarding

The CLI supports both AMM deployment and Polymarket mirror automation, but the first-run path is still too fragmented for a user who starts with no wallet and no third-party API keys. The live onboarding scenario shows that Pandora can guide the user into deploy planning and paper mirror mode, but it still makes them understand two separate mutable profile stories and discover the explicit resolution-source requirement too late.

## Problem Statement

A fresh user wants to deploy an AMM market on Pandora and then hedge it with a daemon on Polymarket. They do not have a wallet yet, do not have Polymarket API keys, and do not have Odds API keys. Today the CLI can get them part of the way there, but the onboarding path still has avoidable friction:

- market deployment recommends `market_deployer_a`
- mirror automation recommends `prod_trader_a`
- `mirror go --paper` still hard-stops unless the user already knows to provide two independent public `--sources`

This is not a protocol failure, but it is a real onboarding failure for a supported CLI use case.

## Findings

- The live scenario `amm-mirror-zero-prereqs` in [onboarding-cli-10.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/onboarding-cli-10.json) completed with user goal status `guided-to-paper-mirror-and-deploy-preflight`.
- The scenario recorded two friction points:
  - `AMM deploy and mirror automation use different recommended mutable profiles`
  - `Mirror go still stops cold until the user supplies independent resolution sources`
- The same scenario also recorded two strengths:
  - AMM planning and validation work without signer material
  - `mirror go --paper` works once the user supplies real public sources
- The current requirement is technically defensible, but it is surfaced too late in the flow.

## Proposed Solutions

### Option 1: Document the split persona model more clearly

**Approach:** Keep deployment and mirror automation as separate mutable personas, but make the distinction explicit in bootstrap/help/docs.

**Pros:**
- Lowest code risk
- Fastest path to reduce confusion

**Cons:**
- Still leaves the user with a multi-persona mental model
- Does not reduce the `mirror go` failure-at-the-end experience

**Effort:** 2-4 hours

**Risk:** Low

---

### Option 2: Add an explicit zero-prereq preflight for the deploy-plus-mirror path

**Approach:** Surface both recommended profiles and the exact `--sources` requirement before the user reaches `mirror go`.

**Pros:**
- Matches how real users approach the workflow
- Preserves current security and validation rules

**Cons:**
- Requires coordination across onboarding/help/error surfaces
- Still keeps separate personas under the hood

**Effort:** 4-8 hours

**Risk:** Medium

---

### Option 3: Introduce a composite operator path for deploy-plus-mirror onboarding

**Approach:** Ship a first-class onboarding flow or recommendation contract that treats Pandora deploy plus paper mirror as one operator journey.

**Pros:**
- Best user story
- Lowest cognitive load for fresh operators

**Cons:**
- Highest scope
- Higher risk of over-abstracting real permission boundaries

**Effort:** 1-2 days

**Risk:** Medium

## Recommended Action

Implement Option 2 first. Keep the two personas if they are meaningfully different, but make the onboarding contract explicit: recommended deploy profile, recommended mirror profile, and the fact that `mirror go` needs two independent public resolution sources even in paper mode. If that still feels too awkward after the next scenario run, revisit a composite operator path.

## Technical Details

**Likely affected files:**
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/profile_command_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_command_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/parsers/mirror_go_flags.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_handlers/go.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/scripts/lib/user_journey_runner.cjs`

**Related scenario:**
- `amm-mirror-zero-prereqs`

## Resources

- Scenario report: [onboarding-cli-10.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/onboarding-cli-10.json)
- Journey runner: [user_journey_runner.cjs](/Users/mac/Desktop/pandora-market-setup-shareable/scripts/lib/user_journey_runner.cjs)

## Acceptance Criteria

- [ ] A fresh CLI user can discover both the deploy and mirror mutable-profile story before hitting a failing command
- [ ] The explicit `--sources` requirement is surfaced earlier than `mirror go` execution
- [ ] `mirror go --paper` failure messaging points directly at how to satisfy the source requirement
- [ ] The `amm-mirror-zero-prereqs` scenario still passes and its friction list is reduced
- [ ] Focused tests or journey assertions cover the improved onboarding path

## Work Log

### 2026-03-13 - Todo creation

**By:** Codex

**Actions:**
- converted the zero-prereq AMM plus mirror onboarding findings into a worker-ready item
- tied the task to the live scenario report and the exact friction messages
- scoped the work around onboarding clarity rather than protocol changes

**Learnings:**
- the main problem is sequence and messaging, not basic CLI capability
- a fresh user can already get surprisingly far without wallet or API keys if Pandora surfaces the prerequisites early enough

## Notes

- This item intentionally focuses on onboarding and recommendation flow, not live hedging credentials.
