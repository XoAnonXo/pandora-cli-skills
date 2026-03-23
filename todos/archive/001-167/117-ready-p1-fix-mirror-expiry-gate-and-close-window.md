---
status: complete
priority: p1
issue_id: "117"
tags: [mirror, sync, gates, sports]
dependencies: []
---

# Fix mirror expiry gate and close-window logic

## Problem Statement

`mirror sync` startup can reject live sports markets because it treats Polymarket event expiry as authoritative even when the Pandora market remains tradable until its own cutoff. The current minimum close-window validation is also too strict for late-game operation.

## Findings

- Postmortem identifies `MIRROR_EXPIRY_TOO_CLOSE` as blocking daemon startup for an NBA market where Polymarket `endDate` was game start while Pandora `tradingCutoff` was later.
- `cli/lib/mirror_sync/gates.cjs` contains the gate, and `cli/lib/parsers/mirror_sync_flags.cjs` enforces `--min-time-to-close-sec >= 60`.
- For sports mirrors, Pandora close time must be the authoritative execution limit; Polymarket end timestamps are still useful as advisory signals.

## Proposed Solutions

### Option 1: Gate on Pandora cutoff, demote Polymarket expiry to warning/advisory

**Approach:** Use Pandora `tradingCutoff` for hard close checks; surface Polymarket expiry as warning unless an explicit strict mode is requested.

**Pros:**
- Matches actual tradability of the on-chain market
- Preserves useful diagnostics without blocking valid sync

**Cons:**
- Requires careful messaging so the discrepancy is visible

**Effort:** 2-4 hours

**Risk:** Low

### Option 2: Add a blanket bypass flag only

**Approach:** Keep broken default and require `--ignore-poly-expiry`.

**Pros:**
- Minimal code change

**Cons:**
- Unsafe default remains broken for agents and operators

**Effort:** 1 hour

**Risk:** High

## Recommended Action

Use Option 1 and keep an explicit override flag as an escape hatch. Also relax `--min-time-to-close-sec` so near-close operation can be requested intentionally.

## Acceptance Criteria

- [x] `MIRROR_EXPIRY_TOO_CLOSE` uses Pandora cutoff as the hard gate
- [x] Polymarket expiry mismatch is surfaced as warning/diagnostic, not false hard failure
- [ ] `--ignore-poly-expiry` exists as explicit override if needed
- [x] `--min-time-to-close-sec` accepts sub-60 values when intentionally requested
- [x] Tests cover sports market timing mismatch and late-game operation

## Work Log

### 2026-03-09 - Todo creation

**By:** Codex

**Actions:**
- Converted expiry/cutoff gate issue into tracked work item
- Identified gate/parser surfaces for remediation

**Learnings:**
- This is a default-policy bug, not just missing docs or operator tuning

### 2026-03-09 - Batch 1 implemented and verified

**By:** Codex

**Actions:**
- moved the hard close-window gate to Pandora trading time
- demoted Polymarket close mismatch to diagnostics unless `--strict-close-time-delta` is requested
- unified sports close-time inference through the shared mirror timing module and verify path

**Verification:**
- focused unit and CLI suite runs passed
- mirror sports timing tests cover suggested target time, close-window behavior, and strict/diagnostic close-delta behavior

**Learnings:**
- `--strict-close-time-delta` provided the needed escape hatch, so a separate `--ignore-poly-expiry` flag was not necessary in this batch
