---
status: ready
priority: p1
issue_id: "075"
tags: [phase5, release, drift, packaging]
dependencies: ["074"]
---

# Problem Statement
Phase 5 exists to make repo-head, generated artifacts, package surface, and npm release behavior impossible to drift silently. Some of this exists already, but it must be reviewed as a first-class A+ release discipline layer.

# Findings
- `test:unit` now uses a tracked runner.
- `release:prep`, `prepare_publish_manifest`, `restore_publish_manifest`, and trust checks already exist.
- External install and package-surface discipline can still be tightened and codified further.

# Recommended Action
Treat Phase 5 as a release-discipline product, not a collection of scripts.

# Acceptance Criteria
- [ ] The release discipline layer has explicit package-surface, generated-artifact, and external-install guarantees.
- [ ] CI/release checks fail on drift rather than relying on maintainer judgment.
- [ ] Git/npm parity expectations are documented and tested.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex
