---
status: in_progress
priority: p1
issue_id: "169"
tags: [mirror, hedge, daemon, lifecycle, parser, tests]
dependencies: []
---

# Fix Mirror Hedge Daemon Lifecycle

## Problem Statement

The shipped `1.1.121` `mirror hedge` daemon surface is not production-safe. `mirror hedge start` launches a detached child that dies immediately because the generated child command includes `--strategy-hash`, but `mirror hedge run` does not parse that flag. Even after that crash is fixed, the runtime path is still single-pass and does not honor the daemon-shaped `--interval-ms` / `--iterations` interface as a real loop.

## Findings

- `buildMirrorHedgeDaemonCliArgs()` always injects `--strategy-hash` into the detached child invocation.
- `parseRunLikeFlags()` does not accept `--strategy-hash`, so the detached child exits with `UNKNOWN_FLAG` before it writes runtime state.
- `runMirrorHedge()` performs one execution pass and returns immediately. There is no hedge-specific loop, sleep, heartbeat, or iteration accounting in the shipped runtime.
- Existing tests cover child CLI-arg preservation and one-shot `runMirrorHedge()` behavior, but they do not assert that a started daemon remains alive, writes state, or advances across multiple ticks.
- Status/state surfaces lack explicit clean-exit metadata such as `stoppedReason`, `exitCode`, and `exitAt`, which makes post-mortem diagnosis harder.

## Recommended Action

Fix this in two stages inside the same change:

1. Make the detached child boot correctly by teaching `mirror hedge run` to accept `--strategy-hash`.
2. Convert `mirror hedge run/start` into a real long-running runtime that honors `intervalMs`, optional bounded `iterations`, and kill-switch semantics, then persist lifecycle state so `status` explains why a daemon stopped.

## Primary Files

- `cli/lib/parsers/mirror_hedge_flags.cjs`
- `cli/lib/mirror_hedge_service.cjs`
- `cli/lib/mirror_hedge_state_store.cjs`
- `cli/lib/mirror_hedge/status.cjs`
- `cli/lib/mirror_hedge_daemon_service.cjs`
- `cli/lib/mirror_handlers/hedge.cjs`
- `tests/unit/mirror_hedge_service.test.cjs`
- `tests/unit/mirror_hedge_flags.test.cjs`
- `tests/cli/cli.integration.test.cjs`

## Acceptance Criteria

- [ ] `mirror hedge run` accepts `--strategy-hash` and no longer exits with `UNKNOWN_FLAG` when launched by `start`
- [ ] `mirror hedge start` launches a detached child that remains alive across multiple intervals in paper mode
- [ ] `mirror hedge run` honors `intervalMs` and optional bounded `iterations`
- [ ] bounded runs report iteration counts and terminate cleanly after the requested number of ticks
- [ ] unbounded runs continue until operator stop / kill-switch / fatal error
- [ ] hedge runtime state includes explicit clean-exit metadata (`stoppedReason`, `exitCode`, `exitAt` or equivalent)
- [ ] `mirror hedge status` surfaces that stop reason cleanly in JSON and readable table mode
- [ ] tests cover parser acceptance, multi-tick daemon liveness, bounded iteration shutdown, and clean stop reporting

## Detailed Todo List

### Parser / Lifecycle Wiring
- [ ] Add `--strategy-hash` parsing to `mirror hedge run/start`
- [ ] Ensure strategy-hash and state-file selectors remain consistent between `start`, `run`, `status`, and `stop`
- [ ] Keep detached daemon CLI args/env propagation intact while fixing the unsupported-flag crash

### Runtime Loop
- [ ] Refactor `runMirrorHedge()` into a real looping runtime instead of a single-pass helper
- [ ] Add interval sleep between ticks
- [ ] Honor `--iterations` for bounded runs and default to unbounded when omitted
- [ ] Check the kill-switch file each cycle and stop cleanly when it is present
- [ ] Persist heartbeat fields such as last tick / last run / updated timestamps per cycle

### State / Status
- [ ] Extend hedge state with explicit stop metadata
- [ ] Record normal loop completion, operator stop, kill-switch stop, and fatal error exit reasons distinctly
- [ ] Show stop reason and exit timing in `mirror hedge status`

### Tests
- [ ] Add parser coverage for `--strategy-hash` on `mirror hedge run`
- [ ] Add a CLI integration test that proves `mirror hedge start` stays alive for more than one interval
- [ ] Add a bounded-iterations test that proves the daemon exits cleanly after N ticks
- [ ] Add assertions for state-file creation and stop metadata after normal completion

## Work Split

### Worker 1
- Parser/lifecycle wiring
- File ownership:
  - `cli/lib/parsers/mirror_hedge_flags.cjs`
  - `cli/lib/mirror_handlers/hedge.cjs`

### Worker 2
- Runtime loop + lifecycle state
- File ownership:
  - `cli/lib/mirror_hedge_service.cjs`
  - `cli/lib/mirror_hedge_state_store.cjs`
  - `cli/lib/mirror_hedge/status.cjs`

### Worker 3
- Tests and verification
- File ownership:
  - `tests/unit/mirror_hedge_service.test.cjs`
  - `tests/unit/mirror_hedge_flags.test.cjs`
  - `tests/cli/cli.integration.test.cjs`

## Work Log

### 2026-03-21 - Root Cause Triage

**By:** Codex

**Actions:**
- Reviewed the exact GitHub commit that shipped as `1.1.121`
- Reproduced `mirror hedge start` against a mocked Pandora/Polymarket pair
- Confirmed the detached child dies immediately with `Unknown flag for mirror hedge run: --strategy-hash`
- Confirmed the current `runMirrorHedge()` path is single-pass, not a recurring daemon loop

**Learnings:**
- The immediate production symptom is a parser mismatch in the detached child command
- The deeper product gap is that the hedge runtime still needs real daemon semantics after the parser crash is fixed
