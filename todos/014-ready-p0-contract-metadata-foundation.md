---
status: ready
priority: p0
issue_id: "014"
tags: [agent-platform, contracts, metadata, phase0]
dependencies: []
---

# Phase 0 Contract Metadata Foundation

Enrich the command contract registry so every command/tool carries planning-grade metadata beyond JSON Schema.

## Problem Statement

Pandora's command registry is typed, but it does not yet expose enough machine-readable metadata for remote agents, SDKs, recipes, and policy packs.

## Technical Scope

**Primary files:**
- `cli/lib/agent_contract_registry.cjs`
- `cli/lib/shared/poll_categories.cjs` (reference only if needed)

## Required Deliverables

- Add contract metadata fields with sensible defaults:
  - `riskLevel`
  - `idempotency`
  - `expectedLatencyMs`
  - `requiresSecrets`
  - `recommendedPreflightTool`
  - `safeEquivalent`
  - `externalDependencies`
  - `canRunConcurrent`
  - `returnsOperationId`
  - `jobCapable`
  - `supportsRemote`
  - `supportsWebhook`
  - `policyScopes`
- Centralize metadata defaults/helpers instead of hand-duplicating per command.
- Ensure mutating/sensitive flows override defaults explicitly.

## Acceptance Criteria

- [ ] Every command descriptor includes normalized metadata
- [ ] Metadata defaults are generated centrally
- [ ] Mutating commands explicitly expose non-default risk/execution metadata
- [ ] Registry remains backward-compatible for existing schema/MCP consumers
