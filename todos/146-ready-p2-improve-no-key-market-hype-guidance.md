---
status: ready
priority: p2
issue_id: "146"
tags: [hype, ideation, cli, docs, onboarding, agents]
dependencies: []
---

# Improve no-key market hype guidance and fallback UX

The no-key ideation path is operational, but it still feels like a test harness rather than a polished user flow. Real users can get suggestions, yet the mock provider is visibly placeholder quality and the prompt-only fallback hard-fails unless the caller already knows to provide `--area`.

## Problem Statement

A fresh user who wants market suggestions without live AI-provider credentials should still get a coherent onboarding experience. Today Pandora technically supports that case, but the guidance is uneven:

- `markets.hype.plan --ai-provider mock` is usable but obviously test-only
- `agent market hype` is a viable fallback, but it requires `--area` and fails abruptly if omitted

That is acceptable for internal testing, but weak for external onboarding.

## Findings

- The live scenario `hype-no-ai-keys` in [onboarding-cli-10.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/onboarding-cli-10.json) completed with status `achieved-with-test-only-guidance`.
- The scenario recorded two friction points:
  - `Fallback prompt mode requires one extra required input`
  - `Mock hype planning is operational but still placeholder quality`
- Relevant code and docs appear in:
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/markets_hype_command_service.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/agent_command_service.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/agent_market_prompt_service.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/hype_market_provider.cjs`

## Proposed Solutions

### Option 1: Keep behavior but improve messaging everywhere

**Approach:** Mark `mock` as test-only in help/docs/output and make missing-area errors point directly to a working fallback command.

**Pros:**
- Low-risk
- Immediately improves onboarding copy

**Cons:**
- Does not reduce the extra input requirement
- Still leaves fallback flow slightly clunky

**Effort:** 2-4 hours

**Risk:** Low

---

### Option 2: Improve fallback ergonomics as well

**Approach:** In addition to better messaging, infer a default area from context when safe or return a stronger guided error with suggested valid areas.

**Pros:**
- Better agent UX
- Less brittle fallback path

**Cons:**
- Slightly higher risk of wrong inference
- Requires careful contract design for agent callers

**Effort:** 4-8 hours

**Risk:** Medium

## Recommended Action

Implement Option 1 at minimum. If the worker can improve fallback ergonomics safely without making agent behavior ambiguous, include the smaller Option 2 improvement as part of the same pass. The important product rule is that `mock` must look like test mode, not real suggestion quality.

## Technical Details

**Likely affected files:**
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/markets_hype_command_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/agent_command_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/agent_market_prompt_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/docs/skills/agent-quickstart.md`

**Related scenario:**
- `hype-no-ai-keys`

## Resources

- Scenario report: [onboarding-cli-10.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/onboarding-cli-10.json)
- Existing MCP todo: [142-ready-p1-mcp-parimutuel-onboarding-and-dry-run.md](/Users/mac/Desktop/pandora-market-setup-shareable/todos/142-ready-p1-mcp-parimutuel-onboarding-and-dry-run.md)

## Acceptance Criteria

- [ ] Help/docs/output clearly present `mock` as test-only and provider-backed planning as the preferred real-user path
- [ ] The fallback `agent market hype` path gives a clearer next step when `--area` is missing
- [ ] Machine-readable outputs remain stable for agent callers
- [ ] The `hype-no-ai-keys` scenario still passes and reports less friction

## Work Log

### 2026-03-13 - Todo creation

**By:** Codex

**Actions:**
- converted the no-key ideation findings into a scoped onboarding task
- connected the new item to the existing MCP parimutuel todo because the guidance overlaps
- kept the scope on messaging and fallback ergonomics rather than provider integration itself

**Learnings:**
- the no-key path is already valuable, but it currently feels like internal tooling
- this should be improved without weakening the deterministic mock/testing story

## Notes

- Preserve the distinction between provider-backed planning and prompt-orchestration fallback.
