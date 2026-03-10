---
status: complete
priority: p1
issue_id: "046"
tags: [agent-platform, phase7, benchmarks, scoring]
dependencies: ["044", "045"]
---

# Phase 7 Agent Readiness Scenarios and Scores

## Problem Statement

Pandora needs benchmark scenarios that actually reflect how agents use the platform: discovery, plan/validate/execute, recovery, policy denial, closeout, and long-running job handling.

## Findings

- A benchmark without denial and parity coverage would overstate readiness.
- Success/failure alone is not enough; latency, safety, and recovery quality need explicit scoring.

## Proposed Solutions

- Define a scenario pack that covers discovery, denial, parity, and lifecycle transitions.
- Score results across success, latency, safety, and recovery dimensions.

## Recommended Action

Define scenario packs, scoring rules, and safety/latency/recovery metrics that can be published and compared across releases.

## Acceptance Criteria

- [x] Scenario pack covers major workflows and failure modes
- [x] Scoring includes success, latency, safety, and recovery quality
- [x] Results are machine-readable and publishable

## Work Log

### 2026-03-08 - Phase 7 Scenario Todo Created

**By:** Codex

**Actions:**
- Added the scenario/scoring workstream

### 2026-03-08 - Scenario and Score Model Completed

**By:** Codex

**Actions:**
- Expanded the suite to 19 scenarios, including listTools parity and operation cancel/close lifecycle checks
- Added dimension summaries, parity membership validation, runtime state, and stronger denial assertions

**Learnings:**
- A benchmark score is only credible when parity failures can zero out the headline score.
