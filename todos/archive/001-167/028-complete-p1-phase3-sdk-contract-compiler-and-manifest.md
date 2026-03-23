---
status: complete
priority: p1
issue_id: "028"
tags: [agent-platform, phase3, sdk, contracts]
dependencies: ["027"]
---

# Phase 3 SDK Contract Compiler and Manifest

## Problem Statement

The SDK layer only stays trustworthy if contract compilation is deterministic and exhaustive. Manifest drift between CLI, MCP, schema, and SDK output would undermine the whole agent platform story.

## Findings

- `cli/lib/sdk_contract_service.cjs` is the compiler pivot for generated artifacts.
- Generated manifests must stay aligned with `agent_contract_registry`, capabilities, and schema exports.
- Contract metadata now includes richer policy/profile/operation fields that need stable serialization.

## Proposed Solutions

### Option 1: Keep compiler minimal and rely on downstream clients

**Approach:** Emit the current manifest shape and let TypeScript/Python clients derive extra conveniences themselves.

**Pros:**
- Less compiler code
- Easier short-term iteration

**Cons:**
- Duplication across SDKs
- Higher risk of client divergence

**Effort:** 1-2 days

**Risk:** Medium

---

### Option 2: Centralize normalization and export-ready metadata in the compiler

**Approach:** Make the compiler responsible for stable, normalized, SDK-consumable manifest output.

**Pros:**
- Strong single-source contract story
- Easier downstream client maintenance
- Better future recipe/policy generation path

**Cons:**
- Slightly heavier compiler responsibilities

**Effort:** 2-3 days

**Risk:** Low

## Recommended Action

Implement Option 2. Keep downstream clients thin by pushing normalization, compatibility, and digest stability into the shared compiler.

## Acceptance Criteria

- [ ] Manifest generation is deterministic in check mode
- [ ] Capabilities/schema/SDK parity tests cover the compiler output
- [ ] Generated manifest includes operation, policy, and profile metadata expected by SDKs
- [ ] Compiler changes are documented in release notes/roadmap docs

## Work Log

### 2026-03-08 - Todo Created

**By:** Codex

**Actions:**
- Split compiler/manifest work into its own tracked item
- Anchored it to the shared contract registry and capabilities parity requirements

**Learnings:**
- Treating the compiler as the normalization layer reduces future SDK drift.

### 2026-03-08 - Phase 3 Closed

**By:** Codex

**Actions:**
- Closed compiler, TypeScript SDK, Python SDK, and packaging parity gaps across generated artifacts
- Integrated six-agent implementation and audit findings across SDK code, docs, tests, and packaging
- Restored deterministic package/test behavior and verified full release gates end-to-end

**Learnings:**
- SDK trust depends on one normalized compiler path for manifests, tool definitions, and contract bundles
- MCP/local/remote parity issues surface fastest when smoke tests exercise generated consumers instead of only CLI internals

