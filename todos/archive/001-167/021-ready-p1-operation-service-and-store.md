---
status: ready
priority: p1
issue_id: "021"
tags: [agent-platform, phase1, operations, state]
dependencies: ["020"]
---

# Operation Service And Store

## Problem Statement

Pandora lacks a first-class operation model for mutable work. Agents need durable `operationId`, `operationHash`, checkpointing, and lifecycle state to safely resume and reason about partial execution.

## Findings

- Existing daemon/state patterns (`mirror`, `autopilot`, `sports`) show the repo already tolerates file-backed runtime state.
- Current mutating commands return immediate envelopes, not durable operation records.
- There is no single lifecycle enum shared across mutable workflows.

## Proposed Solutions

### Option 1: In-memory operations with optional persistence

**Pros:** simpler

**Cons:** not durable enough for agent workflows

**Effort:** 1-2 days

**Risk:** High

---

### Option 2: File-backed operation store with deterministic hashes

**Pros:** durable, simple, local-first, compatible with remote gateway later

**Cons:** requires migration work across mutators

**Effort:** 2-3 days

**Risk:** Medium

## Recommended Action

Build a shared file-backed operation service under `cli/lib/` with deterministic normalization, immutable `operationHash`, lifecycle transitions, checkpoint append support, and audit-safe writes.

## Technical Details

**Likely files:**
- `cli/lib/operation_service.cjs`
- `cli/lib/operation_state_store.cjs`
- `cli/lib/shared/operation_hash.cjs`
- `cli/lib/shared/operation_states.cjs`

**Core model:**
- `planned`
- `validated`
- `queued`
- `executing`
- `checkpointed`
- `completed`
- `failed`
- `canceled`
- `closed`

## Acceptance Criteria

- [ ] Shared operation service exists
- [ ] Shared store writes atomically with stable ids/hashes
- [ ] Operation normalization is deterministic
- [ ] Checkpoint append/read APIs exist
- [ ] Unit tests cover lifecycle transitions and hash stability

## Work Log

### 2026-03-07 - Todo Created

**By:** Codex

**Actions:**
- Defined the operation-core scope as the Phase 1 foundation

**Learnings:**
- This task is the dependency anchor for the rest of Phase 1.

