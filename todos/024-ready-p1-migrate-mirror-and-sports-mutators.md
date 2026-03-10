---
status: ready
priority: p1
issue_id: "024"
tags: [agent-platform, phase1, mirror, sports, migration]
dependencies: ["021", "022"]
---

# Migrate Mirror And Sports Mutators To Operations

## Problem Statement

Mirror and sports are the most agent-sensitive mutable workflows in Pandora. They already carry heavy safety logic, but they still execute as direct commands rather than durable operations with shared lifecycle semantics.

## Findings

- `mirror.deploy`, `mirror.go`, `mirror.close`, `mirror.sync.*`, `sports.create.run`, and `sports.sync.*` are the highest-leverage migrations.
- These commands already have strong preflight/validation semantics and should become operation-backed first.
- This is the most visible Phase 1 user-facing improvement.

## Proposed Solutions

### Option 1: Partial migration of deploy-only paths

**Pros:** faster

**Cons:** leaves sync/close lifecycle fragmented

**Effort:** 2 days

**Risk:** Medium

---

### Option 2: Migrate the full mirror/sports mutation set onto the new operation service

**Pros:** coherent, highest impact, best fit for agents

**Cons:** broader touch surface

**Effort:** 3-4 days

**Risk:** Medium

## Recommended Action

Migrate the core mirror and sports mutators onto operations in one controlled pass, starting with dry-run/plan parity and then execute/status/cancel/close semantics.

## Technical Details

**Target commands:**
- `mirror.deploy`
- `mirror.go`
- `mirror.close`
- `mirror.sync.once|run|start|stop|status`
- `sports.create.run`
- `sports.sync.once|run|start|stop|status`

## Acceptance Criteria

- [ ] Operation ids returned for migrated mutating commands
- [ ] Status endpoints reference shared operation state
- [ ] Checkpoints exist for multi-step flows
- [ ] Existing JSON contracts remain backward compatible where feasible
- [ ] CLI, schema, MCP, and docs are aligned

## Work Log

### 2026-03-07 - Todo Created

**By:** Codex

**Actions:**
- Defined migration scope for the highest-value mutable workflows

