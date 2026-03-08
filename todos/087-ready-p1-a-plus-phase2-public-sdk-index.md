---
status: complete
priority: p1
issue_id: "087"
tags: [a-plus, phase2, sdk, typescript, python, packaging]
dependencies: ["086"]
---

# Problem Statement
Pandora has generated SDK artifacts, but not fully productized public SDK packages. That caps external agent adoption and keeps SDK/API consumption below A.

# Findings
- Current SDKs are embedded/generated and parity-tested, but not first-class public packages.
- External users still anchor on the CLI package instead of standalone SDK install flows.
- Packaging, semver, and consumer smoke expectations need to become product surfaces, not repo internals.

# Recommended Action
Publish standalone TypeScript and Python SDK products generated from the same contract registry, with independent install docs and consumer smoke tests.

# Acceptance Criteria
- [ ] Public TS and Python SDK packages exist and install cleanly from fresh environments.
- [ ] Both support local and remote backends with the same normalized envelope semantics.
- [ ] SDK release docs and trust metadata are explicit and up to date.
- [ ] Release gates fail on SDK contract or package drift.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

**Actions:**
- Created the Phase 2 index for standalone SDK productization.

### 2026-03-08 - Phase started
**By:** Codex

**Actions:**
- Added standalone SDK packaging flows, contract generation, consumer smoke checks, and release-trust linkage for SDK artifacts.
- Began the Phase 2 audit loop to close remaining gaps between generated SDK surfaces and true external-consumer productization.

### 2026-03-08 - Phase completed
**By:** Codex

**Actions:**
- Closed the remaining public-SDK gaps around standalone package identity, TypeScript native ESM support, Python package hygiene, and release-artifact trust coverage.
- Verified package-local and built-artifact smoke for both SDKs, plus docs, contract, and release-trust parity.
