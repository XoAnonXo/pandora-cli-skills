---
status: complete
priority: p1
issue_id: "099"
tags: [a-plus, phase5, canonical, discovery, aliases]
dependencies: ["098"]
---

# Problem Statement
Tool discovery surfaces still need stronger canonical defaults and more explicit compatibility escape hatches.

# Acceptance Criteria
- [ ] `/tools`, `schema`, SDK catalog, and bootstrap default to canonical-only views.
- [ ] Compatibility aliases appear only in explicit compatibility/debug modes.
- [ ] Tests verify alias suppression and explicit reveal behavior.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

### 2026-03-08 - Completed
**By:** Codex
- `/tools`, `schema`, capabilities, bootstrap, and generated SDK catalogs now default to canonical-only discovery.
- Compatibility aliases require explicit `--include-compatibility` or `include_aliases=1`.
- Focused CLI/MCP/SDK/benchmark tests were updated and are green.
