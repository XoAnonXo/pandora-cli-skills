---
status: complete
priority: p1
issue_id: "100"
tags: [a-plus, phase5, docs, benchmarks, compatibility]
dependencies: ["098", "099"]
---

# Problem Statement
Canonical tool dominance only helps if docs, benchmark scenarios, and trust surfaces reinforce the same model.

# Acceptance Criteria
- [ ] Docs/examples use canonical tools by default.
- [ ] Benchmarks assert canonical-first discovery behavior.
- [ ] Compatibility-mode behavior is documented narrowly for legacy consumers.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

### 2026-03-08 - Completed
**By:** Codex
- Agent docs now lead with `bootstrap` and frame compatibility mode as legacy/debug only.
- Benchmark assertions and trust artifacts were refreshed to enforce canonical-first discovery behavior.
- `benchmark:check`, `check:docs`, `check:sdk-contracts`, and `check:release-trust` all pass from the current worktree.
