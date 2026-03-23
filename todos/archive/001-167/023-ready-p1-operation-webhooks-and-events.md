---
status: ready
priority: p1
issue_id: "023"
tags: [agent-platform, phase1, webhooks, events, notifications]
dependencies: ["021"]
---

# Operation Webhooks And Events

## Problem Statement

Agents and orchestrators should not have to poll every long-running or multi-step mutation. Pandora needs structured operation lifecycle events and webhook delivery to support external orchestration and remote usage.

## Findings

- Webhook primitives already exist in the repo, but not as a shared operation event bus.
- Existing long-running flows produce diagnostics, but not standardized lifecycle notifications.
- Phase 2 remote gateway will depend on this infrastructure.

## Proposed Solutions

### Option 1: Poll-only status API

**Pros:** easiest

**Cons:** poor orchestration UX, higher control-plane cost

**Effort:** <1 day

**Risk:** Medium

---

### Option 2: Add operation event model with optional webhook sinks

**Pros:** scalable, orchestration-friendly, future remote-compatible

**Cons:** more moving pieces

**Effort:** 1-2 days

**Risk:** Medium

## Recommended Action

Implement internal operation events and a webhook delivery adapter for lifecycle transitions. Keep delivery optional and policy-controlled.

## Technical Details

**Likely files:**
- `cli/lib/operation_event_bus.cjs`
- `cli/lib/operation_webhook_service.cjs`
- integration with `webhook` family and operation service

**Event types:**
- `operation.planned`
- `operation.validated`
- `operation.executing`
- `operation.checkpointed`
- `operation.completed`
- `operation.failed`
- `operation.canceled`
- `operation.closed`

## Acceptance Criteria

- [ ] Lifecycle events are emitted deterministically
- [ ] Webhook payloads are signed/structured consistently
- [ ] Failed webhook delivery does not corrupt operation state
- [ ] Tests cover event emission and delivery failure handling

## Work Log

### 2026-03-07 - Todo Created

**By:** Codex

**Actions:**
- Scoped webhook/event-bus work as a dedicated Phase 1 thread

