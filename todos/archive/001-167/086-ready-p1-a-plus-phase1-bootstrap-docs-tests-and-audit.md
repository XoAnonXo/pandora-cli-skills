---
status: complete
priority: p1
issue_id: "086"
tags: [a-plus, phase1, bootstrap, docs, tests, audit]
dependencies: ["083", "084", "085"]
---

# Problem Statement
Bootstrap will not raise Pandora to A+ if it is under-documented, over-documented, or tested only as an implementation detail.

# Findings
- Current docs explain preferred bootstrap order but do not point to a single `bootstrap` surface.
- Existing tests validate `capabilities`, `schema`, and tool lists separately.
- The right tests must assert agent outcomes: minimal-call bootstrap, canonical tool visibility, readiness warnings, and usable next actions.

# Recommended Action
Update docs/skills to lead with bootstrap and add behavior-first tests that verify a cold agent can safely bootstrap from one call.

# Acceptance Criteria
- [x] Agent-facing docs lead with `bootstrap` as the preferred first call.
- [x] Tests verify bootstrap returns actionable next steps, not just fields.
- [x] Audit pass checks that compatibility aliases remain hidden by default.
- [x] Benchmark/docs stay in sync with bootstrap semantics.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

**Actions:**
- Scoped bootstrap documentation and behavior-first audit work as the final Phase 1 gate.

### 2026-03-08 - Phase completed
**By:** Codex

**Actions:**
- Updated help text and docs so bootstrap is described as the canonical first call for cold agent clients.
- Added and ran behavior-first bootstrap tests for local CLI payloads, degraded profile warnings, remote bootstrap auth/scope behavior, and canonical alias hiding.
- Ran the Phase 1 audit loop; the concrete issues that surfaced were fixed locally before signoff.
