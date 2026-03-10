---
status: ready
priority: p1
issue_id: "005"
tags: [simulate, monte-carlo, namespace, cli]
dependencies: ["001"]
---

# Add simulate mc Command Namespace

Create a standalone `pandora simulate mc` command for desk-grade Monte Carlo outside mirror-only flows.

## Problem Statement

Advanced simulation should be usable independently of mirror commands for pricing, stress, and strategy research.

## Findings

- Article progression treats Monte Carlo as a general engine, not tied to one execution path.
- Existing CLI has no `simulate` namespace yet.
- Architecture supports adding top-level command families cleanly via router + command service.

## Proposed Solutions

### Option 1: New top-level `simulate` family (recommended)

**Approach:** Add `simulate` command service and parser with `mc` subcommand first.

**Pros:**
- Clear extensibility for PF/ABM subcommands
- Strong discoverability

**Cons:**
- Requires schema/MCP updates

**Effort:** 6-8 hours

**Risk:** Medium

---

### Option 2: Embed in existing command families only

**Approach:** Keep advanced simulation under mirror/sports only.

**Pros:**
- Less new surface area

**Cons:**
- Harder to compose and reuse for research workflows

**Effort:** 2-3 hours

**Risk:** Medium

## Recommended Action

Implement `pandora simulate mc` with deterministic seed support, variance-reduction flags, and robust risk outputs.

## Technical Details

**Affected files:**
- `cli/lib/simulate_command_service.cjs` (new)
- `cli/lib/parsers/simulate_flags.cjs` (new)
- `cli/lib/command_router.cjs`
- `tests/unit/simulate_mc.test.cjs`
- `tests/cli/cli.integration.test.cjs`

## Acceptance Criteria

- [ ] `pandora simulate mc --help` works in table/json modes
- [ ] Output includes CI + VaR/ES + diagnostics
- [ ] Supports `--seed` deterministic replay
- [ ] Registered in schema descriptors

## Work Log

### 2026-03-02 - Todo Creation

**By:** Codex

**Actions:**
- Defined standalone MC command scope and parser requirements
- Linked with quant-core dependency

**Learnings:**
- This command becomes the base for model-driven BYOM workflows
