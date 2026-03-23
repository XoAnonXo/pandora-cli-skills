---
status: ready
priority: p1
issue_id: "111"
tags: [a-plus, phase9, drift, package, generated]
dependencies: ["110"]
---

# Problem Statement
Release drift often comes from package surface, generated contract artifacts, and benchmark locks moving out of sync.

# Acceptance Criteria
- [ ] Package allowlist and packed-artifact checks are release-blocking.
- [ ] Generated contract, SDK, docs, and benchmark lock freshness checks are release-blocking.
- [ ] Failure messages point directly to the stale surface and regeneration command.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

