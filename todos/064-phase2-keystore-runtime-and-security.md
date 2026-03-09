---
status: in_progress
priority: p1
issue_id: "064"
tags: [phase2, signers, keystore, security]
dependencies: ["056", "057"]
owner: Curie
---

# Objective
Implement a real `local-keystore` signer backend that is safe enough to back a mutable built-in profile.

# Scope
- Add a keystore backend module under `cli/lib/signers/`.
- Support encrypted keystore file loading plus explicit unlock material.
- Reject unsafe file permissions and malformed keystore payloads.
- Expose backend health/readiness details through profile resolution.

# Required behaviors
- [ ] `profile get` for a `local-keystore` profile no longer reports `pending-integration` when a valid keystore is present and unlock material is provided.
- [ ] Missing passphrase or missing file returns structured `missing-secrets` / `missing-context` style remediation instead of generic failure.
- [ ] World-readable keystore files are rejected.
- [ ] Dry-run and execute paths can resolve a signer account from the keystore backend without raw `--private-key`.

# Write scope
- `cli/lib/signers/local_keystore_signer.cjs`
- `cli/lib/profile_resolver_service.cjs`
- unit tests for keystore backend behavior

# Out of scope
- External signer protocol
- Control-plane gateway changes

