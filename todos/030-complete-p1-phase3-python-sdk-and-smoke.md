---
status: complete
priority: p1
issue_id: "030"
tags: [agent-platform, phase3, sdk, python]
dependencies: ["027", "028"]
---

# Phase 3 Python SDK and Smoke Hardening

## Problem Statement

Python is the second likely integration language for external agents and quants. The Python package needs parity with the contract manifest and safe selector handling, not just raw generated stubs.

## Findings

- Python artifacts live under `sdk/python/pandora_agent/**`.
- Prior audits found selector pollution and stale expectations when compact capability sections changed.
- Python packaging and test isolation need to stay deterministic as generated files evolve.

## Proposed Solutions

### Option 1: Publish raw generated Python modules only

**Approach:** Limit the Python package to manifest wrappers and keep higher-level logic out of tree.

**Pros:**
- Smaller package
- Less maintenance

**Cons:**
- Low utility for external agent builders
- Drift likely moves into user code instead of being solved once

**Effort:** 1 day

**Risk:** Medium

---

### Option 2: Maintain a thin but opinionated Python client over generated contracts

**Approach:** Keep manifest generation automatic while shipping curated client helpers, inspection methods, and smoke coverage.

**Pros:**
- Better adoption for Python-first teams
- Stronger parity with TS and CLI semantics
- Easier benchmark/eval harness integration later

**Cons:**
- More generated + handwritten boundary management

**Effort:** 2-3 days

**Risk:** Low

## Recommended Action

Implement Option 2 and treat Python as a first-class SDK surface, not an afterthought.

## Acceptance Criteria

- [ ] Python client exposes stable helpers for capabilities, policies, profiles, and tool inspection
- [ ] Selector handling only uses valid command selector fields
- [ ] Python smoke/tests validate generated package semantics
- [ ] Generated package metadata stays consistent with published CLI contract

## Work Log

### 2026-03-08 - Todo Created

**By:** Codex

**Actions:**
- Added explicit Python SDK hardening todo
- Recorded the selector-parity and packaging risks as acceptance criteria

**Learnings:**
- Python needs first-class validation because many external agent systems prototype there first.

### 2026-03-08 - Phase 3 Closed

**By:** Codex

**Actions:**
- Closed compiler, TypeScript SDK, Python SDK, and packaging parity gaps across generated artifacts
- Integrated six-agent implementation and audit findings across SDK code, docs, tests, and packaging
- Restored deterministic package/test behavior and verified full release gates end-to-end

**Learnings:**
- SDK trust depends on one normalized compiler path for manifests, tool definitions, and contract bundles
- MCP/local/remote parity issues surface fastest when smoke tests exercise generated consumers instead of only CLI internals

