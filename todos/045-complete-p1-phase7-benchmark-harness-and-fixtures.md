---
status: complete
priority: p1
issue_id: "045"
tags: [agent-platform, phase7, benchmarks, fixtures]
dependencies: ["044"]
---

# Phase 7 Benchmark Harness and Fixtures

## Problem Statement

Benchmarks need a stable harness, mock services, and deterministic fixtures before any scoring is meaningful.

## Findings

- Existing tests prove behavior, but not replayable benchmark state.
- Deterministic fixtures are required for cross-release and cross-transport comparison.

## Proposed Solutions

- Build a dedicated benchmark harness around versioned manifests and seeded runtime state.
- Reuse real transport paths where possible so the benchmark remains representative.

## Recommended Action

Build the harness around mock indexer, mock Polymarket, mock RPC, and mock remote MCP gateway fixtures, with scenario manifests that can be replayed across releases and model families.

## Acceptance Criteria

- [x] Deterministic benchmark harness exists
- [x] Mock services cover core Pandora agent surfaces
- [x] Scenario manifests are versioned
- [x] Local and remote transport scenarios are included

## Work Log

### 2026-03-08 - Phase 7 Harness Todo Created

**By:** Codex

**Actions:**
- Added the core harness/fixture workstream

### 2026-03-08 - Harness and Fixtures Completed

**By:** Codex

**Actions:**
- Added versioned benchmark manifests and isolated runtime fixtures
- Hardened remote MCP bootstrap to use the real gateway process and capability discovery
- Added seeded operation state and runtime-state capture

**Learnings:**
- A benchmark harness only becomes trustworthy once it stops shortcutting the real transport/runtime path.
