---
status: ready
priority: p1
issue_id: "161"
tags: [daemon, gateway, auth, safety]
dependencies: []
---

# Fix Daemon And Gateway Safety Regressions

## Problem Statement

Two operational safety regressions remain in infrastructure-facing paths. Mirror daemon PID handling can target an unrelated process after PID reuse, and the HTTP gateway can revoke the last active principal or serve inconsistent admin/health behavior.

## Findings

- Mirror daemon status/stop trust a stored numeric PID without validating process identity beyond the pidfile.
- Gateway deletion blocks removing the last active principal, but revocation does not.
- Gateway admin routes and docs are inconsistent around principal deletion, and `/health` uses unresolved readiness state.

## Proposed Solutions

### Option 1: Add identity-aware daemon process validation and align gateway invariants

**Approach:** Store extra daemon identity metadata, validate the running process before stop/status actions, prevent revoking the last active principal, and reconcile route behavior plus health readiness evaluation.

**Pros:**
- Preserves intended features
- Removes the live safety risks directly

**Cons:**
- Requires touching both daemon and gateway code/tests

**Effort:** 3-4 hours

**Risk:** Medium

---

### Option 2: Fail closed by disabling destructive daemon/gateway operations

**Approach:** Refuse stop/revoke actions unless stronger manual operator confirmation is present.

**Pros:**
- Lower implementation cost

**Cons:**
- Worse operator UX
- Leaves inconsistent API behavior in place

**Effort:** 1-2 hours

**Risk:** Medium

## Recommended Action

Implement Option 1. Make daemon stop/status process-aware instead of PID-only, make gateway revocation honor the same last-principal invariant as deletion, and align the advertised admin and health surfaces with the actual routed behavior.

## Technical Details

**Affected files:**
- `cli/lib/mirror_daemon_service.cjs`
- `cli/lib/mcp_http_gateway_service.cjs`
- related tests for daemon and gateway admin/health behavior

## Acceptance Criteria

- [x] Mirror daemon stop/status do not trust stale pidfiles after PID reuse
- [x] Gateway cannot revoke the last active principal
- [x] Advertised admin routes match the actual routed behavior
- [x] `/health` reports resolved readiness state, not a Promise-shaped value
- [x] Focused tests cover daemon identity checks and gateway revocation/health invariants

## Work Log

### 2026-03-17 - Initial Triage

**By:** Codex

**Actions:**
- Separated daemon/gateway operational safety bugs into one infrastructure fix track
- Captured the required invariants for process identity and principal safety

**Learnings:**
- These are independent of the sports/mirror execution changes and can be implemented in parallel

### 2026-03-17 - Implementation

**By:** Codex

**Actions:**
- Added PID ownership checks in `mirror_daemon_service` using process liveness plus command-line identity verification for daemon-generated pidfiles.
- Hardened daemon lifecycle behavior so stale pidfile mismatches are marked as `stale-pidfile` and never receive `SIGTERM`/`SIGKILL`.
- Added gateway invariant enforcement to block revoking the last active principal.
- Fixed HTTP route contract drift so `DELETE /auth/principals/{id}` is actually accepted by the gateway dispatcher.
- Fixed `/health` to await readiness and return resolved readiness fields (`ready`, `checks`, `warnings`).
- Added focused regression tests for daemon stale-pid behavior and gateway auth/health admin surfaces.

**Verification:**
- `node --check cli/lib/mirror_daemon_service.cjs`
- `node --check cli/lib/mcp_http_gateway_service.cjs`
- `node --test tests/unit/mirror_daemon_service.test.cjs`
- `node --test tests/cli/mcp.integration.test.cjs --test-name-pattern='mcp http health/capabilities endpoints enforce auth and report remote transport|mcp http auth admin surface supports DELETE /auth/principals/{id} with execute intent|mcp http auth revoke forbids revoking the last active principal|mcp http auth admin surface lists, rotates, and revokes principals in multi-principal mode'`

**Learnings:**
- Daemon PID reuse can be mitigated safely without changing CLI interfaces by treating identity mismatches as stale metadata instead of blindly signaling the PID.
- Gateway auth management needs uniform invariants across delete and revoke to avoid operator lockouts.
