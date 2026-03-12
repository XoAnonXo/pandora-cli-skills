---
status: ready
priority: p2
issue_id: "150"
tags: [e2e, journeys, scoring, ux, onboarding]
dependencies: []
---

# Distinguish expected external prerequisites from UX failures in journey scoring

Several agent journeys are now functionally correct, but the current scoring still treats some real-world prerequisites as if they were product UX failures. That makes the report less useful once the routing and remediation have already been fixed.

## Problem Statement

The latest full journey report at [post-fix-report.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/post-fix-report.json) still reports:

- `sports-no-provider` as `blocked-on-provider-configuration`
- `hype-no-ai-keys` as `achieved-with-test-only-guidance`

Those outcomes may still be correct, but the report currently does not separate:

- “the product explained the missing prerequisite correctly”
from
- “the user journey failed because the onboarding was poor”

That distinction matters now that several previously bad flows have been fixed.

## Findings

- The same report also shows that the previously tracked routing issues are gone:
  - `policy-profile-audit`: no friction
  - `amm-mirror-zero-prereqs`: no friction
- The remaining blocked states are tied to actual missing externals:
  - no sportsbook provider config
  - no real AI provider for production-grade suggestion quality
- The current scoring logic lives in:
  - `/Users/mac/Desktop/pandora-market-setup-shareable/scripts/lib/user_journey_runner.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/tests/unit/user_journey_runner.test.cjs`

## Proposed Solutions

### Option 1: Add a distinct “expected prerequisite blocker” class

**Approach:** Keep the current journey outcomes, but classify them separately when the system surfaced the prerequisite correctly and the remaining block is external.

**Pros:**
- Better signal quality
- Preserves honesty about missing providers or funding

**Cons:**
- Requires slightly richer assessment logic
- Needs careful wording so reports stay easy to scan

**Effort:** 2-4 hours

**Risk:** Low

---

### Option 2: Add a separate “guidance quality” dimension

**Approach:** Keep user-goal status as-is, but add a second score that says whether the prerequisite explanation and next step were clear.

**Pros:**
- Most expressive report
- Lets the same scenario be blocked but still well-guided

**Cons:**
- Slightly broader schema change
- More work to maintain across scenarios

**Effort:** 4-8 hours

**Risk:** Medium

## Recommended Action

Implement Option 1 first. The report should clearly distinguish “externally blocked, but explained well” from “bad onboarding or broken routing.” Only add a second dimension later if the first change still feels too blunt.

## Technical Details

**Likely affected files:**
- `/Users/mac/Desktop/pandora-market-setup-shareable/scripts/lib/user_journey_runner.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/tests/unit/user_journey_runner.test.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/docs/skills/agent-experience-audit.md`

## Resources

- Journey report: [post-fix-report.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/post-fix-report.json)
- Earlier comparison report: [agent-fast-report.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/agent-fast-report.json)

## Acceptance Criteria

- [ ] Journey scoring distinguishes external prerequisite blockers from genuine UX or routing failures
- [ ] `sports-no-provider` and similar cases can remain blocked without being misclassified as broken onboarding when remediation is clear
- [ ] The report stays easy to scan at a glance
- [ ] Unit tests cover the new scoring or classification logic

## Work Log

### 2026-03-13 - Todo creation

**By:** Codex

**Actions:**
- converted the remaining report-quality issue into a worker-ready scoring task
- tied it to the latest post-fix journey report
- scoped the work around report semantics, not product behavior

**Learnings:**
- the user journeys are now ahead of the scoring vocabulary in a few places
- better classification will make future burn-down reviews much sharper

## Notes

- Do not hide real blockers. The goal is better classification, not artificially greener reports.
