---
status: ready
priority: p1
issue_id: "037"
tags: [agent-platform, phase5, recipes, contracts]
dependencies: ["036"]
---

# Phase 5 Recipe Schema and Registry

## Problem Statement

A recipe system needs a formal schema and registry before it can be executed or documented safely. Without that, recipes become ad hoc scripts and lose the benefits of contract generation.

## Findings

- Recipes need to bind to existing tools, policies, profiles, and operation phases.
- Contract generation infrastructure already exists and can likely emit recipe schemas and manifests.
- Signed or provenance-aware recipes are a future trust feature, so the base format should support metadata cleanly from day one.

## Proposed Solutions

### Option 1: Keep recipes as loose YAML workflows

**Approach:** Define only minimal YAML conventions and parse them dynamically.

**Pros:**
- Fastest to prototype

**Cons:**
- Weak validation
- Harder SDK/doc generation
- Easy to drift from tool contracts

**Effort:** 1-2 days

**Risk:** High

---

### Option 2: Define a strict recipe schema tied to tool/operation contracts

**Approach:** Model recipes as contract-aware workflow manifests with typed inputs, steps, and policy/profile requirements.

**Pros:**
- Strong validation and docs generation
- Better portability and trust
- Easier benchmark coverage later

**Cons:**
- Slightly more upfront schema work

**Effort:** 2-3 days

**Risk:** Low

## Recommended Action

Implement Option 2. Recipes should feel like first-class platform artifacts, not userland scripts.

## Acceptance Criteria

- [ ] Recipe schema versioning exists
- [ ] Registry can list/get/validate recipe manifests
- [ ] Recipes can declare required tools, policies, and profiles
- [ ] Schema is documented and exported for SDK consumers

## Work Log

### 2026-03-08 - Todo Created

**By:** Codex

**Actions:**
- Added recipe schema/registry as its own workstream
- Linked it to the existing contract infrastructure

**Learnings:**
- Recipe quality depends on strong upfront schema design, not just a runtime runner.
