---
status: ready
priority: p1
issue_id: "142"
tags: [mcp, parimutuel, onboarding, hype, dry-run, agent-guidance]
dependencies: []
---

# Fix MCP parimutuel onboarding, suggestion routing, and signer-attached dry-run UX

## Problem Statement

The new MCP-first parimutuel user journey is runnable end-to-end, but it exposes three product gaps for a fresh external agent user:

1. `markets.hype.plan --ai-provider mock` produces placeholder-quality suggestion output and should not be treated as a real user ideation path.
2. The agent-facing parimutuel guidance is too thin for a newcomer who does not understand what a `99.9/0.1` pool skew means.
3. Once a signer is attached, parimutuel `markets.create.run --dry-run` becomes execution-like and fails on on-chain simulation funding instead of returning a cleaner readiness blocker first.

The scenario is implemented and reproducible via:

- `node scripts/run_user_journey.cjs --scenario mcp-parimutuel --out output/e2e/user-journeys/mcp-parimutuel.json`

## Findings

- The scenario report at `output/e2e/user-journeys/mcp-parimutuel.json` passes at the harness level but records three friction points:
  - `Mock hype suggestions are not production-quality market ideas`
  - `Parimutuel guidance does not explain skewed pool configuration`
  - `Parimutuel dry-run becomes execution-like as soon as a signer is attached`
- `markets.hype.plan --ai-provider mock` is useful for deterministic evals/tests, but in practice it returns placeholder candidate copy and fewer candidates than a fresh user would expect from a “suggest markets” workflow.
- For MCP users, `agent.market.hype` is not the primary path because they are already using an external agent through MCP. It should be a fallback/orchestration path, not the default recommendation.
- `markets.create.run --dry-run` without signer setup works as a planning surface, but with a signer attached it proceeds into parimutuel poll simulation and can fail with raw insufficient-funds execution errors.

## Recommended Action

Treat this as one MCP onboarding polish batch with three explicit deliverables:

1. Fix signer-attached parimutuel dry-run so signer presence yields structured readiness/preflight blockers before raw simulation funding failures.
2. Change MCP/user-facing guidance so provider-backed `markets.hype.plan` is the default “suggest markets” path and `mock` is clearly documented as deterministic test mode only.
3. Improve agent-visible parimutuel guidance so a newcomer understands pool-based resolution and how to express an extreme `99.9/0.1` directional skew.

## Acceptance Criteria

- [ ] MCP/user docs/bootstrap clearly state:
  - provider-backed `markets.hype.plan --ai-provider auto|openai|anthropic` is the real suggestion path
  - `--ai-provider mock` is test/eval-only
  - `agent.market.hype` is fallback/orchestration mode, not the primary MCP default
- [ ] Agent-visible parimutuel guidance explains pool-based behavior and the meaning of explicit skewed distributions such as `99.9/0.1`
- [ ] Signer-attached parimutuel `markets.create.run --dry-run` returns structured readiness/preflight guidance instead of a raw execution-style insufficient-funds simulation failure
- [ ] The `mcp-parimutuel` scenario still runs cleanly at the harness level and its friction list shrinks accordingly
- [ ] Focused tests cover the new routing/guidance/readiness behavior

## Verification

- `node --test tests/unit/user_journey_runner.test.cjs`
- `node scripts/run_user_journey.cjs --scenario mcp-parimutuel --out output/e2e/user-journeys/mcp-parimutuel.json`
- Any new focused CLI/MCP/unit tests added for hype guidance or dry-run readiness

## Work Log

### 2026-03-12 - Todo creation

**By:** Codex

**Actions:**
- converted the MCP parimutuel journey findings into a tracked work item
- scoped the batch around onboarding guidance, suggestion routing, and dry-run readiness
- anchored the work to the reproducible user-journey scenario and report

**Learnings:**
- the primary UX break is signer-attached parimutuel dry-run behavior
- the primary messaging break is treating mock hype planning like a real ideation path for MCP users
