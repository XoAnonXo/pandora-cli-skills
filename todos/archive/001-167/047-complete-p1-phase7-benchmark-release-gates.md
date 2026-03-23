---
status: complete
priority: p1
issue_id: "047"
tags: [agent-platform, phase7, release, benchmarks]
dependencies: ["045", "046"]
---

# Phase 7 Benchmark Release Gates

## Problem Statement

Benchmarks only matter if they gate releases and remain reproducible. Phase 7 needs an explicit release-quality path.

## Findings

- Benchmark artifacts drift unless report, lock, and generated surfaces are checked together.
- Reproducibility matters as much as the raw score for public trust.

## Proposed Solutions

- Make benchmark verification part of the release path with committed lock artifacts.
- Treat score and parity regressions as release failures rather than post-release reporting.

## Recommended Action

Make benchmark generation and score regression checks part of the release process once the harness stabilizes.

## Acceptance Criteria

- [x] Benchmark runs are reproducible from source
- [x] Release gating can fail on benchmark regression
- [x] Public-ready score artifacts are generated consistently

## Work Log

### 2026-03-08 - Phase 7 Release Gate Todo Created

**By:** Codex

**Actions:**
- Added the release gate workstream for benchmarks

### 2026-03-08 - Benchmark Release Gate Completed

**By:** Codex

**Actions:**
- Wired `benchmark:check` into the release path
- Refreshed the committed lock and latest public report
- Closed the Phase 7 six-agent audit with all findings resolved

**Learnings:**
- Locking generated SDK artifacts alongside the contract is necessary to make benchmark regressions meaningful.
