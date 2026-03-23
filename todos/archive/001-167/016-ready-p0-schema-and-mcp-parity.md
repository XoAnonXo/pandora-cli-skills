---
status: ready
priority: p0
issue_id: "016"
tags: [agent-platform, schema, mcp, parity, phase0]
dependencies: ["014", "015"]
---

# Phase 0 Schema and MCP Parity

Refactor schema and MCP surfaces so both are generated from the enriched contract registry and expose the same metadata.

## Problem Statement

Pandora must have one authoritative agent contract. Schema and MCP should not drift in fields, semantics, or discoverability.

## Technical Scope

**Primary files:**
- `cli/lib/schema_command_service.cjs`
- `cli/lib/mcp_tool_registry.cjs`

## Required Deliverables

- Generate schema descriptors from enriched command metadata
- Surface the same metadata in MCP `xPandora`
- Add capability-level metadata where appropriate
- Preserve runtime enforcement already implemented in MCP
- Ensure canonical/alias semantics stay explicit

## Acceptance Criteria

- [ ] Schema and MCP expose the same metadata set where applicable
- [ ] `descriptorScope` and command descriptor version remain explicit
- [ ] Compatibility aliases remain machine-readable
- [ ] New parity tests fail on future drift
