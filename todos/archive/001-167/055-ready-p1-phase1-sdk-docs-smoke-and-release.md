---
status: ready
priority: p1
issue_id: "055"
tags: [sdk, docs, smoke, release, ci]
dependencies: ["053", "054"]
---

# Problem Statement
Standalone SDKs are not enough without external install docs, release automation, and drift-proof smoke coverage.

# Findings
- The repo already has strong package smoke tests for the root CLI.
- SDK generation is release-gated, but standalone consumer paths are not yet the primary release concern.
- Trust/support docs need to move from “embedded alpha” to “published standalone alpha” once Phase 1 lands.

# Recommended Action
Add SDK-specific consumer smokes, release hooks, docs, and support-matrix updates so the SDKs are treated as first-class shipped artifacts.

# Acceptance Criteria
- [ ] Release docs explain how to install the standalone TS and Python SDKs.
- [ ] CI runs standalone SDK smoke tests from clean environments.
- [ ] `capabilities` / `schema` docs point to standalone SDK usage patterns.
- [ ] Release/trust docs describe versioning and alpha support policy accurately.
- [ ] Publish fails if standalone SDK smoke checks fail.

# Work Log
### 2026-03-08 - Created SDK docs/release todo
**By:** Codex

**Actions:**
- Scoped the packaging-support lane for docs, smoke, and release integration.
