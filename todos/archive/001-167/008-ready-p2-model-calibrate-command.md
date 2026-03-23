---
status: ready
priority: p2
issue_id: "008"
tags: [model, calibration, jump-diffusion, parameters]
dependencies: ["001", "005"]
---

# Add model calibrate Command for Jump-Diffusion Parameters

Implement parameter calibration for probability-path dynamics to feed simulation and risk tooling.

## Problem Statement

Simulation quality depends on realistic process parameters. We currently lack a CLI mechanism to estimate and persist these from historical data.

## Findings

- Article production stack includes jump-diffusion simulation and model-driven probability engine.
- Existing history/indexer services can provide path data inputs.
- BYOM flows need a native model artifact format for reuse.

## Proposed Solutions

### Option 1: Practical calibration with robust diagnostics (recommended)

**Approach:** Calibrate tractable parameters (`sigma`, jump intensity/size moments) with reliability diagnostics and persisted model artifacts.

**Pros:**
- Strong utility with moderate complexity
- Directly feeds `simulate mc`

**Cons:**
- Approximate compared to full Bayesian posterior calibration

**Effort:** 8-12 hours

**Risk:** Medium

---

### Option 2: Full hierarchical Bayesian calibration first

**Approach:** Implement full probabilistic calibration stack immediately.

**Pros:**
- Highest statistical rigor

**Cons:**
- Large implementation and runtime overhead

**Effort:** 20+ hours

**Risk:** High

## Recommended Action

Ship practical calibration first with model artifact persistence (`--save-model`), then iterate toward richer Bayesian methods.

## Technical Details

**Affected files:**
- `cli/lib/model_command_service.cjs` (new)
- `cli/lib/quant/calibration.cjs` (new)
- `cli/lib/model_store.cjs`
- `cli/lib/parsers/model_flags.cjs`
- `tests/unit/model_calibrate.test.cjs`

## Acceptance Criteria

- [ ] `model calibrate` accepts history inputs and emits stable params
- [ ] Model artifacts saved/loaded with versioned schema
- [ ] Calibration diagnostics include fit quality and warnings
- [ ] Artifacts are consumable by `simulate mc --model-id`

## Work Log

### 2026-03-02 - Todo Creation

**By:** Codex

**Actions:**
- Defined calibration scope tied to simulation usability
- Linked dependencies to quant core and simulate namespace

**Learnings:**
- Model artifact schema is critical to prevent drift between commands
