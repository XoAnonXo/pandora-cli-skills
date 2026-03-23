---
status: ready
priority: p1
issue_id: "056"
tags: [signers, profiles, security, execution]
dependencies: []
---

# Problem Statement
Pandora exposes named profiles and signer metadata, but several backends remain placeholders. That prevents A/A+ trust because agents still cannot rely on named signer profiles for real live execution.

# Findings
- Current profile surfaces expose runtime readiness separately from schema validity.
- Placeholder backends are visible, which is useful, but not enough for production-grade automation.
- The next trust milestone requires real mutable profiles backed by implemented signers.

# Recommended Action
Implement production-capable signer backends, bind them to real profiles, and upgrade profile readiness from descriptive metadata to tested runtime truth.

# Acceptance Criteria
- [ ] At least two mutable built-in profiles are runtime-ready and tested.
- [ ] `local-keystore` backend is implemented with safe file handling.
- [ ] `external-signer` backend is implemented with auth, chain/method restrictions, and health checks.
- [ ] Policy/profile docs and capabilities accurately distinguish ready vs placeholder backends.
- [ ] Live execution can use named profiles without raw `--private-key`.

# Work Log
### 2026-03-08 - Created signer backend index todo
**By:** Codex

**Actions:**
- Defined the Phase 2 objective around turning profile metadata into real execution capability.
