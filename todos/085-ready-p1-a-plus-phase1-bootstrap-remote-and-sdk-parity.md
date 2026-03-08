---
status: complete
priority: p1
issue_id: "085"
tags: [a-plus, phase1, bootstrap, remote, sdk, parity]
dependencies: ["083", "084"]
---

# Problem Statement
A bootstrap command that only exists locally is not enough. Remote HTTP and generated SDK artifacts must expose the same canonical bootstrap semantics.

# Findings
- `mcp_http_gateway_service.cjs` already exposes `/capabilities`, `/schema`, and `/tools`, so `/bootstrap` is a natural addition.
- Generated SDK artifacts already include contract and doc metadata, but not a dedicated bootstrap contract.
- Remote bootstrap must reflect principal/scopes and canonical tool visibility rules.

# Recommended Action
Add authenticated `/bootstrap` to the HTTP gateway and ensure generated SDK manifests/contracts surface bootstrap consistently.

# Acceptance Criteria
- [x] `GET /bootstrap` works with auth and respects scope/principal context.
- [x] Bootstrap parity tests cover CLI vs remote shape consistency.
- [x] SDK/generated artifacts include bootstrap schema/digest references.
- [x] Benchmark and smoke surfaces can consume bootstrap without extra special casing.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

**Actions:**
- Isolated remote/SDK bootstrap parity into its own workstream for parallel ownership.

### 2026-03-08 - Phase completed
**By:** Codex

**Actions:**
- Integrated bootstrap into the remote gateway and attached a preferred bootstrap summary to the authenticated HTTP bootstrap surface.
- Regenerated SDK artifacts so bootstrap is exported consistently across bundled contract consumers.
- Verified remote bootstrap auth, scope filtering, alias toggles, and local/remote contract parity.
