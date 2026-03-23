---
status: complete
priority: p2
issue_id: "127"
tags: [wishlist, sports, history, replay, export]
dependencies: []
---

# Wishlist batch 5: sports-specific and historical analysis

## Problem Statement

The wishlist asked for direct sports read surfaces, replayable post-trade analysis, and richer export/audit semantics so operators would not need custom scripts for sports mirroring review.

## Findings

- `sports schedule` and `sports scores` are present as first-class command families.
- `mirror replay` now exists and is documented as the read-only modeled-vs-executed reconciliation surface.
- `mirror audit --reconciled` and `mirror pnl --reconciled` provide ledger-grade/export-ready accounting rows and classifications beyond the older approximate-only operator view.
- Historical reserve tracing and Polymarket inventory support were added in completed follow-up work, which closed the main data gaps behind replay/accounting.
- The remaining issues found in this audit are help/discoverability refinements, not missing sports or replay primitives.

## Recommended Action

Mark this batch complete. Keep any subcommand-help cleanup in a separate discoverability todo.

## Acceptance Criteria

- [x] `sports scores` and `sports schedule` answer the operator’s common questions directly
- [x] `mirror replay` compares modeled vs executed outcomes from persisted audit/runtime data
- [x] Export/audit surfaces classify mirror-specific legs for downstream analysis
- [x] Tests cover sports normalization and replay behavior

## Work Log

### 2026-03-09 - Initial wishlist decomposition

**By:** Codex

**Actions:**
- Created the sports/history wishlist batch

**Learnings:**
- The wishlist depended on both sports provider work and mirror ledger/replay work

### 2026-03-10 - Parity audit and closeout

**By:** Codex

**Actions:**
- Confirmed sports read surfaces, replay, and reconciled audit/PnL/export capabilities in the current codebase and docs
- Closed the broad sports/history batch and moved any residual UX cleanup to help-focused follow-up work

**Learnings:**
- The sports-analysis gap is materially closed; the remaining friction is mostly discoverability polish
