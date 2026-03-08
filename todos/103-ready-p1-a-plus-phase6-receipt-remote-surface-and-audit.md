---
status: complete
priority: p1
issue_id: "103"
tags: [a-plus, phase6, receipts, remote, audit]
dependencies: ["101", "102"]
---

# Problem Statement
Receipts only become useful to external agents if they are queryable remotely and tested as part of operation/audit flows.

# Acceptance Criteria
- [ ] Remote control-plane endpoints expose receipt fetch and verification metadata.
- [ ] CLI/MCP/HTTP surfaces agree on receipt identifiers and envelope shape.
- [ ] Behavior-first tests prove receipts exist for all targeted mutable workflows.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

### 2026-03-08 - Phase completed
**By:** Codex
- Remote gateway now exposes receipt fetch and receipt verification over authenticated operations endpoints.
- CLI, MCP, HTTP, schema, docs, SDK artifacts, and release-trust checks were rerun and aligned.
