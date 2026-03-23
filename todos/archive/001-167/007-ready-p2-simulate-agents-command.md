---
status: ready
priority: p2
issue_id: "007"
tags: [simulate, agents, abm, microstructure]
dependencies: ["001"]
---

# Add simulate agents Command (ABM)

Create agent-based market simulation to model informed/noise/MM interactions and convergence behavior.

## Problem Statement

Closed-form SDE models miss microstructure and heterogeneous-agent effects that influence spread, price impact, and convergence speed.

## Findings

- Article ABM section maps directly to informed/noise/MM classes and Kyle-style impact intuition.
- Existing CLI has no market microstructure simulation command.
- ABM outputs are valuable for pre-deploy liquidity/risk tuning.

## Proposed Solutions

### Option 1: Simplified ABM first (recommended)

**Approach:** Implement a practical ABM with configurable population sizes and simple impact dynamics.

**Pros:**
- Fast, interpretable, testable
- Enough to support strategy decisions

**Cons:**
- Not full limit-order-book realism

**Effort:** 8-10 hours

**Risk:** Medium

---

### Option 2: Full LOB ABM from start

**Approach:** Implement full event-driven order book simulator.

**Pros:**
- Higher realism

**Cons:**
- Large complexity and runtime cost

**Effort:** 20+ hours

**Risk:** High

## Recommended Action

Ship simplified ABM in `simulate agents` with deterministic seeds and key metrics; defer full LOB realism.

## Technical Details

**Affected files:**
- `cli/lib/quant/abm_market.cjs`
- `cli/lib/simulate_command_service.cjs`
- `cli/lib/parsers/simulate_flags.cjs`
- `tests/unit/abm_market.test.cjs`

## Acceptance Criteria

- [ ] Supports configurable `n_informed`, `n_noise`, `n_mm`, `n_steps`, `seed`
- [ ] Output includes convergence error, spread trajectory, volume, PnL by agent type
- [ ] Deterministic runs with identical seed
- [ ] Runtime bounds documented and tested

## Work Log

### 2026-03-02 - Todo Creation

**By:** Codex

**Actions:**
- Selected simplified ABM as initial production path
- Defined measurable outputs for calibration and strategy use

**Learnings:**
- Model value is in comparative scenarios, not perfect microstructure realism
