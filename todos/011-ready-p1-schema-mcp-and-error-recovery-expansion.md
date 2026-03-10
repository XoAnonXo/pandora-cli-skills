---
status: ready
priority: p1
issue_id: "011"
tags: [schema, mcp, agent-native, error-recovery]
dependencies: ["002", "003", "004", "005", "006", "007", "008", "009", "010"]
---

# Expand Schema, MCP Tool Registry, and Recovery Mappings

Ensure all new quant/model/simulate capabilities are discoverable and safely consumable by agents.

## Problem Statement

New command surfaces are not agent-ready unless schema descriptors, MCP tools, and structured recovery hints are updated in lockstep.

## Findings

- Current architecture already centralizes schema and MCP, making this straightforward if done comprehensively.
- Long-running command guardrails are required in MCP mode.
- Existing recovery service needs new quant/model error mappings.

## Proposed Solutions

### Option 1: Single integration pass after command implementation (recommended)

**Approach:** Once feature commands are stable, update schema/MCP/recovery in one coordinated pass.

**Pros:**
- Consistent contracts
- Fewer partial integrations

**Cons:**
- Delayed agent availability until pass is complete

**Effort:** 6-8 hours

**Risk:** Medium

---

### Option 2: Incremental per-command integration

**Approach:** Update schema/MCP after each command lands.

**Pros:**
- Earlier partial availability

**Cons:**
- Higher risk of drift and missed mappings

**Effort:** 8-10 hours

**Risk:** Medium

## Recommended Action

Do coordinated integration once all core quant/model command payloads are finalized.

## Technical Details

**Affected files:**
- `cli/lib/schema_command_service.cjs`
- `cli/lib/mcp_tool_registry.cjs`
- `cli/lib/error_recovery_service.cjs`
- `tests/cli/mcp.integration.test.cjs`
- `tests/cli/cli.integration.test.cjs`

## Acceptance Criteria

- [ ] All new commands present in schema descriptors with dataSchema references
- [ ] MCP tools registered with correct long-running/mutating guardrails
- [ ] Recovery mappings cover new error namespaces
- [ ] MCP and schema integration tests pass

## Work Log

### 2026-03-02 - Todo Creation

**By:** Codex

**Actions:**
- Defined coordinated agent-surface integration scope
- Added dependencies on all quant/model feature tasks

**Learnings:**
- Agent-native quality depends more on contract consistency than model complexity
