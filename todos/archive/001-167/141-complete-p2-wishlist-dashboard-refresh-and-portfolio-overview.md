---
status: complete
priority: p2
issue_id: "141"
tags: [wishlist, dashboard, portfolio, claimable, operator-ux]
dependencies: []
---

# Wishlist dashboard refresh and portfolio overview

## Problem Statement

The operator summary commands exist, but the UX is still behind the wishlist. `dashboard` is a one-shot snapshot rather than an htop-like refreshing cockpit, and the current surfaces do not yet present the full active-plus-claimable mirror overview in one place.

## Findings

- `dashboard` and `mirror dashboard` already summarize active mirrors and reuse live mirror payloads.
- The current dashboard usage does not expose `--refresh-ms`, `--watch`, or another built-in auto-refresh mode.
- `portfolio` exists, but it is wallet-centric rather than a mirror-operations overview spanning active mirrors, resolved-unclaimed claims, and liquid balances.
- `claim --all` and `markets mine` already exist, so a richer dashboard can likely compose existing services instead of inventing new low-level primitives.
- The wishlist’s “portfolio overview” should likely be implemented as an operator dashboard enhancement first, not a breaking redesign of the wallet `portfolio` command.

## Proposed Solutions

### Option 1: Extend `dashboard` with refresh/watch mode and richer sections

**Approach:** Add `--refresh-ms` or `--watch`, then extend the payload/table view with active, claimable, and liquid-capital sections derived from existing mirror/claim/balance services.

**Pros:**
- Preserves the current canonical operator surface
- Closest to the wishlist’s “htop for prediction markets” framing
- Avoids overloading `portfolio`

**Cons:**
- Needs careful table UX design and refresh behavior
- May require optional expensive live lookups

**Effort:** 1-2 days

**Risk:** Medium

### Option 2: Add a new mirror-specific portfolio surface

**Approach:** Introduce a dedicated portfolio command for mirror operations and keep `dashboard` static.

**Pros:**
- Narrower scope per command

**Cons:**
- Duplicates the role of `dashboard`
- Adds more surface area than the repo currently needs

**Effort:** 1-2 days

**Risk:** Medium

## Recommended Action

Use Option 1. Extend `dashboard` into the live operator cockpit and keep `portfolio` as the wallet-level analytics surface.

## Acceptance Criteria

- [x] `dashboard` supports built-in auto-refresh via `--refresh-ms` or equivalent watch mode
- [x] The dashboard can show active mirrors plus resolved/claimable summary and liquid capital rollups
- [x] Suggested next commands remain available for action-needed or unhealthy markets
- [x] JSON payloads stay machine-usable and stable in both one-shot and watch modes
- [x] Tests cover refresh-mode behavior and portfolio-summary composition

## Work Log

### 2026-03-10 - Wishlist parity audit

**By:** Codex

**Actions:**
- Audited `dashboard`, `portfolio`, `claim --all`, and `markets mine` against the wishlist’s operator cockpit goals
- Confirmed the current dashboard exists but is snapshot-only
- Opened a focused todo for refresh mode and richer mirror-overview composition

**Learnings:**
- The missing piece is operator UX composition, not missing underlying market/funding primitives

### 2026-03-10 - Dashboard watch mode and portfolio rollups implemented

**By:** Codex

**Actions:**
- Extended `dashboard` with `--watch`, `--refresh-ms`, and bounded JSON watch snapshots via `--iterations`
- Added a `portfolio` section that rolls up active mirrors, claimable exposure, and liquid capital in one payload
- Reused `discoverOwnedMarkets`, `runPolymarketBalance`, and on-chain venue balance reads instead of creating a parallel portfolio stack
- Updated CLI help, root usage text, and agent contract metadata for the new dashboard surface
- Added focused unit and CLI integration coverage for refresh behavior, JSON watch stability, and portfolio composition

**Verification:**
- `node --test tests/unit/dashboard_fund_service.test.cjs tests/cli/dashboard_fund.integration.test.cjs`
- `npm run generate:sdk-contracts && node --test tests/unit/agent_contract_registry.test.cjs tests/cli/cli.integration.test.cjs`

**Learnings:**
- A useful operator cockpit did not require a brand new portfolio command; the missing piece was composing ownership and funding primitives into the existing dashboard surface
- JSON watch mode is safest when bounded with explicit iterations, while table mode can stay open-ended for live operator use
