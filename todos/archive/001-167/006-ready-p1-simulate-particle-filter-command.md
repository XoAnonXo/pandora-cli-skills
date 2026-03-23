---
status: ready
priority: p1
issue_id: "006"
tags: [simulate, particle-filter, realtime, filtering]
dependencies: ["001"]
---

# Add simulate particle-filter Command

Implement sequential Monte Carlo filtering for real-time probability smoothing and uncertainty propagation.

## Problem Statement

Live observed prices are noisy. We need a filter that updates latent probability estimates robustly rather than reacting directly to each tick.

## Findings

- Article provides a clear logit random-walk + noisy observation PF framing.
- Existing `stream` and `watch` outputs can act as observation sources.
- Current CLI lacks any sequential filtering command.

## Proposed Solutions

### Option 1: Batch + stream-friendly PF command (recommended)

**Approach:** Build `simulate particle-filter` consuming JSONL/NDJSON observations and returning filtered trajectory.

**Pros:**
- Reusable for offline and online workflows
- Cleanly testable with fixtures

**Cons:**
- Needs careful numeric stability handling

**Effort:** 6-9 hours

**Risk:** Medium

---

### Option 2: PF embedded only in watch/stream

**Approach:** Add hidden filtering logic in existing watchers.

**Pros:**
- Less command surface

**Cons:**
- Harder to benchmark/validate independently

**Effort:** 4-6 hours

**Risk:** Medium

## Recommended Action

Implement standalone `simulate particle-filter` first, then wire optional integration hooks into watch/stream in follow-up.

## Technical Details

**Affected files:**
- `cli/lib/simulate_command_service.cjs`
- `cli/lib/quant/particle_filter.cjs`
- `cli/lib/parsers/simulate_flags.cjs`
- `tests/unit/particle_filter.test.cjs`
- `tests/cli/cli.integration.test.cjs`

## Acceptance Criteria

- [ ] PF command accepts observation sequence input and validates schema
- [ ] Output includes filtered estimate, credible interval, ESS diagnostics
- [ ] Resampling strategy is deterministic with seed
- [ ] Handles sparse/noisy inputs with structured diagnostics

## Work Log

### 2026-03-02 - Todo Creation

**By:** Codex

**Actions:**
- Scoped PF command and integration boundary
- Added deterministic and stability requirements

**Learnings:**
- ESS + systematic resampling should be surfaced in diagnostics for trust
