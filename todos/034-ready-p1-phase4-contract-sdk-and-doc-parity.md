---
status: ready
priority: p1
issue_id: "034"
tags: [agent-platform, phase4, docs, sdk, contracts]
dependencies: ["032"]
---

# Phase 4 Contract, SDK, and Documentation Parity

## Problem Statement

Policies and profiles increase the contract surface significantly. If capabilities, schema, MCP descriptors, SDKs, and docs drift, external agents will not be able to rely on the feature safely.

## Findings

- Capabilities originally exceeded size limits because policy/profile data duplicated too much per command.
- TS/Python SDKs needed adjustments for compact capability sections and selector handling.
- Docs still overemphasize raw `PRIVATE_KEY` setup and under-specify profile-first workflows.

## Proposed Solutions

### Option 1: Document policy/profile concepts manually and let each surface adapt independently

**Approach:** Keep docs and SDKs loosely synced through manual review.

**Pros:**
- Faster short-term edits

**Cons:**
- Reintroduces drift risk immediately
- Weakens the agent-platform story

**Effort:** 1-2 days

**Risk:** High

---

### Option 2: Treat policy/profile metadata as contract-level artifacts and test them across all exported surfaces

**Approach:** Keep the compact capability shape explicit, propagate it into SDKs/docs/tests, and validate parity via dedicated assertions.

**Pros:**
- Stronger consistency guarantees
- Better external onboarding
- Easier future recipe/profile integration

**Cons:**
- Requires more regression coverage and doc discipline

**Effort:** 2-3 days

**Risk:** Low

## Recommended Action

Implement Option 2 and keep docs/SDK parity inside the release gate, not as after-the-fact polish.

## Acceptance Criteria

- [ ] Capabilities payload stays within size budget and schema parity expectations
- [ ] TS and Python SDKs consume compact policy/profile capability sections correctly
- [ ] Docs prefer policy/profile examples over raw secret examples for agent usage
- [ ] Contract/docs parity checks cover policy/profile tool families

## Work Log

### 2026-03-08 - Todo Created

**By:** Codex

**Actions:**
- Added dedicated contract/docs parity todo for Phase 4
- Captured the specific payload-size and SDK selector regressions already found

**Learnings:**
- Policy/profile value is mostly lost if docs and SDKs lag behind the live contract.
