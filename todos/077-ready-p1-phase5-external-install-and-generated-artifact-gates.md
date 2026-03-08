---
status: ready
priority: p1
issue_id: "077"
tags: [phase5, smoke, install, generated-artifacts]
dependencies: ["075"]
---

# Problem Statement
External install behavior and generated artifact freshness are where many release-quality projects still fail. These checks must be explicit and blocking.

# Recommended Action
Tighten and audit the existing smoke/generation gates so they cover the actual consumer experience.

# Acceptance Criteria
- [ ] Clean install audit is part of the release discipline story.
- [ ] Generated contract/SDK artifacts are checked against the live registry.
- [ ] Release-prep output is enough to diagnose drift quickly.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex
