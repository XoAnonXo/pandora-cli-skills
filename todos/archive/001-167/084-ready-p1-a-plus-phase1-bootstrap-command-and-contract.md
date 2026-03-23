---
status: complete
priority: p1
issue_id: "084"
tags: [a-plus, phase1, bootstrap, command, contract, schema]
dependencies: ["083"]
---

# Problem Statement
The CLI and contract registry need a canonical `bootstrap` command definition instead of only implicit bootstrap guidance scattered across docs and capabilities.

# Findings
- `agent_contract_registry.cjs` does not expose a concrete `bootstrap` command descriptor.
- `schema_command_service.cjs` and SDK generation depend on the registry, so bootstrap must be introduced there first.
- `capabilities` already has most of the summary data needed to back a bootstrap payload.

# Recommended Action
Add a concrete `bootstrap` descriptor and payload schema, then implement a `bootstrap_command_service` that composes existing capabilities/schema/profile/policy summaries without inventing a second truth source.

# Acceptance Criteria
- [x] `bootstrap` appears in the registry, schema, and generated SDK contracts.
- [x] Bootstrap has a stable payload schema with canonical-tool-only defaults.
- [x] Bootstrap exposes recommended next calls and compatibility guidance.
- [x] Unit tests verify schema/contract invariants and canonical alias suppression.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

**Actions:**
- Split bootstrap command/contract work away from gateway/docs work to allow parallel implementation.

### 2026-03-08 - Phase completed
**By:** Codex

**Actions:**
- Added a first-class `bootstrap` contract to the registry with canonical-tool semantics, MCP exposure, remote eligibility, and agent workflow metadata.
- Added `BootstrapPayload` schema definitions and ensured generated SDK contract artifacts refresh cleanly from the live registry.
- Verified contract invariants and canonical alias demotion in unit tests.
