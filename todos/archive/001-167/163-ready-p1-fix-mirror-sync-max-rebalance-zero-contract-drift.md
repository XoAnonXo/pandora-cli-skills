---
status: ready
priority: p1
issue_id: "163"
tags: [mirror, mcp, schema, cli, contract]
dependencies: []
---

# Fix Mirror Sync Max Rebalance Zero Contract Drift

## Problem Statement

`mirror sync` advertises `--max-rebalance-usdc` as accepting `0` on agent/MCP surfaces, but the live CLI parser still rejects `0` as invalid. That creates a cross-surface contract drift where schema-driven callers can generate a value the runtime refuses, which is especially bad for MCP-first automation.

## Findings

- The published agent/MCP schema still declares `max-rebalance-usdc` with `minimum: 0` in `cli/lib/agent_contract_registry.cjs`.
- The CLI parser still routes `--max-rebalance-usdc` through `parsePositiveNumber` in `cli/lib/parsers/mirror_sync_flags.cjs`, which rejects `0`.
- Direct repro still fails:
  - `node cli/pandora.cjs --output json mirror sync run --market-address 0x0000000000000000000000000000000000000001 --polymarket-slug test-slug --paper --max-rebalance-usdc 0`
  - returns `INVALID_FLAG_VALUE` with `--max-rebalance-usdc must be a positive number. Received: "0"`
- The user workflow behind this is legitimate: `0` is the clean disable setting for rebalancing, and agents that trust the schema currently get a runtime failure instead.

## Proposed Solutions

### Option 1: Align the CLI parser to the published contract

**Approach:** Change `--max-rebalance-usdc` parsing to accept non-negative numbers, keep `0` as the disable value, and preserve existing positive-number behavior for all other cases.

**Pros:**
- Fixes the contract drift directly
- Preserves existing schema and agent behavior
- Minimal operator-facing change

**Cons:**
- Requires checking downstream logic for any hidden assumptions that rebalance caps are strictly positive

**Effort:** 30-90 minutes

**Risk:** Low

---

### Option 2: Tighten the schema instead of the parser

**Approach:** Change the agent/MCP schema minimum from `0` to `1` so the published contract matches the current CLI.

**Pros:**
- Small code change
- No runtime behavior change

**Cons:**
- Preserves the worse UX
- Breaks the intended disable semantics for agents and operators
- Conflicts with the documented desired workflow

**Effort:** 15-30 minutes

**Risk:** Medium

## Recommended Action

Implement Option 1. Treat `0` as the supported disable value on the CLI so the runtime matches the published agent/MCP contract, then add focused tests that cover both direct CLI parsing and surfaced contract parity.

## Technical Details

**Affected files:**
- `cli/lib/parsers/mirror_sync_flags.cjs`
- `cli/lib/agent_contract_registry.cjs`
- `tests/unit` coverage for mirror sync flags / registry / parser behavior
- optionally a focused CLI or MCP parity test if one already exists nearby

## Resources

- Review finding:
  - `/Users/mac/Desktop/pandora-mirror-daemon-postmortem.md:133`
- Relevant code:
  - `cli/lib/parsers/mirror_sync_flags.cjs:298`
  - `cli/lib/agent_contract_registry.cjs:3642`
- Repro command:
  - `node cli/pandora.cjs --output json mirror sync run --market-address 0x0000000000000000000000000000000000000001 --polymarket-slug test-slug --paper --max-rebalance-usdc 0`

## Acceptance Criteria

- [ ] `--max-rebalance-usdc 0` is accepted by the live CLI parser
- [ ] CLI behavior for positive `--max-rebalance-usdc` values is unchanged
- [ ] The published agent/MCP contract and the live CLI accept the same value range for `max-rebalance-usdc`
- [ ] Focused regression coverage proves `0` is accepted and surfaced consistently
- [ ] Any help text or docs that describe disable semantics remain accurate

## Work Log

### 2026-03-18 - Initial Triage

**By:** Codex

**Actions:**
- Re-reviewed the postmortem and upgraded the issue from minor UX to P1 contract drift
- Reconfirmed the mismatch between the schema minimum and the CLI parser behavior
- Re-ran the live CLI repro that still fails on `0`

**Learnings:**
- This is a clean contract-alignment bug, not a broad design question
- The MCP/agent schema is already the better contract here; the CLI should catch up to it
