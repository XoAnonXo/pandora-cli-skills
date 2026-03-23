---
status: ready
priority: p1
issue_id: "061"
tags: [gateway, auth, rate-limit, observability]
dependencies: ["060"]
---

# Problem Statement
The remote gateway works, but production-grade hardening needs stronger operational controls and clearer service boundaries.

# Recommended Action
Add auth lifecycle management, request idempotency, rate limits, structured audit logs, and deployment-focused runtime configuration.

# Acceptance Criteria
- [ ] Gateway auth supports rotation/revocation-friendly patterns.
- [ ] Request IDs and operation IDs are consistently surfaced.
- [ ] Rate limits and timeout budgets are explicit and tested.
- [ ] Operator-facing docs cover reverse proxy/TLS and deployment modes.

# Work Log
### 2026-03-08 - Created gateway hardening todo
**By:** Codex
