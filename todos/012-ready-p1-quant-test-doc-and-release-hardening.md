---
status: ready
priority: p1
issue_id: "012"
tags: [testing, docs, release, hardening]
dependencies: ["002", "003", "004", "005", "006", "007", "008", "009", "010", "011"]
---

# Quant Expansion Hardening: Tests, Docs, Performance, Release

Finalize the quant expansion with full validation, documentation, and release checks before publish.

## Problem Statement

The quant stack introduces high-complexity numerical behavior. Without robust test coverage and docs, regressions or misuse risks are high.

## Findings

- Current repo standards require strong JSON envelope consistency and integration test coverage.
- New quant/model commands add numerical and statistical correctness concerns not covered by current suites.
- Documentation must include assumptions, constraints, and interpretation guidance.

## Proposed Solutions

### Option 1: Dedicated hardening phase (recommended)

**Approach:** Execute comprehensive unit/integration/perf docs pass after feature completion.

**Pros:**
- High release confidence
- Clear go/no-go criteria

**Cons:**
- Requires coordinated effort across modules

**Effort:** 10-14 hours

**Risk:** Low

---

### Option 2: Minimal docs and smoke tests only

**Approach:** Ship quickly with basic verification.

**Pros:**
- Faster release

**Cons:**
- Elevated risk in numerical correctness and agent workflows

**Effort:** 3-4 hours

**Risk:** High

## Recommended Action

Run full hardening gate including:
- Statistical property tests
- CLI integration and MCP workflow tests
- Performance envelopes
- SKILL/README updates with examples and risk notes
- Final release checklist + publish

## Technical Details

**Affected files:**
- `tests/unit/*.test.cjs` (new quant/model suites)
- `tests/cli/*.integration.test.cjs`
- `README.md`
- `README_FOR_SHARING.md`
- `SKILL.md`
- `package.json` scripts if needed

## Acceptance Criteria

- [ ] All unit/CLI/MCP tests pass
- [ ] Quant command docs added with examples and caveats
- [ ] Performance checks meet agreed bounds
- [ ] Release notes prepared and version bump completed
- [ ] `npm pack --dry-run` and publish checks pass

## Work Log

### 2026-03-02 - Todo Creation

**By:** Codex

**Actions:**
- Defined final hardening and release gate
- Positioned as terminal dependency for feature train

**Learnings:**
- Numerical features require explicit performance and stability acceptance criteria
