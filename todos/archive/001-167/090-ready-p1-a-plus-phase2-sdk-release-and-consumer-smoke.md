---
status: complete
priority: p1
issue_id: "090"
tags: [a-plus, phase2, sdk, release, smoke, trust]
dependencies: ["087", "088", "089"]
---

# Problem Statement
Even published SDK packages will not improve Pandora's grade if release discipline and consumer smoke are weak.

# Acceptance Criteria
- [ ] SDK release docs exist and are accurate.
- [ ] Consumer smoke tests run against public-style package artifacts.
- [ ] Contract digests stay aligned across CLI, TS SDK, and Python SDK.
- [ ] Release trust assets reference SDK package artifacts explicitly.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

### 2026-03-08 - Work in progress
**By:** Codex

**Actions:**
- Extended release trust checks to include standalone SDK tarball/wheel/sdist assets and checksum linkage.
- Added clean-consumer package smoke checks and regenerated contract artifacts so SDK digests, docs, and benchmark trust files stay in sync.

### 2026-03-08 - Completed
**By:** Codex

**Actions:**
- Added packaged-artifact checks for ESM TS consumers and Python sdist hygiene to make release smoke reflect actual external usage.
- Verified `check:sdk-contracts`, `check:sdk-standalone`, `check:release-trust`, and `check:docs` from the integrated Phase 2 proof set.
