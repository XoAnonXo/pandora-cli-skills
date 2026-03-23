---
status: ready
priority: p1
issue_id: "062"
tags: [operations, webhooks, deployments, remote]
dependencies: ["060"]
---

# Problem Statement
Remote control-plane credibility depends on durable operations, webhook delivery, and reference deployment topologies.

# Recommended Action
Strengthen operations APIs, webhook lifecycle semantics, and deployment references so remote Pandora feels like a real platform, not just a dev helper.

# Acceptance Criteria
- [ ] Remote operation queries, cancel, close, and checkpoint inspection are documented and tested.
- [ ] Webhook delivery semantics are explicit and signed where required.
- [ ] Reference deployment topologies exist for at least local server, systemd, and containerized modes.

# Work Log
### 2026-03-08 - Created operations/webhooks/deployments todo
**By:** Codex
