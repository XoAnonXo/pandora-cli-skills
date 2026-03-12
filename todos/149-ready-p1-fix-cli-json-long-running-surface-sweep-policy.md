---
status: ready
priority: p1
issue_id: "149"
tags: [e2e, cli, surface-sweep, long-running, agents]
dependencies: []
---

# Fix cli-json long-running surface-sweep policy

The broad `cli-json` acceptance sweep is still the main red signal in the new agent acceptance matrix, but the failures are not ordinary command regressions. They are long-running or unbounded commands being treated like transport failures by the synthetic breadth runner.

## Problem Statement

The new surface sweep report at [surface-e2e-agent-fast.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/surface-e2e-agent-fast.json) reports `cli-json` as failing with `7` transport errors:

- `autopilot.run`
- `mirror.sync.run`
- `mirror.sync.start`
- `odds.record`
- `sports.sync.run`
- `sports.sync.start`
- `watch`

These are all long-running or unbounded command shapes. Right now the breadth runner treats them as generic failures, which makes the top-level acceptance result noisier than it should be.

## Findings

- The same surface report shows:
  - `mcp-stdio`: green
  - `mcp-http`: green
  - `skill-bundle`: green
  - only `cli-json` is red
- Every listed `cli-json` failure uses the same transport error pattern:
  - `... is blocked in MCP v1 because it is long-running/unbounded.`
- The problem is therefore in sweep policy and classification, not in ordinary short-lived command execution.
- Relevant code paths are:
  - `/Users/mac/Desktop/pandora-market-setup-shareable/scripts/lib/surface_e2e_runner.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/tests/helpers/mcp_tool_sweep.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/scripts/run_surface_e2e.cjs`

## Proposed Solutions

### Option 1: Reclassify long-running commands as excluded or separately tracked

**Approach:** Detect unbounded CLI surfaces during the sweep and report them as `skipped-long-running` or a separate non-failing class instead of `transport-error`.

**Pros:**
- Fastest way to make the acceptance report honest
- Keeps breadth coverage on the rest of the CLI surface

**Cons:**
- Does not test those long-running commands directly
- Needs a clear rule so the skip list does not drift into “hide failures”

**Effort:** 2-4 hours

**Risk:** Low

---

### Option 2: Add bounded synthetic modes for long-running commands

**Approach:** Teach the sweep helper how to exercise a safe one-iteration or one-shot mode for these command families so they can still be included in the breadth run meaningfully.

**Pros:**
- Better true coverage
- Less special casing in the final report

**Cons:**
- More implementation work
- Some commands may still not have a clean bounded shape today

**Effort:** 4-8 hours

**Risk:** Medium

## Recommended Action

Implement Option 1 first so the agent acceptance report stops treating these as generic failures. Then selectively do Option 2 where a real bounded one-shot mode exists and is stable. The runner should distinguish “not eligible for this sweep shape” from “broken command.”

## Technical Details

**Likely affected files:**
- `/Users/mac/Desktop/pandora-market-setup-shareable/scripts/lib/surface_e2e_runner.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/tests/helpers/mcp_tool_sweep.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/tests/unit/surface_e2e_runner.test.cjs`

## Resources

- Surface report: [surface-e2e-agent-fast.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/surface-e2e-agent-fast.json)
- Agent acceptance runner: [agent_acceptance_runner.cjs](/Users/mac/Desktop/pandora-market-setup-shareable/scripts/lib/agent_acceptance_runner.cjs)

## Acceptance Criteria

- [ ] The `cli-json` breadth sweep no longer reports long-running/unbounded command families as generic transport failures
- [ ] The report makes clear which commands were intentionally excluded, bounded, or treated separately
- [ ] Short-lived CLI JSON commands remain fully covered
- [ ] Unit coverage exists for the new classification behavior

## Work Log

### 2026-03-13 - Todo creation

**By:** Codex

**Actions:**
- converted the remaining red item from the broad surface sweep into a focused worker todo
- captured the exact failing command names from the surface report
- scoped the task around sweep policy and classification rather than command semantics

**Learnings:**
- the main remaining breadth-sweep problem is not “broken tools”
- the report needs to distinguish long-running surfaces from real failures

## Notes

- Do not hide legitimate failures. Only reclassify commands that are truly incompatible with the current sweep shape.
