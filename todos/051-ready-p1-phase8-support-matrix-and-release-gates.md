---
status: ready
priority: p1
issue_id: "051"
tags: [agent-platform, phase8, release, support]
dependencies: ["049", "050"]
---

# Phase 8 Support Matrix and Release Gates

## Problem Statement

Trust also means clarity about what Pandora supports, under what conditions, and how those guarantees are enforced at release time.

## Findings

- Support claims are only useful if they are versioned and test-backed.
- Release trust artifacts need a single consumer-facing matrix that matches CI enforcement.

## Proposed Solutions

- Publish a support matrix covering each public surface and link it to release checks.
- Expose trust metadata through capabilities/schema so agents can discover support posture directly.

## Recommended Action

Publish a support matrix for local CLI, stdio MCP, remote MCP, TypeScript SDK, Python SDK, and future hosted surfaces; then tie release verification to that matrix.

Concrete tasks:
- add a consumer-facing support matrix with guarantees and caveats
- expose trust/distribution metadata through capabilities/schema for agents
- add unit/smoke checks that fail when support/trust artifacts disappear from the package or release flow

## Acceptance Criteria

- [ ] Support matrix is documented and versioned
- [ ] Release checklist references trust artifacts and support guarantees
- [ ] Trust/distribution regressions can fail release prep

## Work Log

### 2026-03-08 - Phase 8 Support Matrix Todo Created

**By:** Codex

**Actions:**
- Added the support-matrix/release-gate workstream

### 2026-03-08 - Support Matrix Lane Started

**By:** Codex

**Actions:**
- Assigned separate lanes for support docs, machine-readable trust metadata, and release/trust test coverage
- Scoped Phase 8 release gates around support claims that can actually be verified in CI

**Learnings:**
- A support matrix is part of the contract; it should be test-backed, not just published prose.
