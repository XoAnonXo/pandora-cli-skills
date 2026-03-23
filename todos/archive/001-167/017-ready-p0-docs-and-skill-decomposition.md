---
status: ready
priority: p0
issue_id: "017"
tags: [agent-platform, docs, skills, retrieval, phase0]
dependencies: ["014", "015", "016"]
---

# Phase 0 Docs and Skill Decomposition

Restructure the agent/operator docs so contracts stay authoritative while retrieval becomes smaller and more workflow-oriented.

## Problem Statement

`SKILL.md` is accurate but too monolithic for optimal agent retrieval. README examples also need to reflect the new capabilities surface.

## Technical Scope

**Primary files:**
- `SKILL.md`
- `README.md`
- `README_FOR_SHARING.md`
- `docs/skills/` or `skills/` (new generated/scoped docs as appropriate)

## Required Deliverables

- Add `capabilities` command to docs
- Remove/repair stale examples and category drift
- Introduce scoped skill docs for at least:
  - mirror
  - sports
  - trading
  - mcp
  - risk
- Reduce root `SKILL.md` into an index/overview that routes to scoped docs

## Acceptance Criteria

- [ ] Root docs mention the new agent surfaces correctly
- [ ] Root `SKILL.md` is no longer the only source of workflow guidance
- [ ] New scoped skill docs exist and are linked
- [ ] No stale category/timestamp/mirror guidance remains
