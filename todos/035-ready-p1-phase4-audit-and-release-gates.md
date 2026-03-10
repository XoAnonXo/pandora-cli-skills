---
status: ready
priority: p1
issue_id: "035"
tags: [agent-platform, phase4, release, audit]
dependencies: ["033", "034"]
---

# Phase 4 Audit and Release Gates

## Problem Statement

Phase 4 introduces governance and signer indirection. It should not ship on partial confidence. Dedicated audit and release gates are required.

## Findings

- The current local tree already needed multiple audit/fix loops to stabilize policy/profile behavior.
- The most valuable audit lanes are: policy runtime, profile runtime, TypeScript SDK, Python SDK, docs/skills, and test coverage.
- Dedicated CLI/MCP tests for policy/profile commands were not in the default CLI suite until this pass.

## Proposed Solutions

### Option 1: Treat policy/profile as normal feature work under the existing release gate

**Approach:** Rely on the generic test suite and code review.

**Pros:**
- Minimal process overhead

**Cons:**
- Governance bugs are easy to miss
- Weak external trust signal

**Effort:** <1 day

**Risk:** Medium

---

### Option 2: Run a named six-lane audit before promotion and make parity tests mandatory

**Approach:** Keep explicit specialist audits and a documented verification matrix for Phase 4 before publish.

**Pros:**
- Stronger confidence in a sensitive phase
- Easier to explain and repeat later

**Cons:**
- Slower release cadence

**Effort:** 1 day

**Risk:** Low

## Recommended Action

Implement Option 2. Policy/profile changes merit a stricter gate than normal feature work.

## Acceptance Criteria

- [ ] Six specialist audit lanes are executed and tracked
- [ ] `test:unit`, `test:cli`, and `test:agent-workflow` are green with policy/profile suites included
- [ ] Manual CLI spot checks cover `policy list/get` and `profile list/get/validate`
- [ ] Audit findings are either fixed or explicitly deferred with rationale

## Work Log

### 2026-03-08 - Todo Created

**By:** Codex

**Actions:**
- Added a named Phase 4 audit gate todo
- Recorded the six audit lanes and mandatory verification matrix

**Learnings:**
- Governance features need repeatable audit structure, not just broad confidence.
