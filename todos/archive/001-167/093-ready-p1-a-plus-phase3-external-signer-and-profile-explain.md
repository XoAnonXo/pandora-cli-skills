---
status: complete
priority: p1
issue_id: "093"
tags: [a-plus, phase3, signer, external-signer, profile-explain]
dependencies: ["091"]
---

# Problem Statement
External signer support and profile explainability are required to make profile-based execution trustworthy for serious agent operators.

# Acceptance Criteria
- [ ] External signer account selection and health behavior are explicit and safe.
- [ ] `profile explain` can evaluate exact command/mode/chain/category/policy contexts.
- [ ] Denied or degraded states return actionable remediation.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

### 2026-03-08 - Work in progress
**By:** Codex

**Actions:**
- Starting the external-signer safety pass and the `profile explain` usability audit for exact command/mode/chain/category/policy contexts.

### 2026-03-08 - Completed
**By:** Codex

**Actions:**
- Validated safe external-signer readiness for the built-in `desk_signer_service` profile using active health and account checks.
- Confirmed unauthorized and ambiguous-account cases fail closed with structured remediation.
- Confirmed `profile explain` works for exact execution contexts over both CLI and MCP surfaces.
