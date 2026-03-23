---
status: ready
priority: p1
issue_id: "159"
tags: [amm, sports, deploy, ux]
dependencies: []
---

# Fix AMM Probability And Sports Deploy Contracts

## Problem Statement

AMM market creation is still opening at the inverse of the user’s intended YES probability, and the sports creation flow compounds that with fake resolution sources and misleading timing controls. That breaks both pricing correctness and deploy trust for sports and hype-driven drafts.

## Findings

- `sports_creation_service.cjs`, `markets_hype_command_service.cjs`, and `pandora_amm_connector.cjs` still wire `distributionYes` from intended YES probability instead of the reserve share that produces that price.
- Sports plans still synthesize `https://odds.example/...` placeholder resolution sources and `sports create run` forwards them into deploy.
- Sports timing flags parse `--target-timestamp-offset-hours`, but the deployed `targetTimestamp` still tracks kickoff directly, so the operator-facing timing contract is misleading.

## Proposed Solutions

### Option 1: Fix math, source generation, and timing in-place

**Approach:** Correct reserve-share derivation at the source builders, replace fake sports sources with real/provider-backed or explicit operator sources, and make the timing offset mutate the deploy timestamp consistently.

**Pros:**
- Preserves current CLI/MCP surfaces
- Lowest migration cost
- Gives immediate correctness improvements

**Cons:**
- Requires coordinated updates across sports, hype, and connector layers

**Effort:** 3-5 hours

**Risk:** Medium

---

### Option 2: Introduce a separate sports deployment adapter

**Approach:** Centralize sports deploy preparation in a new adapter and route sports create/hype through it.

**Pros:**
- Cleaner long-term separation
- Easier to extend later

**Cons:**
- Larger refactor than required for this review batch
- Higher regression risk

**Effort:** 1-2 days

**Risk:** High

## Recommended Action

Implement Option 1. Fix the AMM probability math everywhere drafts are created, remove placeholder sports sources from deployable payloads, and make timing offsets affect the deployed target timestamp and user-facing confirmation output. Add focused unit and CLI coverage.

## Technical Details

**Affected files:**
- `cli/lib/sports_creation_service.cjs`
- `cli/lib/sports_command_service.cjs`
- `cli/lib/markets_hype_command_service.cjs`
- `cli/lib/connectors/pandora_amm_connector.cjs`
- related parser/help/tests

## Acceptance Criteria

- [x] Sports create and hype drafts open at the intended YES probability
- [x] Sports deploy payloads do not contain fake `odds.example` resolution sources
- [x] `--target-timestamp-offset-hours` changes the deployed `targetTimestamp`
- [x] Sports create output explains the effective deploy timing clearly
- [x] Focused unit and CLI tests cover the corrected behavior

## Work Log

### 2026-03-17 - Initial Triage

**By:** Codex

**Actions:**
- Grouped the AMM inversion, fake sports sources, and timing-control issues into one implementation track
- Defined the concrete acceptance criteria for sports/AMM fixes

**Learnings:**
- The three issues share the same draft-to-deploy contract and should be fixed together

### 2026-03-17 - Implementation Pass

**By:** Codex

**Actions:**
- Fixed AMM reserve mapping in sports/hype draft builders so target YES probability maps to NO reserve share:
  - `cli/lib/sports_creation_service.cjs`
  - `cli/lib/markets_hype_command_service.cjs`
- Removed synthetic `odds.example` source generation and replaced it with explicit `--sources` support plus provider-backed sportsbook URL derivation:
  - `cli/lib/parsers/sports_flags.cjs`
  - `cli/lib/sports_creation_service.cjs`
- Applied target timestamp offset into the deployed timestamp and surfaced the effective close time in CLI output:
  - `cli/lib/sports_creation_service.cjs`
  - `cli/lib/sports_command_service.cjs`
- Hardened connector pricing precedence to prefer reserve-derived AMM pricing when reserves are present:
  - `cli/lib/connectors/pandora_amm_connector.cjs`
- Updated focused regression coverage:
  - `tests/unit/sports_creation.test.cjs`
  - `tests/unit/markets_hype_command_service.test.cjs`
  - `tests/cli/sports.integration.test.cjs`
  - `tests/cli/cli.integration.test.cjs`

**Verification:**
- `node --test tests/unit/sports_creation.test.cjs tests/unit/markets_hype_command_service.test.cjs`
- `node --test tests/cli/sports.integration.test.cjs`
- `npm run typecheck`

**Learnings:**
- The sports deploy contract is safest when operator-provided and provider-derived sources share one normalized path, instead of mixing inferred placeholders into execution payloads.
