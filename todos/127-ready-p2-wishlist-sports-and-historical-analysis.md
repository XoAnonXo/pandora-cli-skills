---
status: ready
priority: p2
issue_id: "127"
tags: [wishlist, sports, history, replay, export]
dependencies: []
---

# Wishlist batch 5: sports-specific and historical analysis

## Problem Statement

Sports mirroring and post-trade review still require too much operator interpretation. The wishlist asks for real-time scores/schedule, auto-resolution context, replay, and richer export/audit semantics.

## Findings

- sports provider registry and timing services already exist.
- `mirror audit` now exists, but `mirror replay` and sports-focused score/schedule dashboards do not.
- export exists, but mirror-specific classifications can be improved.

## Recommended Action

Add sports read surfaces and historical replay/analysis on top of the current audit ledger and sports provider stack, then extend export classifications where the ledger already contains the data.

## Acceptance Criteria

- [ ] `sports scores` and `sports schedule` answer the operator’s frequent questions directly
- [ ] `mirror replay` compares actual vs modeled execution outcomes using persisted ledger/audit data
- [ ] export surfaces classify mirror-specific legs for downstream accounting
- [ ] tests cover real sports payload normalization and replay logic
