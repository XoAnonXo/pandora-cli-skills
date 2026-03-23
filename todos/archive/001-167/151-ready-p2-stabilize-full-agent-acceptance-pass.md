---
status: ready
priority: p2
issue_id: "151"
tags: [e2e, agents, skill-runtime, performance, reliability]
dependencies: []
---

# Stabilize the full combined agent acceptance pass

The new `e2e:agents` runner exists and is the right top-level entrypoint, but the full combined pass is still expensive enough that it is awkward to use interactively. The slow part is the full live skill-runtime layer, not the journey runner or the surface inventory.

## Problem Statement

Pandora now has a real combined agent acceptance entrypoint:

- `/Users/mac/Desktop/pandora-market-setup-shareable/scripts/run_agent_acceptance.cjs`
- `npm run e2e:agents`

That is good. The remaining problem is that the full live skill-runtime portion is still slow enough that it is hard to use as a quick confidence gate during active development.

## Findings

- The combined runner now aggregates:
  - CLI/MCP inventory
  - broad surface sweeps
  - all supported user journeys
  - skill-runtime scenarios
- The finished artifacts that were practical to run in this pass were:
  - [surface-e2e-agent-fast.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/surface-e2e-agent-fast.json)
  - [post-fix-report.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/post-fix-report.json)
  - [skill-runtime-agent-audit.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/skill-runtime-agent-audit.json)
  - [skill-runtime-watch-risk.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/skill-runtime-watch-risk.json)
- The heaviest remaining component is the all-scenario live skill runtime, especially when using default timeout and retry behavior.
- Relevant files are:
  - `/Users/mac/Desktop/pandora-market-setup-shareable/scripts/run_agent_acceptance.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/scripts/lib/agent_acceptance_runner.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/scripts/lib/surface_e2e_runner.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/scripts/claude_skill_executor.cjs`

## Proposed Solutions

### Option 1: Add a “fast” versus “full” mode

**Approach:** Keep the current full matrix, but add a fast mode that runs the highest-signal skill scenarios and leaves the full catalog for slower CI or release checks.

**Pros:**
- Best developer ergonomics
- Keeps full coverage available

**Cons:**
- Two supported modes to maintain
- Needs a clear definition of the fast subset

**Effort:** 2-4 hours

**Risk:** Low

---

### Option 2: Make the full skill-runtime pass cheaper by default

**Approach:** Adjust model, effort, timeout, and retry defaults for the agent acceptance runner so the default pass is less expensive without losing too much signal.

**Pros:**
- One command stays canonical
- No separate mode split

**Cons:**
- Risks masking genuinely slow regressions
- Needs careful tuning

**Effort:** 3-6 hours

**Risk:** Medium

## Recommended Action

Implement Option 1 first. Keep `npm run e2e:agents` as the main entrypoint, but give it an explicit fast profile for active development and a full profile for slower release-quality runs. The fast profile should still include at least one live skill-runtime pass, not just static bundle validation.

## Technical Details

**Likely affected files:**
- `/Users/mac/Desktop/pandora-market-setup-shareable/scripts/run_agent_acceptance.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/scripts/lib/agent_acceptance_runner.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/scripts/lib/surface_e2e_runner.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/package.json`

## Resources

- Combined runner: [run_agent_acceptance.cjs](/Users/mac/Desktop/pandora-market-setup-shareable/scripts/run_agent_acceptance.cjs)
- Surface report: [surface-e2e-agent-fast.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/surface-e2e-agent-fast.json)
- Journey report: [post-fix-report.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/post-fix-report.json)

## Acceptance Criteria

- [ ] The combined agent acceptance workflow has a clear fast mode and full mode, or a comparably practical default
- [ ] Fast mode still exercises at least one live skill-runtime scenario set, not only static checks
- [ ] The docs or help output explain which mode to use during local iteration versus broader verification
- [ ] Unit or smoke coverage exists for the new runner behavior

## Work Log

### 2026-03-13 - Todo creation

**By:** Codex

**Actions:**
- converted the remaining top-level workflow issue into a worker-ready todo
- scoped it around making the combined acceptance pass practical rather than changing the underlying product surfaces
- anchored it to the new runner and the artifacts that already finished successfully

**Learnings:**
- the main bottleneck is the live skill-runtime layer, not the MCP inventory or journey runner
- the repo now has the right top-level runner shape; it just needs a more ergonomic operating mode

## Notes

- Preserve one canonical full run. The goal is not to fragment the verification story, only to make it usable during normal iteration.
