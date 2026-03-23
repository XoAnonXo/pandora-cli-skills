---
status: ready
priority: p2
issue_id: "010"
tags: [model, diagnostics, inverse-problem, market-quality]
dependencies: ["001", "008", "009"]
---

# Add model diagnose Command for Market Informativeness

Implement diagnostics to classify whether observed market behavior is informative or noise/manipulation dominated.

## Problem Statement

We currently cannot quantify market signal quality, making it hard to decide when model outputs should be trusted for execution.

## Findings

- Article references inverse-problem framing and production monitoring for model drift and calibration quality.
- Existing risk guard system can consume diagnostic flags once available.
- Model diagnose should feed actionable gating, not just descriptive analytics.

## Proposed Solutions

### Option 1: Practical diagnose score + classification (recommended)

**Approach:** Build a composite diagnostic score with interpretable components and strict thresholds.

**Pros:**
- Operationally usable in risk gates
- Fast to implement and test

**Cons:**
- Less theoretically complete than full Bayesian inverse diagnostics

**Effort:** 8-10 hours

**Risk:** Medium

---

### Option 2: Full Bayesian inverse diagnostics first

**Approach:** Deep posterior diagnostics from full probabilistic model.

**Pros:**
- Higher theoretical rigor

**Cons:**
- Heavy complexity and computation

**Effort:** 20+ hours

**Risk:** High

## Recommended Action

Ship practical `model diagnose` with classification buckets (`informative`, `weak-signal`, `noise-dominated`) and recommended actions.

## Technical Details

**Affected files:**
- `cli/lib/model_command_service.cjs`
- `cli/lib/quant/model_diagnostics.cjs` (new)
- `cli/lib/risk_guard_service.cjs` (integration hook)
- `tests/unit/model_diagnose.test.cjs`

## Acceptance Criteria

- [ ] Diagnose output includes score components and final class
- [ ] Includes explicit risk recommendations in payload
- [ ] Supports machine-readable flags for downstream automation
- [ ] Risk integration path documented and tested

## Work Log

### 2026-03-02 - Todo Creation

**By:** Codex

**Actions:**
- Scoped diagnosis as operational classification + gating signal
- Added dependencies on calibration and correlation outputs

**Learnings:**
- Actionability is more valuable than purely descriptive diagnostics
