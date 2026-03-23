---
status: ready
priority: p1
issue_id: "013"
tags: [roadmap, planning, tracking]
dependencies: []
---

# Quant Roadmap Index

Master index for quant expansion todos created from `quant_desk_simulation.md` alignment.

## Problem Statement

The quant expansion work spans multiple modeling, CLI, and release-hardening lanes, so it needs a single orchestration index instead of a loose bundle of parallel notes.

## Findings

- The roadmap already decomposes cleanly into core infrastructure, feature commands, integration, and hardening.
- The main risk is sequencing drift between parallel workstreams, not missing task discovery.
- Recording shipped status directly in the index is enough to keep the plan grounded.

## Proposed Solutions

- Keep this file as a lightweight umbrella index for execution order, dependency shape, and concrete shipped status.
- Leave implementation detail and acceptance specifics in the child todos rather than duplicating them here.

## Recommended Action

Use this file as the orchestration layer for `001`-`012` and update it only when dependency order or concrete shipped status changes.

## Recommended Execution Order

1. `001` Quant core library and storage foundations
2. Parallel after `001`: `002`, `003`, `004`, `005`, `006`, `007`
3. After `001` + command baselines: `008`, `009`, `010`
4. Integration pass: `011`
5. Hardening and release gate: `012`

## Dependency Summary

- Root: `001`
- Integration umbrella: `011` depends on all feature tasks
- Final release gate: `012` depends on `011` + all feature tasks

## Status Notes (2026-03-02)

- `007` baseline implementation landed:
  - Added deterministic ABM module (`cli/lib/quant/abm_market.cjs`)
  - Added simulate-agents handler (`cli/lib/simulate_handlers/agents.cjs`)
  - Added ABM unit coverage (`tests/unit/abm_market.test.cjs`)
- `012` hardening/doc baseline updated:
  - Added quant ABM module-contract docs in `README.md`, `README_FOR_SHARING.md`, and `SKILL.md`
  - Added ABM unit suite to default `test:unit` script in `package.json`
  - Coverage notes now include determinism, metrics shape, parser/handler behavior, and runtime-bound checks
- Remaining `012` release-gate scope still pending outside this baseline pass:
  - Full integration/perf/release checklist execution

## Acceptance Criteria

- [ ] All referenced todo files exist and are `ready`
- [ ] Dependency chain is acyclic and executable
- [ ] Priorities reflect implementation risk/value

## Work Log

### 2026-03-02 - Initial Index Creation

**By:** Codex

**Actions:**
- Created 12 executable todos plus index
- Mapped tasks to article layers (MC, IS, PF, copula, ABM, monitoring)

**Learnings:**
- Root dependency discipline is critical to avoid quant logic fragmentation

### 2026-03-02 - Baseline Status Refresh (007 + 012)

**By:** Codex

**Actions:**
- Recorded `007` implementation artifacts (ABM core, simulate-agents handler, unit tests)
- Added hardening baseline notes for `012` docs + coverage updates
- Logged ABM runtime complexity/test coverage expectations in index status

**Learnings:**
- Keeping index status tied to concrete file-level artifacts avoids roadmap drift while parallel agents land adjacent command wiring.
