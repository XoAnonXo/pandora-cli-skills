---
status: ready
priority: p1
issue_id: "059"
tags: [profiles, capabilities, docs, tests]
dependencies: ["056", "057", "058"]
---

# Problem Statement
Profile readiness can only become trustworthy if runtime checks, capabilities output, docs, and tests all agree.

# Recommended Action
Align readiness semantics, capabilities metadata, policy/profile docs, and profile test coverage around the implemented signer backends.

# Acceptance Criteria
- [ ] `profile get` and `profile validate` reflect actual backend readiness.
- [ ] Capabilities and docs use the same readiness vocabulary.
- [ ] Audit tests catch placeholder/ready mismatches.

# Work Log
### 2026-03-08 - Created profile readiness todo
**By:** Codex
