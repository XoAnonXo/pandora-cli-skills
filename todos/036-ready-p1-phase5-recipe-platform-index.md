---
status: ready
priority: p1
issue_id: "036"
tags: [agent-platform, phase5, recipes]
dependencies: ["035"]
---

# Phase 5 Recipe Platform Index

## Problem Statement

Agents should not have to rediscover best-practice Pandora workflows from scratch. Phase 5 turns high-value workflows into reusable recipes that compile to ordinary operations under policies and profiles.

## Findings

- The current platform already has the prerequisites: shared contract registry, remote MCP, operations, capabilities, policies, and profiles.
- The next leverage point is workflow packaging rather than more raw commands.
- Recipe execution must not create a shadow engine; it should compile into existing operation flows.

## Proposed Solutions

### Option 1: Document recipes only

**Approach:** Publish example workflows in docs and leave execution orchestration to agents.

**Pros:**
- Low implementation cost

**Cons:**
- Weak repeatability
- Harder to benchmark and support

**Effort:** 1 day

**Risk:** Medium

---

### Option 2: Build a formal recipe registry and runtime that targets existing operations

**Approach:** Define recipe schema, validate recipes, and execute them by compiling to standard Pandora operations with policy/profile bindings.

**Pros:**
- Strong agent ergonomics
- Reusable best-practice workflows
- Easier benchmarking and support

**Cons:**
- More platform surface to maintain

**Effort:** 4-6 days

**Risk:** Medium

## Recommended Action

Implement Option 2. Recipes are the next major step toward making Pandora the easiest high-safety tool for agents.

## Acceptance Criteria

- [ ] Recipe schema and registry exist
- [ ] Recipe execution compiles to ordinary operations
- [ ] First-party recipes cover mirror, sports, closeout, and claim workflows
- [ ] Recipe docs and validation surfaces exist
- [ ] Phase 5 audit gate is green

## Work Log

### 2026-03-08 - Phase 5 Board Created

**By:** Codex

**Actions:**
- Added the formal Phase 5 board after Phase 4 stabilization work
- Framed recipes as the workflow layer over existing operations/policies/profiles

**Learnings:**
- The biggest usability jump now comes from reusable workflows, not more individual commands.
