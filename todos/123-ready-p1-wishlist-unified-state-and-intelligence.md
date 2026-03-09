---
status: ready
priority: p1
issue_id: "123"
tags: [wishlist, mirror, status, dashboard, intelligence]
dependencies: []
---

# Wishlist batch 1: unified state and trade intelligence

## Problem Statement

Operators still need multiple commands or custom scripts to answer the core questions: what is happening now, how much capital is deployed, what the hedge gap is, what trade moves the AMM to a target percentage, and which owned markets need attention.

## Findings

- `mirror status`, `mirror pnl`, and `mirror audit` already exist and expose a meaningful normalized state model.
- `mirror hedge-calc`, `mirror lp-explain`, `quote`, `portfolio`, `history`, and Polymarket funding commands provide enough underlying primitives to compose a better operator/intelligence surface.
- Missing canonical surfaces from the wishlist are:
  - `dashboard`
  - `mirror calc`
  - `mirror hedge-check`
  - `mirror drift`
  - `quote --target-pct`
  - `markets mine`
  - `fund-check`

## Recommended Action

Build selector-first operator/intelligence commands on top of the existing mirror surface/state services, keeping outputs canonical-tool-first and fully machine-readable in JSON.

## Acceptance Criteria

- [ ] `dashboard` shows all active mirror markets with drift, daemon, PnL, and alert summary
- [ ] `mirror calc` answers the exact capital and hedge needed to move to a target percentage
- [ ] `mirror hedge-check` and `mirror drift` expose dedicated read surfaces instead of forcing users to derive values from `mirror status`
- [ ] `quote --target-pct` computes the amount required to reach a target AMM price
- [ ] `markets mine` lists all markets with LP, token, or claimable exposure for the current signer/wallet
- [ ] `fund-check` reports wallet shortfalls and suggested follow-up actions
- [ ] tests assert operator outcomes and machine-usable payloads, not just helper internals
