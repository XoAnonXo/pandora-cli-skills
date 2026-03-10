---
status: complete
priority: p1
issue_id: "040"
tags: [agent-platform, phase6, docs, skills]
dependencies: ["031"]
---

# Phase 6 Docs and Skills Platform Index

## Problem Statement

Pandora now has serious CLI, MCP, remote gateway, and SDK surface area, but the current documentation is still too omnibus-shaped for optimal agent retrieval. Phase 6 should rebuild the docs/skills layer into smaller workflow-scoped units with explicit local/MCP/SDK usage guidance and parity tests.

## Findings

- The current doc router in `SKILL.md` is much better than earlier versions, but it still points at a handful of broad documents.
- Agents benefit from smaller retrieval scopes such as discovery, trading, mirror, closeout, policies/profiles, and SDK/bootstrap.
- The doc set needs stronger machine-verifiable parity with the live contract and published package.

## Proposed Solutions

### Option 1: Keep the current docs and add more sections

**Approach:** Expand `SKILL.md` and current docs with more headings and examples.

**Pros:**
- Low effort
- Minimal file churn

**Cons:**
- Weak retrieval quality for agents
- Drift remains hard to detect
- Command/transport examples stay mixed together

**Effort:** 1 day

**Risk:** High

### Option 2: Rebuild the docs as a scoped skill platform with parity gates

**Approach:** Introduce smaller workflow-specific skill docs, add a focused agent quickstart, generate or verify command summaries from the contract registry, and add doc-parity tests.

**Pros:**
- Better agent retrieval
- Better external onboarding
- Lower drift risk

**Cons:**
- More moving pieces
- Requires doc/test discipline

**Effort:** 2-3 days

**Risk:** Medium

## Recommended Action

Implement Option 2. Treat Phase 6 as a productization pass for the agent-facing docs layer, not as optional polish.

## Technical Details

**Primary areas:**
- `SKILL.md`
- `README.md`
- `README_FOR_SHARING.md`
- `docs/skills/**`
- doc/test helper scripts under `scripts/`
- doc parity tests under `tests/unit/` and `tests/cli/`

## Acceptance Criteria

- [x] Skill/doc routing is split into smaller workflow-specific documents
- [x] There is a dedicated agent quickstart for local CLI, stdio MCP, remote MCP, and SDK use
- [x] Command/transport references are generated or strongly parity-checked against the shared contract
- [x] Docs explain “which tool should I call first?” for major workflows
- [x] Phase 6 audit gate is green

## Work Log

### 2026-03-08 - Phase 6 Board Created

**By:** Codex

**Actions:**
- Created the Phase 6 umbrella board for docs/skills rebuild work
- Scoped the phase around retrieval quality, onboarding quality, and parity enforcement

**Learnings:**
- For external agents, documentation quality is part of runtime quality, not a separate concern.

### 2026-03-08 - Phase 6 Completed

**By:** Codex

**Actions:**
- Split the skill/doc platform into smaller workflow-scoped docs under `docs/skills/`
- Added the agent quickstart and contract-driven doc parity checks
- Closed the Phase 6 audit gate with green unit, CLI, and agent workflow suites

**Learnings:**
- A smaller doc surface materially improves agent retrieval quality and is worth treating as core platform work.
