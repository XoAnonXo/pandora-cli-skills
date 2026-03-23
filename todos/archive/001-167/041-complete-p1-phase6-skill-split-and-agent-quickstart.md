---
status: complete
priority: p1
issue_id: "041"
tags: [agent-platform, phase6, docs, quickstart]
dependencies: ["040"]
---

# Phase 6 Skill Split and Agent Quickstart

## Problem Statement

Agents should not need to ingest a large omnibus guide to understand Pandora. The current docs need a sharper split by workflow and transport, plus an explicit agent quickstart that tells a model exactly how to begin.

## Findings

- `docs/skills/` currently has a limited set of broad files.
- `SKILL.md` still acts as a heavy router rather than a truly minimal index.
- There is no dedicated “agent quickstart” focused on capabilities/schema -> choose tool -> preflight -> execute.

## Proposed Solutions

### Option 1: Add a quickstart section inside `SKILL.md`

**Approach:** Keep file count stable and add more routing text to the top-level skill.

**Pros:**
- Smaller change

**Cons:**
- Worsens the omnibus problem
- Keeps retrieval chunks large

**Effort:** <1 day

**Risk:** High

### Option 2: Add workflow-specific docs and a dedicated agent quickstart

**Approach:** Create targeted docs such as `agent-quickstart`, `trading`, `portfolio-closeout`, and `policy-profiles`, then slim `SKILL.md` into a true index.

**Pros:**
- Better retrieval quality
- Better onboarding
- Easier future extension

**Cons:**
- Requires cross-file link maintenance

**Effort:** 1-2 days

**Risk:** Medium

## Recommended Action

Implement Option 2 and ensure the top-level skill is a concise router rather than a second manual.

## Acceptance Criteria

- [x] New workflow docs exist for agent quickstart and at least three high-value workflow buckets
- [x] `SKILL.md` routes to those docs concisely
- [x] Local CLI, stdio MCP, remote MCP, TypeScript SDK, and Python SDK examples are included
- [x] “Which tool first?” guidance exists for major tasks

## Work Log

### 2026-03-08 - Phase 6 Quickstart Todo Created

**By:** Codex

**Actions:**
- Split out the quickstart/scope problem as its own workstream

**Learnings:**
- Routing docs should optimize for retrieval chunk size, not just human readability.

### 2026-03-08 - Quickstart and Skill Split Completed

**By:** Codex

**Actions:**
- Added workflow docs for quickstart, trading, mirror operations, policy/profiles, capabilities, and closeout guidance
- Slimmed top-level routing so `SKILL.md` acts as an index rather than a second manual

**Learnings:**
- The agent quickstart is the most important doc because it defines the initial tool-selection behavior.
