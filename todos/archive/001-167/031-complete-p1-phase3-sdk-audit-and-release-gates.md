---
status: complete
priority: p1
issue_id: "031"
tags: [agent-platform, phase3, sdk, release]
dependencies: ["028", "029", "030"]
---

# Phase 3 SDK Audit and Release Gates

## Problem Statement

Phase 3 should only ship when generated SDKs are verified as production surfaces. That requires explicit audit gates beyond raw generation.

## Findings

- Pack/install smoke, consumer JSON smoke, and generated contract checks already exist and need to remain mandatory.
- SDK releases can regress through packaging, export maps, stale generated files, or contract drift.
- External agent trust depends on reproducible release verification.

## Proposed Solutions

### Option 1: Rely on normal test/build scripts

**Approach:** Treat SDKs as part of the existing CLI build without dedicated release gates.

**Pros:**
- Minimal workflow change

**Cons:**
- Easy to miss packaging or consumer issues
- Weak external readiness signal

**Effort:** <1 day

**Risk:** Medium

---

### Option 2: Add explicit Phase 3 audit checklist and smoke gates

**Approach:** Make SDK generation, pack/install, consumer smoke, parity checks, and docs consistency explicit release requirements.

**Pros:**
- Stronger confidence in shipped SDKs
- Easier future benchmark integration
- Better separation of platform concerns

**Cons:**
- Slightly slower release cycle

**Effort:** 1 day

**Risk:** Low

## Recommended Action

Implement Option 2. Phase 3 should have a named release gate just like prior phases.

## Acceptance Criteria

- [ ] `generate:sdk-contracts` and `check:sdk-contracts` are green
- [ ] `test:smoke` validates shipped SDK surfaces
- [ ] Packaging exports match published docs
- [ ] A documented Phase 3 audit summary exists before promotion

## Work Log

### 2026-03-08 - Todo Created

**By:** Codex

**Actions:**
- Added dedicated Phase 3 release-gate todo
- Recorded the required smoke and parity checks

**Learnings:**
- SDK confidence requires explicit pack/install verification, not only source-level tests.

### 2026-03-08 - Phase 3 Closed

**By:** Codex

**Actions:**
- Closed compiler, TypeScript SDK, Python SDK, and packaging parity gaps across generated artifacts
- Integrated six-agent implementation and audit findings across SDK code, docs, tests, and packaging
- Restored deterministic package/test behavior and verified full release gates end-to-end

**Learnings:**
- SDK trust depends on one normalized compiler path for manifests, tool definitions, and contract bundles
- MCP/local/remote parity issues surface fastest when smoke tests exercise generated consumers instead of only CLI internals

