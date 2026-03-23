---
status: complete
priority: p2
issue_id: "120"
tags: [mirror, status, pnl, audit, ops]
dependencies: []
---

# Add mirror status, PnL, and audit surfaces

## Problem Statement

Operators had to write bespoke scripts to understand cross-chain positions, hedge drift, deployed capital, and post-trade audit history. The CLI should provide this natively.

## Findings

- Postmortem calls out missing `mirror status`, `mirror pnl`, and `mirror audit` depth.
- Existing `mirror status --with-live` already exposes some live enrichment but not the full operator dashboard described.
- The CLI already has position, history, export, and polymarket primitives that can be combined into richer mirror-specific outputs.

## Recommended Action

Extend `mirror status` into the canonical cross-chain dashboard, then add explicit `mirror pnl` and `mirror audit` subcommands backed by the same normalized ledger/state services.

## Acceptance Criteria

- [x] `mirror status` shows Pandora + Polymarket positions, drift, and hedge analysis in one payload
- [x] `mirror pnl` calculates scenario P&L across both venues
- [x] `mirror audit` returns classified ledger history for the mirror pair
- [x] Tests prove outputs from market state and transaction inputs, not hardcoded display transforms

## Completed Work

- `mirror status`, `mirror pnl`, and `mirror audit` now support selector-first lookup in addition to persisted `--state-file` / `--strategy-hash` flows.
- `mirror audit` prefers append-only `stateFile.audit.jsonl` ledger entries and only falls back to reconstructing history from persisted runtime state when no audit log exists yet.
- Runtime daemon lookup now resolves from a strategy hash or live market selector, so operator payloads degrade gracefully without a persisted state file.
- Behavior-first CLI tests cover selector-first `mirror status` / `mirror pnl`, append-only audit-ledger preference, and live scenario surfaces.
