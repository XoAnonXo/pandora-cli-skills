---
status: complete
priority: p2
issue_id: "121"
tags: [polymarket, funding, lp, ops]
dependencies: []
---

# Add Polymarket funding commands and LP removal preview

## Problem Statement

Operators needed custom scripts to fund the Polymarket proxy and to preview LP removal outcomes. These are routine operational workflows and should be first-class commands.

## Findings

- Missing `polymarket deposit`, `withdraw`, `balance`
- Missing `lp simulate-remove`
- Existing Polymarket and LP codepaths already contain enough primitives to expose both safely

## Recommended Action

Add proxy funding commands under `polymarket` and add `lp simulate-remove` as a non-mutating preview surface for LP unwind decisions.

## Acceptance Criteria

- [x] `polymarket deposit`, `withdraw`, and `balance` exist with dry-run/execute discipline
- [x] `lp simulate-remove` previews token/USDC outputs and scenario values
- [x] Tests cover both commands with behavior-first payload assertions

## Work Log

### 2026-03-09 - Batch 2 completed

**By:** Codex

**Actions:**
- added first-class `polymarket balance|deposit|withdraw` contracts and help surfaces
- tightened `polymarket withdraw` docs/help so execute mode is only advertised as signer-controlled
- exposed `lp simulate-remove` through CLI help, schema, MCP/SDK registry, and agent docs
- corrected `lp simulate-remove` preview payload to report the exact LP amount used for `--all` previews instead of the sentinel string `"all"`

**Verification:**
- focused unit and CLI integration suites passed
- docs and generated SDK contract artifacts regenerated and checked

**Learnings:**
- routine operational surfaces must be formal command contracts, not hidden behind bespoke scripts or generic family help
