---
status: complete
priority: p1
issue_id: "091"
tags: [a-plus, phase3, profiles, signer, readiness]
dependencies: ["090"]
---

# Problem Statement
Profile-backed execution exists, but too many built-in mutable profiles remain degraded. That blocks true A+ trust for external agents.

# Acceptance Criteria
- [ ] At least two mutable built-in profiles are genuinely runtime-ready.
- [ ] Profile readiness is backed by real signer backend behavior, not metadata alone.
- [ ] `profile explain` gives exact blockers and remediation for a target command/mode/context.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

### 2026-03-08 - Phase started
**By:** Codex

**Actions:**
- Phase 2 is closed; beginning the runtime-ready mutable profile pass with focus on local-env, local-keystore, external-signer, and `profile explain`.

### 2026-03-08 - Phase completed
**By:** Codex

**Actions:**
- Verified three built-in mutable profiles can become runtime-ready under valid runtime conditions:
  - `prod_trader_a`
  - `dev_keystore_operator`
  - `desk_signer_service`
- Confirmed readiness is backed by real signer/backend behavior rather than metadata-only flags.
- Confirmed `profile explain` evaluates exact command/mode/chain/category/policy context with actionable remediation.
