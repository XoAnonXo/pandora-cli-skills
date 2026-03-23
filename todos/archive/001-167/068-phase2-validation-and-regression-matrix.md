---
status: in_progress
priority: p1
issue_id: "068"
tags: [phase2, tests, regression, release]
dependencies: ["064", "065", "066", "067"]
owner: Wegener
---

# Objective
Add adversarial test coverage for signer backends and profile-based execution.

# Scope
- Unit tests for keystore and external signer behavior.
- CLI/integration tests for profile execution and readiness.
- Release-gate tests that ensure placeholder/ready mismatches cannot ship.

# Required behaviors
- [ ] Tests prove logical behavior, not just implementation details.
- [ ] Wrong-chain, wrong-method, locked-keystore, unsafe-permissions, missing-secret, and auth-denied cases are covered.
- [ ] At least one execute-capable integration path uses `profileId` successfully.
- [ ] Release checks fail on contract/doc/readiness drift.

