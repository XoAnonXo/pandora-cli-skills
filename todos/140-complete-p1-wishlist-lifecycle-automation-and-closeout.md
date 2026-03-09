---
status: complete
priority: p1
issue_id: "140"
tags: [wishlist, mirror, lifecycle, resolve, closeout]
dependencies: []
---

# Wishlist lifecycle automation and closeout

## Problem Statement

`mirror go` still does not deliver the full “deploy to cashout” flow from the wishlist. It can deploy and optionally start sync, but end-of-game monitoring, resolve timing, closeout, and Polymarket settlement remain separate operator steps. `mirror close` exists, but it explicitly stops short of the fully guided teardown described in the wishlist.

## Findings

- `mirror go` supports deploy plus optional auto-sync controls, but its public usage/help surface has no `--auto-resolve` or `--auto-close`.
- The docs explicitly describe `mirror go` and `mirror sync` as separate-leg execution flows rather than a complete lifecycle orchestrator.
- `resolve --watch` exists and already solves a key part of the desired operator flow by waiting until resolution becomes executable.
- `mirror close` exists, but the docs and help text state that it runs:
  - stop-daemons
  - withdraw-lp
  - claim-winnings
- The same docs also state that Polymarket hedge settlement remains manual in the current command version.
- The building blocks already exist:
  - sports schedule/scores
  - `resolve --watch`
  - `mirror close`
  - `claim --all`
  - `polymarket positions` / `polymarket balance`

## Proposed Solutions

### Option 1: Extend `mirror go` into an opt-in lifecycle orchestrator

**Approach:** Add explicit lifecycle flags such as `--auto-resolve` and `--auto-close`, and compose the existing sports/watch/resolve/closeout primitives behind one workflow.

**Pros:**
- Closest match to the original wishlist
- Reuses the existing `mirror go` front door
- Keeps the operator on one canonical command

**Cons:**
- Highest orchestration complexity
- Needs careful fail-closed behavior across long-running phases

**Effort:** 2-4 days

**Risk:** Medium

### Option 2: Add a separate lifecycle/closeout orchestrator

**Approach:** Keep `mirror go` focused on deploy/sync, and add a new command or recipe for post-game resolve/closeout automation.

**Pros:**
- Lower risk to the existing deploy path
- Easier to stage rollout by phase

**Cons:**
- Splits the lifecycle truth across commands
- Less faithful to the wishlist wording

**Effort:** 1-3 days

**Risk:** Medium

## Recommended Action

Use Option 1, but keep it opt-in and phase it carefully. Extend `mirror go` with lifecycle flags that orchestrate existing building blocks rather than inventing a new parallel surface.

## Acceptance Criteria

- [x] `mirror go` supports opt-in post-game automation such as `--auto-resolve` and `--auto-close`
- [x] The workflow can monitor sports resolution context or compose `resolve --watch` safely
- [x] The closeout path produces a deterministic final report covering Pandora and Polymarket legs
- [x] Failure states remain resumable and explicit; no hidden live mutation after partial failure
- [x] Tests cover the orchestration state machine and operator-visible outputs

## Work Log

### 2026-03-10 - Wishlist parity audit

**By:** Codex

**Actions:**
- Audited `mirror go`, `mirror close`, `resolve --watch`, and closeout docs against the original wishlist
- Confirmed lifecycle building blocks exist but are not yet composed into a single deploy-to-cashout flow
- Opened a focused P1 todo for the remaining orchestration gap

**Learnings:**
- This is the largest remaining functional gap relative to the wishlist

### 2026-03-10 - Lifecycle automation implemented

**By:** Codex

**Actions:**
- Extended `mirror go` with opt-in lifecycle flags for auto-resolve and auto-close
- Reused `resolve --watch` semantics inside `mirror go` with explicit answer/reason inputs and finite-run guardrails
- Added deterministic lifecycle status, final report, and resume commands to the `mirror go` payload
- Threaded profile-based signer selection through lifecycle closeout so close steps can run without raw private keys
- Updated CLI help plus agent contract metadata and regenerated SDK contract artifacts
- Added parser, integration, and orchestration tests covering success and timeout/resume flows

**Verification:**
- `node --test tests/unit/mirror_go_regressions.test.cjs tests/unit/new-features.test.cjs tests/unit/agent_contract_registry.test.cjs tests/cli/cli.integration.test.cjs`

**Learnings:**
- The safest shape is explicit and opt-in: lifecycle automation only runs in live mode, requires explicit resolve inputs, and only combines with auto-sync when the sync phase is bounded via `--sync-once`
- Polymarket settlement still needs to remain explicitly manual, but the final lifecycle report now makes that gap visible instead of implicit
