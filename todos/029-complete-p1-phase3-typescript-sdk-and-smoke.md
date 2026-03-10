---
status: complete
priority: p1
issue_id: "029"
tags: [agent-platform, phase3, sdk, typescript]
dependencies: ["027", "028"]
---

# Phase 3 TypeScript SDK and Smoke Hardening

## Problem Statement

The TypeScript SDK is the most likely first external integration surface. It needs typed ergonomics, local/remote backend parity, clear policy/profile inspection, and pack-install validation.

## Findings

- TypeScript artifacts live under `sdk/typescript/**` and are published through `package.json` exports.
- Earlier audit work already found mismatches between command descriptors and tool inspection.
- Consumer smoke tests need to cover generated metadata as well as ergonomic client helpers.

## Proposed Solutions

### Option 1: Publish generated files only

**Approach:** Keep the SDK close to raw generated JSON and require consumers to build their own helpers.

**Pros:**
- Minimal maintenance
- Low code surface area

**Cons:**
- Poor developer experience
- Weak platform adoption for external agents

**Effort:** 1 day

**Risk:** Medium

---

### Option 2: Ship a polished TS client around the generated manifest

**Approach:** Provide typed client helpers, inspection utilities, local/remote transport options, and smoke tests for real consumer use.

**Pros:**
- Strongest external developer story
- Better parity testing
- Easier future recipe/policy integrations

**Cons:**
- More release surface to maintain

**Effort:** 2-3 days

**Risk:** Low

## Recommended Action

Implement Option 2 and keep the TypeScript SDK as the reference external client.

## Acceptance Criteria

- [ ] TS SDK exposes typed helpers for tools, policies, profiles, and capabilities
- [ ] Local vs remote backend behavior is covered by tests or smoke fixtures
- [ ] Published package exports remain correct after generation
- [ ] Pack/install smoke validates TS SDK consumer flow

## Work Log

### 2026-03-08 - Todo Created

**By:** Codex

**Actions:**
- Added explicit TS SDK hardening board item
- Tied it to packaging and consumer-smoke validation

**Learnings:**
- The TS SDK should be treated as the reference ergonomics layer, not just a byproduct of generation.

### 2026-03-08 - Phase 3 Closed

**By:** Codex

**Actions:**
- Closed compiler, TypeScript SDK, Python SDK, and packaging parity gaps across generated artifacts
- Integrated six-agent implementation and audit findings across SDK code, docs, tests, and packaging
- Restored deterministic package/test behavior and verified full release gates end-to-end

**Learnings:**
- SDK trust depends on one normalized compiler path for manifests, tool definitions, and contract bundles
- MCP/local/remote parity issues surface fastest when smoke tests exercise generated consumers instead of only CLI internals

