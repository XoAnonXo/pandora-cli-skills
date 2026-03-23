---
status: ready
priority: p1
issue_id: "025"
tags: [agent-platform, phase1, closeout, resolve, claim]
dependencies: ["021", "022"]
---

# Migrate Resolve Claim And Closeout Flows

## Problem Statement

Resolve, claim, LP withdrawal, and closeout workflows are multi-step operational tasks that benefit from durable state and cancellation/closure semantics. Agents need these flows to be traceable and resumable.

## Findings

- `resolve`, `claim`, `lp remove --all-markets`, and closeout flows are operationally close to jobs already.
- Users repeatedly need a durable audit trail and resumability for market closeout.
- This work complements mirror/sports migration but can proceed in parallel once the operation core exists.

## Proposed Solutions

### Option 1: Keep closeout flows command-native

**Pros:** less migration work

**Cons:** inconsistent user experience vs mirror/sports operations

**Effort:** 1-2 days

**Risk:** Medium

---

### Option 2: Move closeout-family mutators onto the same operation protocol

**Pros:** consistent lifecycle, better auditability, easier remote orchestration

**Cons:** more routing and compatibility work

**Effort:** 2-3 days

**Risk:** Medium

## Recommended Action

Migrate resolve/claim/closeout flows after the operation core lands, keeping dry-run compatibility and explicit status/cancel/close semantics where appropriate.

## Technical Details

**Target commands/workflows:**
- `resolve`
- `claim`
- `lp remove --all-markets`
- `mirror close`
- any composite closeout path that orchestrates stop -> withdraw -> resolve -> claim

## Acceptance Criteria

- [ ] Resolve and claim can return operation ids
- [ ] Batch closeout flows persist progress/checkpoints
- [ ] Failure recovery is structured and resumable
- [ ] Existing validation/risk gates remain intact

## Work Log

### 2026-03-07 - Todo Created

**By:** Codex

**Actions:**
- Defined closeout-focused operation migration workstream

