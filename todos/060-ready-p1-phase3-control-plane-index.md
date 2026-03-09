---
status: ready
priority: p1
issue_id: "060"
tags: [gateway, remote-mcp, control-plane, operations]
dependencies: []
---

# Problem Statement
Pandora has a shipped remote MCP gateway, but not yet a production-grade hosted control-plane story.

# Recommended Action
Upgrade the gateway into a deployable, observable, rate-limited, durable remote operating surface with explicit operator guidance.

# Acceptance Criteria
- [ ] Remote gateway deployment guidance exists and is tested.
- [ ] Operations/status/webhook flows are credible for long-running work.
- [ ] Auth, rate limits, request ids, and telemetry are explicit.
- [ ] Remote/local parity remains release-blocked.

# Work Log
### 2026-03-08 - Created control plane index todo
**By:** Codex
