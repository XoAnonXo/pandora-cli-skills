---
status: complete
priority: p1
issue_id: "042"
tags: [agent-platform, phase6, docs, contracts, tests]
dependencies: ["040"]
---

# Phase 6 Contract-Driven Docs and Parity Gates

## Problem Statement

Documentation should not drift from the command contract. The current system relies partly on manual editing, which is brittle as tool families, transports, policies, and SDK surfaces expand.

## Findings

- The shared contract registry is now rich enough to drive summaries and machine checks.
- `schema`, `capabilities`, MCP descriptors, and SDK artifacts are already parity-sensitive surfaces.
- Docs should either be generated from the contract or validated against it continuously.

## Proposed Solutions

### Option 1: Keep docs hand-authored and rely on reviewer discipline

**Approach:** Maintain docs manually and depend on human review to catch drift.

**Pros:**
- Minimal tooling work

**Cons:**
- Drift is inevitable
- Harder to scale with more transports and policies

**Effort:** <1 day

**Risk:** High

### Option 2: Add contract-driven summary generation and doc parity tests

**Approach:** Generate or derive compact reference artifacts from the shared contract and fail tests when key docs drift from those invariants.

**Pros:**
- Stronger correctness
- Scales better
- Better release confidence

**Cons:**
- More test/tooling

**Effort:** 1-2 days

**Risk:** Medium

## Recommended Action

Implement Option 2. At minimum, the docs layer should have parity tests for file existence, route references, canonical command naming, and transport/bootstrap guidance.

## Acceptance Criteria

- [x] Contract-aware doc generator or summarizer exists
- [x] Doc parity tests fail on broken routes or stale core claims
- [x] Generated/verified doc output covers canonical commands and transport surfaces
- [x] Package/release flow preserves the generated/verified docs

## Work Log

### 2026-03-08 - Phase 6 Contract Parity Todo Created

**By:** Codex

**Actions:**
- Created a dedicated workstream for contract-driven doc quality and parity gates

**Learnings:**
- The doc platform needs enforcement, not just better wording.

### 2026-03-08 - Contract-Driven Docs Completed

**By:** Codex

**Actions:**
- Added contract-aware doc helpers and parity tests
- Kept generated/verified docs inside the package surface and release checks

**Learnings:**
- Once docs are part of the contract, drift becomes a testable bug rather than a review chore.
