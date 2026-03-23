---
status: ready
priority: p1
issue_id: "020"
tags: [agent-platform, phase1, operations, orchestration]
dependencies: ["019"]
---

# Phase 1 Operation Protocol Index

## Problem Statement

Phase 0 hardened the contract layer, but mutable Pandora workflows are still mostly command-oriented rather than operation-oriented. For agents, this creates friction around resumability, status tracking, cancellation, webhook delivery, and auditability. Phase 1 needs to turn mutating work into durable operations with consistent lifecycle semantics.

## Findings

- Phase 0 now exposes strong machine contracts through `schema`, `capabilities`, and MCP.
- Mutating flows such as `mirror.deploy`, `mirror.go`, `sports.create.run`, `claim`, and `resolve` still execute directly rather than through a durable operation object.
- Long-running flows (`mirror.sync`, `sports.sync`, closeout-style flows) already behave like jobs operationally, but do not share one formal protocol.
- Agents need consistent `plan -> validate -> execute -> status -> cancel|close` semantics with immutable operation hashes.

## Proposed Solutions

### Option 1: Minimal wrapper around existing commands

**Approach:** Add an operation envelope on top of current mutable commands without changing execution internals.

**Pros:**
- Fastest initial delivery
- Minimal risk to working command paths

**Cons:**
- Weak resumability
- Inconsistent checkpoints
- Harder to evolve into remote MCP and SDKs

**Effort:** 2-3 days

**Risk:** Medium

---

### Option 2: Introduce a real operation service and migrate mutators incrementally

**Approach:** Add shared operation primitives, state model, checkpoint store, and operation hash semantics. Migrate highest-value mutators first.

**Pros:**
- Durable foundation for Phase 2+
- Consistent lifecycle semantics
- Fits remote gateway, SDK, recipes, and policy packs cleanly

**Cons:**
- More invasive than a wrapper
- Requires stronger test coverage during migration

**Effort:** 5-7 days

**Risk:** Medium

## Recommended Action

Implement Option 2. Phase 1 should build the operation protocol properly, then migrate the highest-value mutable tools in priority order. The six execution todos below decompose the work into parallelizable ownership slices.

## Technical Details

**Primary areas:**
- `cli/lib/`
- command services for mutating commands
- MCP execution boundary
- schema/capabilities generation
- docs/skills and test harnesses

## Acceptance Criteria

- [ ] Operation protocol exists as shared service and storage layer
- [ ] Operation ids and immutable hashes are deterministic
- [ ] Mutable commands support operation-aware execution semantics
- [ ] Status/cancel/close surfaces exist where applicable
- [ ] Webhook lifecycle events exist for operations
- [ ] Phase 1 test/audit gate is green

## Work Log

### 2026-03-07 - Phase 1 Board Created

**By:** Codex

**Actions:**
- Converted Phase 1 roadmap into executable todo files
- Split ownership across six agent-aligned workstreams
- Established dependency chain on verified Phase 0 completion

**Learnings:**
- The next constraint is not command coverage; it is operation durability and lifecycle coherence.

