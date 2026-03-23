---
status: ready
priority: p1
issue_id: "057"
tags: [signers, keystore, security]
dependencies: ["056"]
---

# Problem Statement
Pandora lacks a real encrypted local keystore backend for named profiles.

# Recommended Action
Implement a secure local keystore backend with lock/unlock semantics, permission checks, and profile integration.

# Acceptance Criteria
- [ ] Encrypted keystore files are supported.
- [ ] Unsafe permissions are rejected.
- [ ] Locked keystores fail with structured remediation.
- [ ] Dry-run and live profile checks exercise the backend.

# Work Log
### 2026-03-08 - Created keystore backend todo
**By:** Codex
