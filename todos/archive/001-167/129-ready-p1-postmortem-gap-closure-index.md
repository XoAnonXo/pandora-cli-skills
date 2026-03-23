---
status: ready
priority: p1
issue_id: "129"
tags: [mirror, polymarket, tracing, pnl, flashbots, postmortem]
dependencies: ["118", "120", "121", "127"]
---

# Postmortem gap closure index

## Problem Statement

The CLI now covers live reserve-aware mirror sync, operator dashboards, and Polymarket funding, but users still need bespoke scripts for four postmortem-critical workflows:

1. historical reserve tracing from raw on-chain state
2. Polymarket YES/NO position inventory outside funding balances
3. ledger-grade cross-venue PnL and LP impermanent-loss attribution
4. private routing for the Ethereum rebalance leg

Without these surfaces, the product still falls short of the operator workflow we used manually during the Pandora/Polymarket investigation.

## Findings

- Historical reserve refresh exists only for latest-state reads in [`cli/lib/mirror_sync/reserve_source.cjs`](../cli/lib/mirror_sync/reserve_source.cjs); there is no block-parameterized reserve tracing surface.
- `polymarket balance` is intentionally funding-oriented and only returns USDC.e snapshots from [`cli/lib/polymarket_ops_service.cjs`](../cli/lib/polymarket_ops_service.cjs).
- `mirror pnl` exists, but the docs explicitly frame it as operator estimates rather than realized accounting in [`docs/skills/mirror-operations.md`](../docs/skills/mirror-operations.md).
- `mirror replay` replays persisted execution history, not historical chain state, from [`cli/lib/mirror_replay_service.cjs`](../cli/lib/mirror_replay_service.cjs).
- `mirror sync` still executes separate Pandora and Polymarket legs, and there is no Flashbots/private relay route in the runtime today.

## Recommended Action

Execute the missing work in this order:

1. Issue `130`: add archive-aware historical reserve tracing
2. Issue `131`: add Polymarket CTF inventory surfaces
3. Issue `132`: build a normalized cross-venue accounting ledger on top of traced reserves and position data

Run issue `133` after the atomic-sizing baseline from issue `118` and in parallel with the accounting track when capacity allows. It hardens execution, but it does not unblock the missing tracing or ledger work.

This keeps correctness and observability ahead of execution optimization, while still preserving a clear route to private order flow.

## Acceptance Criteria

- [ ] The four missing workflows are decomposed into standalone todos with clear ownership and dependencies.
- [ ] Sequencing makes the accounting work depend on the tracing and position primitives it actually needs.
- [ ] Flashbots work is explicitly scoped as Ethereum-leg private routing, not false cross-chain atomicity.
- [ ] Final user-facing docs can state which postmortem workflows are now native and which remain manual.

## Work Log

### 2026-03-09 - Research triage and decomposition

**By:** Codex

**Actions:**
- Reviewed current CLI/docs coverage for mirror sync, Polymarket funding, replay, and PnL surfaces
- Compared the repo surface with the four missing workflows called out by operators
- Split the gap into tracing, inventory, accounting, and private-routing tracks

**Learnings:**
- The repo already solved part of the original complaint: `mirror pnl` exists, but it is still approximate and not a full audit ledger
- Historical reserve reads and CTF inventory are the two foundational missing primitives
