---
status: complete
priority: p1
issue_id: "098"
tags: [a-plus, phase5, canonical-tools, aliases, discovery]
dependencies: ["097"]
---

# Problem Statement
Compatibility aliases still leak enough visibility to increase discovery ambiguity for autonomous clients. A+ requires canonical-first discovery everywhere by default.

# Acceptance Criteria
- [ ] Canonical tools dominate every default discovery surface.
- [ ] Compatibility aliases are hidden unless explicitly requested.
- [ ] Recommendations/docs/examples lead with canonical tools only.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

### 2026-03-08 - Completed
**By:** Codex
- Canonical-tool dominance is now the default across bootstrap, capabilities, schema, MCP tool discovery, SDK contract exports, docs, and benchmark assertions.
- Compatibility aliases remain available only through explicit compatibility/debug opt-in paths.
