---
status: complete
priority: p1
issue_id: "095"
tags: [a-plus, phase4, policy, explainability, guidance]
dependencies: ["094"]
---

# Problem Statement
Agents still infer too much policy and profile eligibility manually. This wastes tokens and increases unsafe plan variance.

# Acceptance Criteria
- [x] `policy explain` exists and returns deterministic blocker/remediation guidance.
- [x] `profile explain` and `policy explain` compose cleanly for real execution contexts.
- [x] Agents can ask what they can safely do next without custom prompting logic.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

### 2026-03-08 - Phase completed
**By:** Codex

- Implemented canonical-tool-first `policy explain`, `policy recommend`, and `profile recommend`.
- Verified focused Phase 4 CLI/MCP/contract suite at `55/55`.
- Reconciled recommendation outputs so legacy consumers keep working while agents get exact-context guidance.
