---
status: complete
priority: p1
issue_id: "097"
tags: [a-plus, phase4, remediation, docs, agents]
dependencies: ["095", "096"]
---

# Problem Statement
Explainability surfaces must be reflected in agent docs, bootstrap guidance, and behavior-first tests or they will not meaningfully reduce agent planning burden.

# Acceptance Criteria
- [x] Docs teach `policy explain` / `profile explain` as the default safety reasoning path.
- [x] Tests validate remediation quality, not just presence of fields.
- [ ] Benchmark scenarios include explainability-assisted safe planning.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

### 2026-03-08 - Phase completed with one deferred benchmark follow-up
**By:** Codex

- Updated docs to route cold agents through `bootstrap`, then `policy explain` / `profile explain` / recommendation surfaces.
- Strengthened behavior-first tests around exact denial causes, canonical-tool-first remediation, and machine-usable next-step guidance.
- Left benchmark scenario expansion as a deliberate follow-up for the benchmark/public-trust phase rather than blocking Phase 4 completion.
