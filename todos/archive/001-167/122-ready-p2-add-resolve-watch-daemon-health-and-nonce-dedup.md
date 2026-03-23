---
status: complete
priority: p2
issue_id: "122"
tags: [resolve, daemon, nonce, ops]
dependencies: []
---

# Add resolve watch, daemon health, and nonce deduplication

## Problem Statement

Post-resolution and daemon operations still require too much manual debugging. Operators need guided resolve timing, daemon health visibility, and protection against duplicate/zombie transactions.

## Findings

- Postmortem highlights missing `resolve --watch`
- Daemon health had to be debugged via SSH/log spelunking
- A rogue $1,000 trade implies missing nonce/pending-TX protection in automated execution

## Recommended Action

Add a watchable resolve workflow, expose daemon health/state/trade telemetry directly, and track pending mutable daemon transactions by nonce so duplicate/orphaned trades fail closed.

## Acceptance Criteria

- [x] `resolve` can explain remaining epochs and optionally watch until executable
- [x] mirror daemon status exposes health, last trade, error counts, and next action
- [x] automated execution tracks pending transactions by nonce and avoids duplicate sends
- [x] Tests cover the nonce-dedup and health payload behavior

## Completed Work

- `resolve --watch` is live for dry-run and execute flows and reports remaining epochs until executable.
- Mirror runtime health and daemon metadata are surfaced through `mirror status` / `mirror sync status`, including blocked/manual-review next actions.
- Live mirror execution now captures actual chain transaction nonces from on-chain trade execution, persists them into pending-action locks, and appends them into the audit ledger for reconciliation.
- Behavior-first tests cover unreadable pending locks, nonce-bearing reconciliation payloads, runtime daemon health, and resolve watch behavior.
