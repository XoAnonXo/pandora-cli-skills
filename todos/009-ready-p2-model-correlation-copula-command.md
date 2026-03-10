---
status: ready
priority: p2
issue_id: "009"
tags: [model, correlation, copula, tail-risk]
dependencies: ["001", "004"]
---

# Add model correlation Command with Copula Tail Dependence

Implement dependency modeling across related contracts with t-copula default and comparative copula diagnostics.

## Problem Statement

Linear correlation is insufficient for portfolio tail risk. Current CLI has no dependency model exposing tail co-movement risk.

## Findings

- Article explicitly emphasizes Gaussian copula tail underestimation and t-copula improvements.
- Combinatorial arbitrage and stress testing both depend on robust dependency estimates.
- Existing arbitrage grouping gives candidate market sets for correlation analysis.

## Proposed Solutions

### Option 1: t-copula-first implementation with optional comparisons (recommended)

**Approach:** Fit and simulate with t-copula by default, optionally compare against Gaussian/Clayton/Gumbel.

**Pros:**
- Directly aligned with article recommendations
- Useful tail metrics with manageable complexity

**Cons:**
- Parameter fitting sensitivity on short histories

**Effort:** 10-14 hours

**Risk:** Medium

---

### Option 2: Generic pluggable copula engine from day one

**Approach:** Full framework with many families and selection engine.

**Pros:**
- Extensible

**Cons:**
- Larger complexity than immediate needs

**Effort:** 18+ hours

**Risk:** High

## Recommended Action

Implement `model correlation` with t-copula default, comparative mode optional, and explicit tail dependence outputs.

## Technical Details

**Affected files:**
- `cli/lib/model_command_service.cjs`
- `cli/lib/quant/copula.cjs`
- `cli/lib/parsers/model_flags.cjs`
- `tests/unit/model_correlation.test.cjs`

## Acceptance Criteria

- [ ] Returns tail dependence metrics and joint-extreme probabilities
- [ ] Defaults to t-copula and supports baseline comparison mode
- [ ] Handles small-sample warnings in diagnostics
- [ ] JSON contract includes stress scenario output fields

## Work Log

### 2026-03-02 - Todo Creation

**By:** Codex

**Actions:**
- Prioritized t-copula-first delivery strategy
- Aligned dependency with combinatorial arb to reuse grouping logic

**Learnings:**
- Tail dependence outputs should be first-class in risk workflows
