---
status: complete
priority: p1
issue_id: "092"
tags: [a-plus, phase3, signer, local-env, keystore]
dependencies: ["091"]
---

# Problem Statement
`local-env` and `local-keystore` are the fastest path to making mutable built-in profiles genuinely ready, but they need stronger runtime health and UX.

# Acceptance Criteria
- [ ] Local env execution path is hardened and diagnosable.
- [ ] Local keystore unlock/readiness flow works reliably in live execution contexts.
- [ ] Profiles backed by these signers can report `ready` under valid runtime conditions.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

### 2026-03-08 - Work in progress
**By:** Codex

**Actions:**
- Carrying forward earlier signer fixes and starting a behavior-first audit of local-env and local-keystore readiness under real profile-backed execution paths.

### 2026-03-08 - Completed
**By:** Codex

**Actions:**
- Validated local-env readiness through runtime-local capabilities, profile list, profile get, and execution signer tests.
- Validated local-keystore readiness for the built-in `dev_keystore_operator` profile using a real encrypted keystore fixture, password, and active RPC chain probe.
- Confirmed keystore execution remains reliable when secret material is handed off after unlock and fails clearly when relocked or misconfigured.
