---
status: in_progress
priority: p1
issue_id: "067"
tags: [phase2, capabilities, docs, contracts]
dependencies: ["056", "059"]
owner: Kant
---

# Objective
Align capabilities, schema, docs, and skill guidance with actual backend readiness once the signer backends are real.

# Scope
- Update capabilities/profile payloads to distinguish implemented, ready, degraded, and placeholder states.
- Update agent-facing docs/skills/support matrix.
- Ensure schema definitions and MCP metadata stay accurate.

# Required behaviors
- [ ] `capabilities`, `profile list|get|validate`, and schema definitions use the same readiness vocabulary.
- [ ] Docs stop describing `local-keystore` / `external-signer` as placeholders once implemented.
- [ ] No published doc implies a ready backend that runtime still marks pending.

