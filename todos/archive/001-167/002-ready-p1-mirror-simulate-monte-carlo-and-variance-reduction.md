---
status: ready
priority: p1
issue_id: "002"
tags: [mirror, simulate, monte-carlo, risk]
dependencies: ["001"]
---

# Upgrade mirror simulate with Monte Carlo and Variance Reduction

Extend `mirror simulate` from linear scenario math to full pathwise Monte Carlo with variance reduction and tail-risk outputs.

## Problem Statement

`mirror simulate` currently provides deterministic scenario outputs but does not produce probabilistic distributions, confidence intervals, or tail metrics needed for desk-grade risk decisions.

## Findings

- Article emphasizes Monte Carlo as the base layer and production variance reduction as table stakes.
- Article explicitly recommends antithetic, control variate, stratification, and importance sampling stacking.
- Existing `mirror_econ_service.cjs` already has clean output structure that can be extended without breaking contracts.

## Proposed Solutions

### Option 1: Extend existing mirror simulate with `--engine` switch (recommended)

**Approach:** Keep current linear mode as default and add `mc` mode with new flags/output blocks.

**Pros:**
- Backward compatible
- Incremental migration path
- Reuses current command surface

**Cons:**
- Larger service complexity if not modularized

**Effort:** 8-10 hours

**Risk:** Medium

---

### Option 2: New mirror subcommand (`mirror simulate-mc`)

**Approach:** Separate command to isolate complexity.

**Pros:**
- Cleaner separation

**Cons:**
- Duplicated user workflows
- Extra discoverability burden

**Effort:** 7-9 hours

**Risk:** Medium

## Recommended Action

Implement `--engine linear|mc` in existing `mirror simulate`.
Add flags: `--paths`, `--steps`, `--seed`, `--importance-sampling`, `--antithetic`, `--control-variate`, `--stratified`.
Return `mc.summary`, `mc.distribution`, `mc.tailRisk`, and diagnostics while preserving current fields.

## Technical Details

**Affected files:**
- `cli/lib/mirror_econ_service.cjs`
- `cli/lib/parsers/mirror_remaining_flags.cjs`
- `cli/lib/mirror_handlers/simulate.cjs`
- `tests/unit/mirror_simulate_mc.test.cjs`
- `tests/cli/cli.integration.test.cjs`

## Acceptance Criteria

- [ ] `mirror simulate --engine mc` returns stable JSON envelope
- [ ] MC output includes VaR95/99 and ES95/99
- [ ] Variance reduction flags are parsed and validated
- [ ] Linear mode output remains unchanged
- [ ] Unit + CLI integration tests pass

## Work Log

### 2026-03-02 - Todo Creation

**By:** Codex

**Actions:**
- Scoped MC extension to existing command for BC safety
- Added explicit dependency on quant core task

**Learnings:**
- Keeping linear mode default avoids breaking agents that parse current payloads
