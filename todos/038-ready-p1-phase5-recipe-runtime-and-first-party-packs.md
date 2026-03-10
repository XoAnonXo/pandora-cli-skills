---
status: ready
priority: p1
issue_id: "038"
tags: [agent-platform, phase5, recipes, runtime]
dependencies: ["036", "037"]
---

# Phase 5 Recipe Runtime and First-Party Packs

## Problem Statement

The recipe platform only becomes valuable once it can execute real first-party workflows safely and predictably using the existing operation protocol.

## Findings

- High-value workflow candidates are already obvious from current usage: mirror safely, create soccer market conservatively, close finalized positions, sync in paper mode, claim claimable markets.
- Operation protocol and policy/profile enforcement already provide the right substrate.
- Recipe execution must compile to normal operations to avoid creating a second execution engine.

## Proposed Solutions

### Option 1: Add a generic recipe runner first and defer first-party packs

**Approach:** Build runtime plumbing and leave workflow examples for later.

**Pros:**
- Smaller first increment

**Cons:**
- Low immediate value to users/agents
- Harder to validate design quality

**Effort:** 2 days

**Risk:** Medium

---

### Option 2: Build runtime together with a small set of first-party recipes

**Approach:** Implement compilation/execution and ship canonical workflow packs alongside it.

**Pros:**
- Faster user value
- Better test coverage of real workflows
- Cleaner docs and benchmark story

**Cons:**
- Broader initial scope

**Effort:** 3-4 days

**Risk:** Medium

## Recommended Action

Implement Option 2 and use first-party recipes to force a high-quality runtime design.

## Acceptance Criteria

- [ ] `recipe validate` and `recipe run` exist
- [ ] Recipe execution returns operation ids and checkpoints
- [ ] At least four first-party recipes ship
- [ ] Recipe runs honor policy/profile constraints and return structured denials

## Work Log

### 2026-03-08 - Todo Created

**By:** Codex

**Actions:**
- Added dedicated runtime/first-party pack workstream for Phase 5
- Chose high-value initial workflows based on current operator pain points

**Learnings:**
- First-party recipes are part of the design process, not just launch content.
