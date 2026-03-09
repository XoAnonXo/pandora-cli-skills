---
status: ready
priority: p1
issue_id: "125"
tags: [wishlist, daemon, logs, health, panic, safety]
dependencies: []
---

# Wishlist batch 3: daemon observability and safety

## Problem Statement

Mirror automation still needs better observability and faster incident controls. Operators want structured logs, live log tailing, health checks, panic surfaces, and stricter capital guardrails.

## Findings

- daemon lifecycle and health metadata already exist in `mirror sync status` and `mirror status`.
- structured append-only audit/state exists, but daemon logs are not yet a first-class consumption surface.
- risk panic exists globally, but not as a mirror-focused operator command.
- watch exposes some alerting, but exposure/hedge-gap alert paths should map directly to operator questions.

## Recommended Action

Add `mirror logs`, `mirror health`, and `mirror panic` as canonical operator shells around current daemon/risk infrastructure, then wire stronger structured logging and exposure limits into sync/runtime flows.

## Acceptance Criteria

- [ ] daemon logs are structured JSON and readable through `mirror logs`
- [ ] `mirror health` returns machine-usable status for local and remote checks
- [ ] `mirror panic --market-address` and `--all` map to safe emergency flows
- [ ] exposure/trade limit guardrails exist and are overridable explicitly
- [ ] tests cover real incident/alert behavior rather than parser-only checks
