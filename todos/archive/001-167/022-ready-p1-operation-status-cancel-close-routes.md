---
status: ready
priority: p1
issue_id: "022"
tags: [agent-platform, phase1, operations, cli, mcp]
dependencies: ["021"]
---

# Operation Status Cancel Close Routes

## Problem Statement

Even if operations are stored durably, agents still need standard control surfaces to inspect and control them. Without explicit `status`, `cancel`, and `close`, long-running or partially-completed work remains operationally awkward.

## Findings

- Current command families already approximate these semantics ad hoc (`mirror.sync status|stop`, lifecycle status/resolve, closeout-style flows).
- There is no generic operation namespace or universal lifecycle control route.
- MCP and schema need a standard contract for operation controls.

## Proposed Solutions

### Option 1: Add only internal APIs

**Pros:** less user-visible churn

**Cons:** agents still lack a stable explicit control plane

**Effort:** 1 day

**Risk:** Medium

---

### Option 2: Add an `operations` command family and wire MCP/schema support

**Pros:** consistent, explicit, reusable by local CLI and future remote gateway

**Cons:** adds new public surface

**Effort:** 1-2 days

**Risk:** Low

## Recommended Action

Implement `operations get|list|cancel|close` and wire the same contracts into MCP/schema/capabilities. Keep cancellation semantics explicit and tool-specific when necessary.

## Technical Details

**Likely files:**
- `cli/lib/operations_command_service.cjs`
- `cli/lib/parsers/operations_flags.cjs`
- routing updates
- schema/MCP registry integration

## Acceptance Criteria

- [ ] `operations get` returns lifecycle, checkpoints, result/recovery metadata
- [ ] `operations list` supports filtering by status/tool family
- [ ] `operations cancel` works for cancelable operations
- [ ] `operations close` works for closable operations
- [ ] schema/capabilities/MCP expose the new family cleanly

## Work Log

### 2026-03-07 - Todo Created

**By:** Codex

**Actions:**
- Defined universal control-plane routes needed once operation storage lands

