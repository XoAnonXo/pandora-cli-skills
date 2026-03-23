---
status: ready
priority: p1
issue_id: "071"
tags: [phase4, release, benchmarks, artifacts]
dependencies: ["070"]
---

# Problem Statement
Benchmark reports and locks must be promoted into clear release artifacts. If a release cannot point to an exact benchmark bundle, the benchmark remains an internal check rather than a public trust artifact.

# Findings
- `benchmarks/latest/core-report.json` and `benchmarks/locks/core.lock.json` already exist.
- `prepack` and release prep touch the benchmark flow.
- There is still room for stronger release-asset guidance and parity checks.

# Proposed Solutions
## Option 1
Augment existing release scripts and docs with benchmark asset checks and references.
## Option 2
Introduce a separate benchmark release package.

# Recommended Action
Use Option 1 and make benchmark asset publication part of the existing release/trust flow.

# Acceptance Criteria
- [ ] Release checks fail if benchmark assets are missing or stale.
- [ ] Docs point to the same benchmark files the package/release produces.
- [ ] Benchmark asset metadata includes package/version/lock relationship.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

**Actions:**
- Created benchmark release-asset todo.
