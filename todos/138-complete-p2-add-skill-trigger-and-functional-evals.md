---
status: complete
priority: p2
issue_id: "138"
tags: [skills, anthropic, evaluation, testing, triggers, regression]
dependencies: ["135", "136", "137"]
---

# Add skill trigger and functional evals

## Problem Statement

The repo currently validates internal docs and product surfaces, but it does not validate whether the Anthropic-facing skill actually triggers at the right times, avoids irrelevant activation, or improves workflow execution versus a baseline. Anthropic's guide explicitly recommends testing obvious triggers, paraphrased triggers, non-triggers, and end-to-end workflow behavior.

Without this, future edits can silently make the skill less discoverable or less reliable even if the underlying Pandora product remains correct.

## Findings

- [`scripts/check_skill_docs.cjs`](../scripts/check_skill_docs.cjs) verifies the Pandora doc router, not Anthropic triggering semantics.
- [`package.json`](../package.json) contains build, trust, SDK, smoke, CLI, and benchmark checks, but no dedicated Anthropic skill-eval script.
- The current repo already has strong candidate scenarios for functional evaluation:
  - bootstrap contract discovery
  - profile readiness inspection
  - quote before mutation
  - mirror planning and validation routing
- Anthropic's guide recommends three evaluation categories:
  - triggering tests
  - functional tests
  - performance comparison versus baseline
- There is no documented “should trigger / should not trigger” prompt set in the repo today.

## Proposed Solutions

### Option 1: Manual checklist only

**Approach:** Add a markdown checklist and rely on human spot checks.

**Pros:**
- Simple
- No tooling needed

**Cons:**
- Easy to skip
- No regression protection

**Effort:** 1-2 hours

**Risk:** High

---

### Option 2: Hybrid eval system

**Approach:** Add a versioned prompt fixture set plus:
- manual trigger review guidance
- scripted artifact validation
- optional API/Claude Code harness notes for repeatable runs

**Pros:**
- Good rigor without over-engineering
- Matches Anthropic's current guide
- Easier to maintain in-repo

**Cons:**
- Some qualitative checks still require human judgment

**Effort:** 0.5-1 day

**Risk:** Low

---

### Option 3: Full automated eval framework before any other work

**Approach:** Build a comprehensive agent-eval runner for all skill behavior up front.

**Pros:**
- Maximum rigor

**Cons:**
- Higher cost than the immediate problem requires
- Could stall shipping the actual skill improvements

**Effort:** 2-4 days

**Risk:** Medium

## Recommended Action

Use Option 2.

Add a hybrid evaluation track with four pieces:

1. **Trigger fixture set**
   - should trigger
   - paraphrased should trigger
   - should not trigger
2. **Functional scenario set**
   - bootstrap
   - quote
   - mirror plan/preflight
   - profile readiness
   - MCP startup guidance
3. **Artifact checks**
   - bundle contains required files
   - frontmatter fields are valid
   - references resolve
4. **Baseline comparison notes**
   - estimate conversation/tool-call reduction with and without the skill for representative tasks

The goal is not perfect automation. The goal is to make trigger regressions and packaging regressions visible before release.

## Technical Details

**Likely files:**
- [`package.json`](../package.json)
- [`scripts/check_skill_docs.cjs`](../scripts/check_skill_docs.cjs)
- new skill-eval fixtures under `tests/` or `references/`
- Anthropic-facing bundle from issue `136`

**Possible additions:**
- `tests/skills/trigger-fixtures.json`
- `tests/skills/functional-scenarios.json`
- `scripts/check_anthropic_skill_bundle.cjs`
- `docs/skills/anthropic-skill-evals.md`

**Suggested trigger examples:**
- should trigger:
  - “bootstrap Pandora for an agent”
  - “quote this Pandora market before I buy”
  - “help me plan a mirror market from Polymarket”
- paraphrase should trigger:
  - “what should I call first in Pandora?”
  - “is my signer profile ready?”
- should not trigger:
  - “summarize this PDF”
  - “help me write React code”
  - “what happened in bitcoin today?”

## Resources

- Anthropic guide: [The Complete Guide to Building Skills for Claude](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf)
- Existing router/doc check: [`scripts/check_skill_docs.cjs`](../scripts/check_skill_docs.cjs)
- Existing workflow sources:
  - [`docs/skills/agent-quickstart.md`](../docs/skills/agent-quickstart.md)
  - [`docs/skills/trading-workflows.md`](../docs/skills/trading-workflows.md)
  - [`docs/skills/mirror-operations.md`](../docs/skills/mirror-operations.md)

## Acceptance Criteria

- [x] A versioned should-trigger / should-not-trigger fixture set exists.
- [x] Functional scenarios cover the main Pandora skill jobs.
- [x] Anthropic bundle validation is part of a repeatable local check path.
- [x] The evaluation docs explain what is automated versus what still needs human review.
- [x] The repo has a way to detect frontmatter, packaging, and link-resolution regressions before release.

## Work Log

### 2026-03-09 - Evaluation gap identified

**By:** Codex

**Actions:**
- Compared Anthropic's recommended evaluation model with existing Pandora checks
- Identified the missing trigger, non-trigger, and functional scenario coverage
- Defined a hybrid evaluation plan that fits the current repo without overbuilding

**Learnings:**
- The missing eval work is skill-behavior-specific; the current product and docs test suite is not a substitute

### 2026-03-09 - Added Anthropic skill eval assets

**By:** Codex

**Actions:**
- Added trigger fixtures at [`tests/skills/trigger-fixtures.json`](../tests/skills/trigger-fixtures.json)
- Added functional scenario coverage at [`tests/skills/functional-scenarios.json`](../tests/skills/functional-scenarios.json)
- Added a reusable manual results template at [`tests/skills/manual-eval-template.md`](../tests/skills/manual-eval-template.md)
- Added evaluation guidance at [`docs/skills/anthropic-skill-evals.md`](../docs/skills/anthropic-skill-evals.md)
- Integrated `npm run check:anthropic-skill` as the repeatable bundle-structure gate in [`package.json`](../package.json)

**Learnings:**
- A lightweight fixture-and-template system is enough to make future trigger regressions obvious without inventing a separate benchmark framework
