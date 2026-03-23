---
status: ready
priority: p1
issue_id: "033"
tags: [agent-platform, phase4, policy, runtime]
dependencies: ["032"]
---

# Phase 4 Policy and Profile Runtime Hardening

## Problem Statement

Policy and profile commands are only useful if runtime enforcement and resolution semantics are trustworthy. This workstream covers evaluator correctness, profile readiness, remediation quality, and execution-path parity.

## Findings

- Early Phase 4 work revealed stale service method calls and evaluator assumptions from an older flat policy model.
- `profile validate` needed runtime-readiness visibility in addition to schema validity.
- Built-in policy remediation examples were pointing at nonexistent profile ids.

## Proposed Solutions

### Option 1: Keep runtime checks shallow and documentation-heavy

**Approach:** Validate shape only and rely on docs/examples for the rest.

**Pros:**
- Smaller code surface

**Cons:**
- Poor agent safety
- Weak trust in denials/remediation

**Effort:** 1 day

**Risk:** High

---

### Option 2: Enforce runtime correctness and expose readiness/violations explicitly

**Approach:** Keep policy evaluation and profile resolution as rich runtime services with structured outputs and parity tests.

**Pros:**
- Stronger real-world safety
- Better agent introspection
- Cleaner path to policy packs and named signer profiles later

**Cons:**
- More test matrix to maintain

**Effort:** 2-3 days

**Risk:** Medium

## Recommended Action

Implement Option 2. Runtime safety and denial clarity are the point of Phase 4.

## Acceptance Criteria

- [ ] Policy evaluator supports current compiled rule shapes
- [ ] Profile validation surfaces runtime readiness separately from schema validity
- [ ] Remediation references valid profile ids and safe next steps
- [ ] Runtime denials are identical across CLI/MCP/remote paths for the same request

## Work Log

### 2026-03-08 - Todo Created

**By:** Codex

**Actions:**
- Captured runtime hardening as a dedicated Phase 4 workstream
- Folded in the concrete regressions already observed during local implementation

**Learnings:**
- Readiness and remediation must be treated as runtime outputs, not static metadata.
