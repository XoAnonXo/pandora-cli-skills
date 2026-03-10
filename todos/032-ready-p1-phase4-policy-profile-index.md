---
status: ready
priority: p1
issue_id: "032"
tags: [agent-platform, phase4, policy, profiles]
dependencies: ["031"]
---

# Phase 4 Policy and Profile Index

## Problem Statement

Pandora needs policy-first and profile-based execution so external agents can act safely without raw private-key handling or bespoke prompt discipline. Phase 4 makes those controls first-class across CLI, MCP, remote gateway, and SDKs.

## Findings

- The local tree already contains Phase 4 implementation work across policy/profile services, parsers, docs, SDK generation, and tests.
- Initial regressions were concentrated in capabilities payload size, stale service API usage, evaluator logic, remediation profile ids, and SDK contract consumption.
- Current targeted verification is green, but Phase 4 still needs a formal board, audit closure, and release-quality docs.

## Proposed Solutions

### Option 1: Ship policy/profile features as command add-ons

**Approach:** Keep policy/profile commands separate from execution semantics and document them as optional governance helpers.

**Pros:**
- Lower implementation complexity

**Cons:**
- Weak safety guarantees
- Easy bypass paths
- Fails the agent-platform goal

**Effort:** 1-2 days

**Risk:** High

---

### Option 2: Make policies and profiles part of the execution contract

**Approach:** Treat policy/profile resolution as core execution inputs that affect CLI, MCP, remote transport, SDKs, and operation metadata.

**Pros:**
- Strong agent-safety posture
- Clear path to recipes and named signer workflows
- Better external trust

**Cons:**
- Broader surface area to validate

**Effort:** 4-6 days

**Risk:** Medium

## Recommended Action

Implement Option 2 and keep Phase 4 centered on contract parity, runtime enforcement, and remediation quality.

## Acceptance Criteria

- [ ] Policy pack registry/store/evaluator are production-ready
- [ ] Profile registry/store/resolver/validate flows are production-ready
- [ ] CLI/MCP/remote/SDK surfaces expose consistent policy/profile semantics
- [ ] Denials are structured and remediation-oriented
- [ ] Phase 4 audit gate is green

## Work Log

### 2026-03-08 - Phase 4 Board Created

**By:** Codex

**Actions:**
- Added formal Phase 4 board after implementation had already started in-tree
- Recorded the main regression classes already encountered and fixed

**Learnings:**
- Phase 4 quality depends as much on parity and docs as on the raw policy/profile services.
