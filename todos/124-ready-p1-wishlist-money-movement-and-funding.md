---
status: ready
priority: p1
issue_id: "124"
tags: [wishlist, funding, bridge, polymarket, treasury]
dependencies: []
---

# Wishlist batch 2: money movement and funding

## Problem Statement

Agents and operators need first-class funding workflows across signer, proxy, and chain boundaries. Deposit/withdraw/balance exists for Polymarket, but fund sufficiency and bridging are still not first-class.

## Findings

- `polymarket balance|deposit|withdraw` already exist.
- There is no dedicated `fund-check` command and no first-class `bridge` surface.
- The most urgent operator need is not generic bridging UX but actionable wallet shortfall diagnosis.

## Recommended Action

Ship `fund-check` first using current wallet/profile/risk primitives, then add a bridge planning surface only if it can be implemented safely with explicit transport/venue assumptions.

## Acceptance Criteria

- [ ] `fund-check` reports balances, thresholds, shortfalls, and exact next commands
- [ ] balance checks cover ETH/Polygon collateral and gas reserves relevant to mirror workflows
- [ ] if `bridge` is introduced, it is explicit, non-magical, and safe by construction
- [ ] tests cover real shortfall scenarios and recommendation logic
