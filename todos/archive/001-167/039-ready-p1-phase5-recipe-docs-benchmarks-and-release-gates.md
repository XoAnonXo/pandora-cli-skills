---
status: ready
priority: p1
issue_id: "039"
tags: [agent-platform, phase5, recipes, release]
dependencies: ["038"]
---

# Phase 5 Recipe Docs, Benchmarks, and Release Gates

## Problem Statement

Recipes will become the main on-ramp for external agents. They need explicit docs, test coverage, and benchmark hooks before they can be treated as production-ready.

## Findings

- Current documentation is still largely command-centric.
- Benchmark and trust layers are planned for later phases, but recipe success should already feed into that framework.
- Recipe releases will otherwise regress through docs drift, contract mismatch, or missing policy/profile examples.

## Proposed Solutions

### Option 1: Ship recipes first and benchmark them later

**Approach:** Focus on runtime and postpone docs/benchmarks until a later release.

**Pros:**
- Faster initial delivery

**Cons:**
- Weak adoption story
- Harder to prove external readiness

**Effort:** 1 day

**Risk:** Medium

---

### Option 2: Treat docs/benchmarks/release gates as part of Phase 5 itself

**Approach:** Include recipe docs, smoke tests, and benchmark hooks in the same phase.

**Pros:**
- Stronger launch quality
- Easier future certification/eval story
- Better external trust

**Cons:**
- More up-front scope

**Effort:** 2 days

**Risk:** Low

## Recommended Action

Implement Option 2. Recipes are only valuable if they are documented, validated, and benchmarkable from day one.

## Acceptance Criteria

- [ ] Agent-facing recipe docs exist and are retrieval-friendly
- [ ] Recipe smoke/tests cover the first-party packs
- [ ] Benchmark harness can invoke recipe flows deterministically
- [ ] A named Phase 5 audit gate exists before release

## Work Log

### 2026-03-08 - Todo Created

**By:** Codex

**Actions:**
- Added recipe docs/release-gate workstream
- Linked recipe quality directly to benchmarkability and external trust

**Learnings:**
- Recipes change the product narrative, so release discipline matters as much as runtime code.
