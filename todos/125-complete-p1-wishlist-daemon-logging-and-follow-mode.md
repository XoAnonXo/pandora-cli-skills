---
status: complete
priority: p1
issue_id: "125"
tags: [wishlist, daemon, logs, health, follow, observability]
dependencies: []
---

# Wishlist daemon logging and follow mode

## Problem Statement

Mirror runtime safety controls exist, but daemon observability still falls short of the wishlist. Operators can inspect daemon state and tail logs, yet the daemon log stream is still raw stdout/stderr text rather than structured JSON, and `mirror logs` does not support a follow mode for live incident response.

## Findings

- `mirror health` and `mirror panic` already exist and cover machine-usable status plus emergency stop/clear workflows.
- Runtime guardrails also already exist in live sync/go flows:
  - `--max-open-exposure-usdc`
  - `--max-trades-per-day`
  - cooldown and hedge/drift thresholds
- The daemon log file is created by [`cli/lib/mirror_daemon_service.cjs`](../cli/lib/mirror_daemon_service.cjs) as `~/.pandora/mirror/logs/<strategyHash>.log` and receives redirected stdout/stderr from the daemon child.
- The daemon child args are built in [`cli/pandora.cjs`](../cli/pandora.cjs) without forcing `--output json`, so the log file captures table-mode lines rather than a JSONL event stream.
- `mirror logs` in [`cli/lib/mirror_handlers/logs.cjs`](../cli/lib/mirror_handlers/logs.cjs) only supports `--lines <n>` and returns tailed text entries; there is no `--follow`.

## Proposed Solutions

### Option 1: Move daemon logging to structured JSONL and extend `mirror logs`

**Approach:** Make daemon runtime events emit JSONL records, keep raw-text fallback only for compatibility, and add `mirror logs --follow` for live tailing.

**Pros:**
- Matches the original wishlist intent
- Gives agents and operators parseable incident telemetry
- Makes `mirror logs` useful for both humans and automation

**Cons:**
- Requires touching daemon output, sync tick rendering, and log-reader compatibility

**Effort:** 6-10 hours

**Risk:** Medium

### Option 2: Add `--follow` but keep plain text logs

**Approach:** Keep the existing `.log` format and only improve log tail UX.

**Pros:**
- Smaller change set
- Helps operators immediately

**Cons:**
- Leaves the main wishlist gap unresolved
- Still awkward for agents and downstream tooling

**Effort:** 2-4 hours

**Risk:** Medium

## Recommended Action

Use Option 1. Treat structured JSONL logging as the canonical format, then make `mirror logs` capable of both snapshot tailing and follow-mode streaming.

## Acceptance Criteria

- [x] Mirror daemons emit structured JSONL log records for sync ticks, actions, warnings, and failures
- [x] `mirror logs` can parse and return structured entries while preserving raw-line fallback when needed
- [x] `mirror logs --follow` streams new entries for live incident/debug sessions
- [x] Help/docs clearly distinguish daemon logs from the append-only audit ledger
- [x] Tests cover JSONL emission, missing-file fallback, and follow-mode behavior

## Work Log

### 2026-03-09 - Initial wishlist decomposition

**By:** Codex

**Actions:**
- Captured the daemon observability wishlist as a batch todo

**Learnings:**
- The original scope mixed logging, health, panic, and runtime guardrails

### 2026-03-10 - Parity audit and narrowing

**By:** Codex

**Actions:**
- Confirmed `mirror health`, `mirror panic`, and runtime guardrails are already shipped
- Traced daemon logging to redirected stdout/stderr `.log` files
- Confirmed `mirror logs` is tail-only and does not support `--follow`
- Narrowed this todo to the remaining structured-logging and follow-mode gap

**Learnings:**
- The real remaining observability issue is log format and live tailing, not daemon health or panic control

### 2026-03-10 - Structured logging closeout

**By:** Codex

**Actions:**
- Fixed structured mirror log parsing so compact success envelopes inherit nested `data.generatedAt` timestamps via [`cli/lib/mirror_log_format.cjs`](../cli/lib/mirror_log_format.cjs)
- Updated mirror help/contract surfaces to advertise structured daemon JSONL, `--follow`, and the distinction between daemon logs vs the append-only audit/replay ledger in [`cli/lib/mirror_command_service.cjs`](../cli/lib/mirror_command_service.cjs) and [`cli/lib/agent_contract_registry.cjs`](../cli/lib/agent_contract_registry.cjs)
- Added focused regression coverage in [`tests/unit/mirror_log_format.test.cjs`](../tests/unit/mirror_log_format.test.cjs), [`tests/unit/cli_output_service.test.cjs`](../tests/unit/cli_output_service.test.cjs), and [`tests/unit/agent_contract_registry.test.cjs`](../tests/unit/agent_contract_registry.test.cjs)
- Regenerated SDK contract artifacts after the registry update via `npm run generate:sdk-contracts`
- Verified the logging slice with `node --test tests/cli/mirror_logs.integration.test.cjs tests/unit/mirror_log_format.test.cjs tests/unit/cli_output_service.test.cjs tests/unit/agent_contract_registry.test.cjs`

**Learnings:**
- The core JSONL/follow implementation was already largely present in the tree; the remaining gaps were a structured timestamp edge case plus stale discovery/help metadata
