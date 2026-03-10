---
status: ready
priority: p1
issue_id: "004"
tags: [arbitrage, combinatorial, optimization, risk]
dependencies: ["001"]
---

# Add Combinatorial Arbitrage Detection to arbitrage and arb scan

Extend pairwise spread detection with bundle/constraint-based opportunities across related markets.

## Problem Statement

Current arbitrage surfaces are mostly pairwise. They miss combinatorial mispricing opportunities across correlated or mutually exclusive outcome sets.

## Findings

- Article and referenced arb paper highlight combinatorial opportunities as materially larger than simple pairwise scans.
- Existing arbitrage code already groups related questions and can host bundle-level checks.
- `arb scan` already supports NDJSON streaming and bounded JSON mode for agents.

## Proposed Solutions

### Option 1: Add `--combinatorial` mode on existing commands (recommended)

**Approach:** Keep pairwise default, add bundle detection pipeline when flag enabled.

**Pros:**
- Backward compatible
- No new command family required
- Works with current monitoring workflows

**Cons:**
- Additional complexity in existing services

**Effort:** 8-12 hours

**Risk:** Medium

---

### Option 2: Separate command family (`arb combo`)

**Approach:** Isolate combinatorial logic in a separate subcommand.

**Pros:**
- Cleaner separation

**Cons:**
- More command surface, less discoverability

**Effort:** 8-10 hours

**Risk:** Medium

## Recommended Action

Implement `--combinatorial` for both `arbitrage` and `arb scan`.
Start with heuristic bundle checks plus optional bounded LP validation mode.

## Technical Details

**Affected files:**
- `cli/lib/arbitrage_service.cjs`
- `cli/lib/arb_command_service.cjs`
- `cli/lib/parsers/arb_flags.cjs` (new or folded into existing parser)
- `tests/unit/combinatorial_arb.test.cjs`
- `tests/cli/cli.integration.test.cjs`

## Acceptance Criteria

- [ ] `arbitrage --combinatorial` returns bundle opportunities
- [ ] `arb scan --combinatorial --output ndjson` streams bundle opportunities
- [ ] Net edge includes fee/slippage estimates
- [ ] Pairwise mode behavior remains unchanged by default

## Work Log

### 2026-03-02 - Todo Creation

**By:** Codex

**Actions:**
- Defined combinatorial extension path with BC default
- Scoped command-level and streaming-level integration

**Learnings:**
- Existing group-building logic gives a strong base for bundle constraints
