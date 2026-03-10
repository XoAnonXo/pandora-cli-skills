---
status: complete
priority: p1
issue_id: "027"
tags: [agent-platform, phase3, sdk]
dependencies: ["026"]
---

# Phase 3 SDK Platform Index

## Problem Statement

Phase 2 introduced remote MCP and an operation-aware contract surface, but agents still need first-class library clients instead of process spawning. Phase 3 needs generated SDKs that share the same schemas, errors, envelopes, and capability metadata as the CLI and MCP surfaces.

## Findings

- The shared command contract now exists and is rich enough to drive code generation.
- SDK generation is already partially present in `sdk/generated`, `sdk/typescript`, and `sdk/python`.
- The remaining work is quality, parity, and packaging discipline: generated artifacts, client ergonomics, smoke tests, and docs must all be validated as one release unit.

## Proposed Solutions

### Option 1: Keep hand-maintained thin SDK wrappers

**Approach:** Maintain small handwritten SDK clients that call the CLI and remote gateway with minimal code generation.

**Pros:**
- Lower initial complexity
- Fast to patch manually

**Cons:**
- High drift risk
- Weak parity guarantees
- Poor long-term ergonomics for external adopters

**Effort:** 2-3 days

**Risk:** Medium

---

### Option 2: Generate SDK manifests and typed clients from the shared contract registry

**Approach:** Use the contract registry as the single source of truth and generate manifest artifacts, TypeScript/Python client helpers, typed errors, and smoke checks.

**Pros:**
- Strong parity across CLI/MCP/SDK
- Better external adoption story
- Easier future expansion into recipes and policies

**Cons:**
- Requires strong generator/test discipline
- More moving parts in packaging and release

**Effort:** 4-6 days

**Risk:** Medium

## Recommended Action

Implement Option 2 and treat Phase 3 as a platform-quality milestone, not just artifact generation. The workstreams below cover compiler/generator, TypeScript client, Python client, and packaging/smoke hardening.

## Technical Details

**Primary areas:**
- `cli/lib/sdk_contract_service.cjs`
- `scripts/generate_agent_contract_sdk.cjs`
- `sdk/generated/**`
- `sdk/typescript/**`
- `sdk/python/**`
- smoke and consumer tests

## Acceptance Criteria

- [x] Contract compiler produces deterministic generated manifests
- [x] TypeScript SDK supports local and remote backends with typed metadata
- [x] Python SDK supports local and remote backends with parity helpers
- [x] Pack/install and consumer smoke tests validate shipped artifacts
- [x] Phase 3 audit gate is green

## Work Log

### 2026-03-08 - Phase 3 Board Created

**By:** Codex

**Actions:**
- Captured Phase 3 as a tracked todo board with explicit acceptance criteria
- Linked Phase 3 to the completed Phase 2 gateway/operation work
- Framed Phase 3 as a parity and packaging milestone

**Learnings:**
- Generated SDK quality depends as much on manifest discipline and smoke testing as on code generation itself.

### 2026-03-08 - Phase 3 Closed

**By:** Codex

**Actions:**
- Closed compiler, TypeScript SDK, Python SDK, and packaging parity gaps across generated artifacts
- Integrated six-agent implementation and audit findings across SDK code, docs, tests, and packaging
- Restored deterministic package/test behavior and verified full release gates end-to-end

**Learnings:**
- SDK trust depends on one normalized compiler path for manifests, tool definitions, and contract bundles
- MCP/local/remote parity issues surface fastest when smoke tests exercise generated consumers instead of only CLI internals

