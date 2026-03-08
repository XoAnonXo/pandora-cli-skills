---
status: ready
priority: p1
issue_id: "058"
tags: [signers, external-signer, http, security]
dependencies: ["056"]
---

# Problem Statement
Pandora does not yet support a real external signer service path for named profiles.

# Recommended Action
Implement an external signer backend with request auth, health checks, method restrictions, and deterministic error mapping.

# Acceptance Criteria
- [ ] External signer protocol is defined and implemented.
- [ ] Wrong-chain and unauthorized-method calls fail before signing.
- [ ] Profile readiness reflects live connectivity and backend support.
- [ ] Operation receipts include signer profile/backend context.

# Work Log
### 2026-03-08 - Created external signer backend todo
**By:** Codex
