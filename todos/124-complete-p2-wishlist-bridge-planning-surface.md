---
status: complete
priority: p2
issue_id: "124"
tags: [wishlist, bridge, funding, treasury, cross-chain]
dependencies: []
---

# Wishlist bridge planning surface

## Problem Statement

The core funding workflows are now first-class inside the CLI, but cross-chain capital movement still is not. Operators can inspect balances, fund the Polymarket proxy, and diagnose shortfalls, yet there is still no safe planner for moving collateral between Ethereum and Polygon from inside Pandora.

## Findings

- `polymarket balance|deposit|withdraw` already exist and cover signer/proxy funding on Polygon.
- `fund-check` already diagnoses shortfalls and suggests immediate next commands such as `pandora polymarket deposit`.
- There is still no `pandora bridge` or equivalent planning surface in the CLI, docs, or agent contracts.
- The wishlist requirement is better framed as a planning problem first:
  - required source/destination chain and token
  - required balances and gas on both chains
  - supported bridge/provider assumptions
  - next command or manual handoff when bridging is needed
- An executable bridge surface would introduce provider lock-in, safety concerns, and extra signer/routing complexity before the planner contract is settled.

## Proposed Solutions

### Option 1: Add a read-only `bridge plan` surface first

**Approach:** Introduce a planner-only bridge command that computes how much must move, between which chains/tokens, which provider assumptions apply, and what the operator should do next.

**Pros:**
- Solves the main operator gap without taking custody or route-selection risk
- Fits the current “plan first, execute explicitly” CLI posture
- Can integrate cleanly with `fund-check` suggestions

**Cons:**
- Does not eliminate the need to execute the bridge elsewhere at first
- Needs explicit provider and token assumptions to avoid magical behavior

**Effort:** 4-6 hours

**Risk:** Medium

### Option 2: Add an executable `bridge` command immediately

**Approach:** Integrate a specific bridge provider and allow direct cross-chain execution from the CLI.

**Pros:**
- Maximum wishlist parity if it works well

**Cons:**
- Highest safety and support burden
- Requires route/provider semantics, fee handling, and more runtime secrets
- Harder to keep agent behavior predictable

**Effort:** 2-4 days

**Risk:** High

## Recommended Action

Use Option 1. Add a planner-only bridge surface first and wire `fund-check` to recommend it when cross-chain funding is the actual bottleneck.

## Acceptance Criteria

- [x] A read-only bridge planner exists for ETH <-> Polygon collateral movement
- [x] The planner returns explicit source/destination token and chain assumptions
- [x] The planner reports required balances, gas expectations, and shortfalls
- [x] `fund-check` can recommend the bridge planner when proxy funding alone is insufficient
- [x] Tests cover deterministic planning outputs and suggestion logic

## Work Log

### 2026-03-09 - Initial wishlist decomposition

**By:** Codex

**Actions:**
- Captured money-movement gaps as a wishlist batch

**Learnings:**
- The original batch bundled both routine proxy funding and broader cross-chain transport

### 2026-03-10 - Parity audit and narrowing

**By:** Codex

**Actions:**
- Re-audited the current CLI and confirmed `polymarket balance|deposit|withdraw` plus `fund-check` are already shipped
- Narrowed the remaining scope to cross-chain bridge planning only
- Re-prioritized the item from broad P1 funding work to a focused P2 planner gap

**Learnings:**
- The remaining problem is not “money movement” in general; it is safe cross-chain route planning

### 2026-03-10 - Bridge planner implemented

**By:** Codex

**Actions:**
- Added a read-only `bridge plan` command for Pandora/Polymarket funding routes between Ethereum and Polygon
- Kept the surface planner-only with explicit chain/token assumptions, balance reads, gas expectations, shortfalls, and manual next steps
- Added a top-level `bridge` command family to routing, CLI help, and agent contract metadata
- Wired `fund-check` to recommend `bridge plan` when the destination shortfall can plausibly be covered by source-side cross-chain liquidity
- Added focused unit and CLI integration tests for deterministic planner output and bridge-plan suggestions

**Verification:**
- `node --test tests/unit/bridge_command_service.test.cjs tests/cli/bridge.integration.test.cjs`
- `npm run generate:sdk-contracts && node --test tests/unit/agent_contract_registry.test.cjs tests/cli/cli.integration.test.cjs`

**Learnings:**
- The safe default is to keep bridging as an explicit manual handoff and let Pandora explain the route, not execute it
- `fund-check` already had enough funding context to recommend cross-chain planning once the planner command existed
