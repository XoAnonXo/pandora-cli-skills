---
status: complete
priority: p1
issue_id: "096"
tags: [a-plus, phase4, policy, profile, recommend]
dependencies: ["095"]
---

# Problem Statement
Policy/profile explainability should not stop at yes/no. Agents need ranked, safe recommendations.

# Acceptance Criteria
- [x] `policy explain` and `profile explain` return exact denial causes.
- [x] Recommendation output prefers read-only, then dry-run, then execute.
- [x] Canonical tools are recommended over compatibility aliases.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

### 2026-03-08 - Phase completed
**By:** Codex

- Added machine-usable `requestedContext`, remediation, diagnostics, and recommendation ranking fields.
- Ensured recommendation payloads preserve older `recommended`/`candidates` or `profiles`/`decision` fields while adding exact-context agent guidance.
- Audited canonical-tool normalization for `trade.execute`-style requests and verified `quote` is recommended as the safe canonical preflight path.
