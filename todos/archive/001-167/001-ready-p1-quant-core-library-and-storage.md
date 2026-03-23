---
status: ready
priority: p1
issue_id: "001"
tags: [quant, core, simulation, architecture]
dependencies: []
---

# Build Quant Core Library and Storage Foundations

Implement shared quant primitives and persistence so all upcoming simulation/model commands reuse one deterministic engine.

## Problem Statement

The CLI currently has no dedicated quant core modules for Monte Carlo, particle filtering, copula simulation, or variance reduction. If we implement each feature ad hoc inside command services, we will duplicate math logic and produce inconsistent outputs.

## Findings

- Article stack starts with Monte Carlo foundation and then layers importance sampling, particle filtering, copulas, and ABM.
- Current repo has strong command/service architecture but no `cli/lib/quant/` folder.
- Existing commands that need these primitives: `mirror simulate`, `watch`, `arbitrage`, `arb scan`, and planned `simulate`/`model` namespaces.
- Deterministic testability requires seeded RNG and stable JSON contracts.

## Proposed Solutions

### Option 1: Shared quant library (recommended)

**Approach:** Add reusable modules under `cli/lib/quant/` and two stores under `cli/lib/`.

**Pros:**
- Single source of truth for math
- Easier unit testing and benchmarking
- Reusable across current and future commands

**Cons:**
- Upfront design effort
- Requires broad test scaffolding

**Effort:** 8-12 hours

**Risk:** Medium

---

### Option 2: Inline math in each command

**Approach:** Implement only where needed in each command service.

**Pros:**
- Fast first delivery

**Cons:**
- High duplication and drift risk
- Harder to validate and maintain

**Effort:** 4-6 hours now, high long-term cost

**Risk:** High

## Recommended Action

Create the quant core first with deterministic APIs and storage contracts:
- `cli/lib/quant/rng.cjs`
- `cli/lib/quant/mc_stats.cjs`
- `cli/lib/quant/variance_reduction.cjs`
- `cli/lib/quant/importance_sampling.cjs`
- `cli/lib/quant/particle_filter.cjs`
- `cli/lib/quant/copula.cjs`
- `cli/lib/quant/abm_market.cjs`
- `cli/lib/forecast_store.cjs`
- `cli/lib/model_store.cjs`

## Technical Details

**Affected files:**
- New: `cli/lib/quant/*.cjs`
- New: `cli/lib/forecast_store.cjs`
- New: `cli/lib/model_store.cjs`
- New tests: `tests/unit/quant_*.test.cjs`

**Design rules:**
- Seeded RNG for deterministic tests
- Numeric guards and explicit error codes
- No external heavy deps unless strongly justified

## Acceptance Criteria

- [ ] `cli/lib/quant/` modules exist with documented exports
- [ ] RNG seed guarantees reproducible draws across runs
- [ ] Forecast/model stores write with hardened permissions (0o600)
- [ ] Core quant unit tests pass
- [ ] No command-level duplication of these primitives in new work

## Work Log

### 2026-03-02 - Todo Creation

**By:** Codex

**Actions:**
- Defined foundational quant module scope aligned to roadmap
- Set this task as dependency root for downstream todos

**Learnings:**
- Deterministic seeds + shared stats API is the key prerequisite for safe rollout
