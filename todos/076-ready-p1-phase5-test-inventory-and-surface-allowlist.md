---
status: ready
priority: p1
issue_id: "076"
tags: [phase5, tests, package-surface, ci]
dependencies: ["075"]
---

# Problem Statement
A world-class agent platform cannot have hidden test omissions or accidental package-surface changes. The current test runner and publish file list are better than before but should be explicitly audited and hardened.

# Recommended Action
Review test inventory discipline and shipped file-surface checks together.

# Acceptance Criteria
- [ ] Full tracked test inventory is executed or intentionally excluded with audit trail.
- [ ] Package-surface checks fail on unexpected inclusions or omissions.
- [ ] Repo-only files cannot silently ship.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex
