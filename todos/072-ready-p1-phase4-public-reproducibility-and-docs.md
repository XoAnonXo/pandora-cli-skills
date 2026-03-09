---
status: ready
priority: p1
issue_id: "072"
tags: [phase4, docs, benchmarks, reproducibility]
dependencies: ["070"]
---

# Problem Statement
Public benchmark credibility depends on reproducibility. The current docs need to be checked against the actual runner, lock semantics, and release workflow so external users can reproduce what Pandora claims.

# Findings
- `docs/benchmarks/README.md`, `scenario-catalog.md`, and `scorecard.md` exist.
- There is already a benchmark runner and checker.
- The public documentation must be verified against current scripts and release paths.

# Recommended Action
Audit and tighten benchmark docs so every user-facing claim is mechanically true.

# Acceptance Criteria
- [ ] Reproducibility instructions match current scripts exactly.
- [ ] Scenario catalog matches actual executed benchmark cases.
- [ ] Scorecard language matches the current benchmark output fields.
- [ ] Docs drift checks cover benchmark doc references where practical.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex
