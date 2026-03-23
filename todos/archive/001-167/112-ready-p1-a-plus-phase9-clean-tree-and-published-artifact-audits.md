---
status: ready
priority: p1
issue_id: "112"
tags: [a-plus, phase9, release, git, npm]
dependencies: ["110", "111"]
---

# Problem Statement
An A+ release cannot rely on manual reconciliation between git, npm, PyPI, benchmark assets, and clean-install reality.

# Acceptance Criteria
- [ ] Publish requires a clean tracked worktree.
- [ ] Postpublish verification checks git tag/version parity and published artifact behavior.
- [ ] External clean-install audits are release-blocking for core surfaces.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

