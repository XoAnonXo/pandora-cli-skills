---
status: ready
priority: p1
issue_id: "152"
tags: [agents, e2e, worker-handoff, acceptance, burndown]
dependencies: ["149", "150", "151"]
---

# Worker burndown for remaining agent acceptance follow-ups

This is the current worker handoff for the remaining agent-testing work after the latest MCP, CLI, and skill fixes. The broad product-routing issues now look largely cleared in the live reports. The remaining work is mostly test-harness truthfulness, reporting quality, and making the combined acceptance pass practical to run.

## Current State

The latest artifacts show:

- `mcp-stdio`: green
- `mcp-http`: green
- `skill-bundle`: green
- user journeys: functionally green with a few externally blocked cases
- `cli-json`: still red because long-running command shapes are being treated as failures by the synthetic breadth sweep

Relevant artifacts:

- [surface-e2e-agent-fast.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/surface-e2e-agent-fast.json)
- [post-fix-report.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/post-fix-report.json)
- [skill-runtime-agent-audit.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/skill-runtime-agent-audit.json)
- [skill-runtime-watch-risk.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/skill-runtime-watch-risk.json)

## Worker Order

1. Complete [149-ready-p1-fix-cli-json-long-running-surface-sweep-policy.md](/Users/mac/Desktop/pandora-market-setup-shareable/todos/149-ready-p1-fix-cli-json-long-running-surface-sweep-policy.md)
2. Complete [150-ready-p2-distinguish-expected-prerequisites-in-journey-scoring.md](/Users/mac/Desktop/pandora-market-setup-shareable/todos/150-ready-p2-distinguish-expected-prerequisites-in-journey-scoring.md)
3. Complete [151-ready-p2-stabilize-full-agent-acceptance-pass.md](/Users/mac/Desktop/pandora-market-setup-shareable/todos/151-ready-p2-stabilize-full-agent-acceptance-pass.md)

## Why This Order

- `149` fixes the biggest remaining false-red in the acceptance story.
- `150` improves the signal quality of the user-journey reports after the major onboarding fixes already landed.
- `151` is worth doing after `149` and `150`, because the combined runner should reflect the corrected sweep and scoring semantics before it is optimized into a more ergonomic fast/full workflow.

## Concrete Goals For The Worker

### 1. Make the broad surface sweep honest

The worker should stop treating these long-running or unbounded CLI shapes as generic failures in the `cli-json` breadth sweep:

- `autopilot.run`
- `mirror.sync.run`
- `mirror.sync.start`
- `odds.record`
- `sports.sync.run`
- `sports.sync.start`
- `watch`

The outcome should distinguish:

- real short-lived command failure
- intentionally excluded long-running surface
- bounded synthetic coverage where supported

### 2. Make journey scoring reflect product reality

The worker should separate:

- “the system is externally blocked but explained the next step correctly”
from
- “the onboarding or routing is still bad”

This matters most for:

- `sports-no-provider`
- `hype-no-ai-keys`

The report should remain honest, but it should stop implying those flows are broken when the actual remaining blocker is an external dependency that is explained clearly.

### 3. Make the top-level runner practical

The worker should make the combined acceptance workflow practical for iteration without losing the full verification story. The most likely shape is:

- a fast mode for local development
- a full mode for broader or release-quality checks

The fast mode must still include at least one live skill-runtime check.

## Acceptance Criteria

- [ ] `surface-e2e-agent-fast.json` no longer reports the long-running CLI shapes as generic transport failures
- [ ] `post-fix-report.json`-style journey output distinguishes external prerequisite blockers from genuine UX failures
- [ ] `npm run e2e:agents` has a practical fast/full operating model or equivalent improvement
- [ ] unit or smoke coverage exists for all three changes
- [ ] the worker reruns the relevant reports and attaches new artifact paths

## Suggested Verification

- `node --test tests/unit/surface_e2e_runner.test.cjs tests/unit/user_journey_runner.test.cjs tests/unit/agent_acceptance_runner.test.cjs`
- `node scripts/run_surface_e2e.cjs --surface cli-json,mcp-stdio,mcp-http,skill-bundle --out output/e2e/surface-e2e-agent-fast.json`
- `node scripts/run_user_journey.cjs --scenario all --out output/e2e/user-journeys/post-fix-report.json`
- `npm run e2e:agents`

## Notes

- Do not reopen the already-fixed onboarding and routing issues unless a rerun shows a real regression.
- Focus on the remaining test and reporting gaps, not speculative product changes.
