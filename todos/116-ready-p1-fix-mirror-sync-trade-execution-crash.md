---
status: complete
priority: p1
issue_id: "116"
tags: [mirror, sync, trading, crash]
dependencies: []
---

# Fix mirror sync trade execution crash

## Problem Statement

`mirror sync` and `mirror go --auto-sync` can reach a live rebalance path that crashes in the internal trade execution pipeline while manual `pandora trade --execute` still works. This forces operators into custom scripts and bypasses the guarded daemon flow.

## Findings

- Postmortem reports `executeTradeOnchain()` crashing with `Cannot read properties of undefined (reading 'toString')` in the daemon-only path.
- Relevant flow exists in `cli/lib/mirror_handlers/sync.cjs`, `cli/lib/mirror_handlers/go.cjs`, `cli/pandora.cjs`, and `cli/lib/trade_market_type_service.cjs`.
- `trade_market_type_service.cjs` assumes deadline-bearing fields are present when building AMM trade calls.
- Manual trade execution succeeds, so the sync/go rebalance caller is likely omitting or mis-shaping one or more execution inputs.

## Proposed Solutions

### Option 1: Normalize mirror rebalance options through the same validated trade payload builder used by `trade`

**Approach:** Route sync/go rebalance requests through a shared payload normalizer before calling `executeTradeOnchain`.

**Pros:**
- Highest parity with manual command behavior
- Reduces drift between daemon and user-invoked execution

**Cons:**
- Requires careful plumbing through existing mirror handlers

**Effort:** 3-5 hours

**Risk:** Medium

### Option 2: Patch only the missing mirror-specific fields

**Approach:** Fill in `deadlineSeconds`/related fields in the rebalance caller and leave the rest untouched.

**Pros:**
- Smaller change set

**Cons:**
- Likely preserves divergent execution code paths
- Easier to regress later

**Effort:** 1-2 hours

**Risk:** High

## Recommended Action

Use Option 1. Make mirror rebalance execution consume the same normalized execution contract as the standalone trade command, then add behavior-first tests proving daemon/go execution reaches the chain-call builder without undefined deadline data.

## Acceptance Criteria

- [x] `mirror sync --execute-live` no longer crashes on undefined deadline fields
- [x] `mirror go --auto-sync --execute-live` uses the same normalized execution shape as `trade --execute`
- [x] Focused unit/integration tests cover the broken path and prevent regression
- [x] Errors, if any, are surfaced as structured execution failures rather than runtime type errors

## Work Log

### 2026-03-09 - Todo creation

**By:** Codex

**Actions:**
- Converted Celtics postmortem crash into tracked P1 work item
- Mapped likely code path to mirror handlers and trade execution service

**Learnings:**
- This bug directly invalidates the guarded daemon path and is a root cause for the operator workaround

### 2026-03-09 - Batch 1 implemented and verified

**By:** Codex

**Actions:**
- normalized mirror rebalance execution through the same trade payload shape used by direct trade execution
- confirmed `mirror go --auto-sync` preserves live rebalance fields instead of dropping them at the daemon boundary
- added regression coverage for normalized live rebalance payloads

**Verification:**
- `node --test tests/unit/new-features.test.cjs tests/unit/agent_contract_registry.test.cjs tests/unit/mirror_go_regressions.test.cjs`
- `node --test tests/cli/cli.integration.test.cjs`

**Learnings:**
- the important fix was execution-shape parity, not a one-off null check
