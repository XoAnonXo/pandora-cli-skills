---
status: complete
priority: p1
issue_id: "123"
tags: [wishlist, mirror, status, dashboard, intelligence]
dependencies: []
---

# Wishlist batch 1: unified state and trade intelligence

## Problem Statement

Operators originally needed bespoke scripts to answer the basic mirror questions: what is live, how far off the hedge is, how much size is needed to move the AMM, which markets are owned, and whether funds are sufficient.

## Findings

- The canonical read surfaces now exist in the shipped CLI and docs:
  - `dashboard` / `mirror dashboard`
  - `mirror status --with-live`
  - `mirror drift`
  - `mirror hedge-check`
  - `mirror calc`
  - `quote --target-pct`
  - `markets mine`
  - `fund-check`
- The corresponding command contracts are present in [`docs/skills/command-reference.md`](../docs/skills/command-reference.md), [`docs/skills/mirror-operations.md`](../docs/skills/mirror-operations.md), and the agent registry/help surface.
- Behavior coverage exists for the operator paths that previously required custom scripts, including dashboard, hedge-check, fund-check, markets-mine, and target-percentage quoting.
- The remaining wishlist deltas are no longer “missing commands”; they are UX refinements:
  - auto-refresh/operator cockpit behavior
  - full lifecycle automation after deploy
  - better top-level discoverability/help parity

## Recommended Action

Mark this batch complete. Track the remaining UX and orchestration gaps in dedicated follow-up todos instead of leaving this umbrella item open.

## Acceptance Criteria

- [x] `dashboard` shows active mirror markets with drift/actionability summaries
- [x] `mirror calc` answers target-percentage sizing
- [x] `mirror hedge-check` and `mirror drift` expose dedicated read surfaces
- [x] `quote --target-pct` computes required buy size to reach a target AMM price
- [x] `markets mine` lists wallet/signer-owned exposure
- [x] `fund-check` reports wallet shortfalls and next commands
- [x] Tests cover operator outcomes and machine-usable payloads

## Work Log

### 2026-03-09 - Initial wishlist decomposition

**By:** Codex

**Actions:**
- Created the original wishlist batch todo
- Identified the planned command surfaces needed for operator parity

**Learnings:**
- The wishlist was mostly about productizing existing primitives into canonical commands

### 2026-03-10 - Parity audit and closeout

**By:** Codex

**Actions:**
- Audited the wishlist against the current CLI, docs, and targeted tests
- Confirmed `dashboard`, `mirror calc`, `mirror hedge-check`, `quote --target-pct`, `markets mine`, and `fund-check` are present and documented
- Split the remaining non-command gaps into narrower follow-up todos for lifecycle automation, dashboard refresh, and help parity

**Learnings:**
- This batch is no longer blocked on missing command surfaces; the remaining work is workflow polish and orchestration
