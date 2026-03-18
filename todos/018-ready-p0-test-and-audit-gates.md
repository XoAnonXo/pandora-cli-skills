---
status: ready
priority: p0
issue_id: "018"
tags: [agent-platform, tests, audit, release-gate, phase0]
dependencies: ["014", "015", "016", "017"]
---

# Phase 0 Test and Audit Gates

Add release-grade validation for the new agent-contract foundation so future changes cannot drift silently.

## Problem Statement

Phase 0 only matters if the repo starts failing fast on contract drift, missing metadata, or docs/schema/MCP mismatches.

## Technical Scope

**Primary files:**
- `tests/unit/agent_contract_registry.test.cjs`
- `tests/cli/mcp.integration.test.cjs`
- `tests/cli/cli.integration.test.cjs`
- `tests/cli/agent_workflow.integration.test.cjs`

## Required Deliverables

- Add tests for metadata presence/defaults
- Add tests for `capabilities` payload shape
- Add tests for schema/MCP metadata parity
- Add tests for docs/help references where practical
- Add an audit-style regression checklist in test comments or fixtures

## Acceptance Criteria

- [ ] New metadata fields are covered by tests
- [ ] `capabilities` command has unit/CLI coverage
- [ ] Schema/MCP parity assertions exist
- [ ] Agent workflow tests include capability discovery expectations
