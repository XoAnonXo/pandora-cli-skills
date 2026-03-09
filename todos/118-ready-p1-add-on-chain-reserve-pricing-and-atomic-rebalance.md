---
status: complete
priority: p1
issue_id: "118"
tags: [mirror, sync, amm, pricing, execution]
dependencies: ["116"]
---

# Add on-chain reserve pricing and atomic rebalance mode

## Problem Statement

`mirror sync` currently plans around drift using non-execution-grade pricing and incremental rebalance sizing. This leaves LPs exposed to arbitrage extraction and makes the daemon unsuitable for fast-moving sports markets.

## Findings

- Postmortem attributes the largest loss component to many small sync trades over minutes instead of one exact repricing trade.
- `cli/lib/mirror_sync/planning.cjs` currently sizes rebalances heuristically from pool/drift metrics rather than solving for a target AMM price from live reserves.
- `pandora quote` already has AMM reserve awareness in other paths; sync should consume on-chain reserves directly for execution decisions.
- Flashbots/private routing is desirable, but the minimal correctness win is single-trade exact sizing from live reserves.

## Proposed Solutions

### Option 1: Add exact on-chain reserve read + atomic sizing mode now

**Approach:** Read live reserves on-chain, compute the single-trade amount required to move the AMM toward the target price, and use that in `mirror sync once/run`.

**Pros:**
- Directly addresses the core execution flaw
- Reduces arb window even before private routing

**Cons:**
- Needs careful math and integration tests

**Effort:** 5-8 hours

**Risk:** Medium

### Option 2: Keep incremental mode and only improve reserve freshness

**Approach:** Read on-chain reserves but still rebalance in steps.

**Pros:**
- Smaller change set

**Cons:**
- Leaves the main economic flaw intact

**Effort:** 2-3 hours

**Risk:** High

## Recommended Action

Use Option 1. Implement an `atomic` rebalance mode with on-chain reserve pricing as the default for sync execution and keep incremental mode only as an explicit compatibility/debug path.

## Acceptance Criteria

- [x] Mirror sync can read live pool reserves directly for execution decisions
- [x] Planning computes a single-trade target rebalance amount from AMM reserves and target probability
- [x] `mirror sync once` supports atomic mode explicitly and uses it by default for execution
- [x] Compatibility mode for incremental sizing remains available only when explicitly requested
- [x] Behavior-first tests cover exact sizing and reserve-source precedence

## Work Log

### 2026-03-09 - Todo creation

**By:** Codex

**Actions:**
- Converted core loss mechanism into tracked P1 feature/fix work
- Linked dependency on trade-execution crash fix because atomic mode must execute through the daemon path

**Learnings:**
- Private routing can come after atomic sizing; correctness first is exact one-trade planning from live state

### 2026-03-09 - Batch 1 implemented and verified

**By:** Codex

**Actions:**
- made `atomic + on-chain` the default live sizing path
- added live reserve refresh and fail-closed behavior when Pandora reserve reads are unavailable
- added comma-delimited Pandora RPC fallback support for reserve reads
- surfaced reserve provenance and rebalance sizing metadata end to end

**Verification:**
- focused unit and CLI suite runs passed
- logic tests prove paper/live reserve precedence, atomic sizing defaults, and fail-closed reserve refresh behavior

**Learnings:**
- exact reserve provenance in payloads is necessary for agents to trust the execution path
