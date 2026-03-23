---
status: in_progress
priority: p1
issue_id: "065"
tags: [phase2, signers, external-signer, auth]
dependencies: ["056", "058"]
owner: Hegel
---

# Objective
Implement a real `external-signer` backend with deterministic protocol, auth, and readiness semantics.

# Scope
- Define the external signer request/response contract.
- Add a runtime backend under `cli/lib/signers/`.
- Support health checks, account discovery, chain restrictions, and transaction signing.
- Normalize backend failures into Pandora service/profile errors.

# Required behaviors
- [ ] `profile get` for an external signer profile reports real runtime readiness based on connectivity and backend support.
- [ ] Unsupported chain or method is denied before signing.
- [ ] Unauthorized or unreachable signer returns structured remediation.
- [ ] Operation/audit metadata can identify `external-signer` usage.

# Write scope
- `cli/lib/signers/external_signer_backend.cjs`
- tests for protocol/auth/denial behavior
- minimal docs/comments needed for backend contract

# Out of scope
- Direct command parser rewiring
- Keystore backend

