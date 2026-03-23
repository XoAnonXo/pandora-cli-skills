---
status: ready
priority: p1
issue_id: "078"
tags: [phase5, git, npm, release]
dependencies: ["075"]
---

# Problem Statement
Pandora cannot claim A+ if npm and git can diverge in practice. The release flow must explicitly enforce clean-tree, publish, verification, and push semantics.

# Recommended Action
Audit and tighten the git/npm parity workflow and document the invariant.

# Acceptance Criteria
- [ ] Clean-tree release behavior is explicit.
- [ ] npm version verification is part of the release path.
- [ ] Docs/trust material describe git/npm parity expectations.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex
