---
status: ready
priority: p1
issue_id: "155"
tags: [claim, resolve, market-admin, abi-compatibility, polls, pari-mutuel]
dependencies: []
---

# Fix claim and resolve contract compatibility gaps

The claim/resolve bug audit in `/Users/mac/Desktop/pandora-cli-claim-bugs.md` mixes two confirmed compatibility gaps with two root-cause theories that do not match the current implementation. The worker should fix the real contract-compatibility issues first, add the missing coverage, and avoid blindly implementing speculative ABI changes that are not yet proven to be the cause of the live claim-scan miss.

## Problem Statement

Current `market_admin_service.cjs` assumes an older poll contract family:

- `resolve` is hard-wired to `resolveMarket(bool)`
- poll metadata readers only support a narrow set of finalized/answer/operator getters

That is a real risk for the newer contract family described in the bug report.

However, two parts of the report are not currently supported by the code evidence:

- the claim that pari-mutuel `redeemWinnings()` fails only because it returns two words
- the claim that `claim --all` skips simulation because poll parsing marked the market non-claimable

The worker should not collapse these into one “just add a two-output ABI” patch. The known contract-compatibility issues and the unresolved live claim-scan failure path need to be handled separately.

## Findings

### Confirmed gaps

1. `resolve` still assumes `resolveMarket(bool)`.
   - `market_admin_service.cjs` defines `RESOLVE_MARKET_ABI` as `resolveMarket(bool)` and executes that path in both dry-run metadata and live execution.
   - CLI integration tests also codify `txPlan.functionName === 'resolveMarket'`.

2. Poll readers are too narrow for the contract family described in the report.
   - operator candidates only try `arbiter`, `operator`, and `owner`
   - answer candidates only try `answer`, `getAnswer`, and `outcome`
   - finalized candidates only try:
     - `getFinalizedStatus(uint8,uint8,uint32)`
     - `getFinalizedStatus(bool,uint8,uint32)`
     - `getFinalizedStatus(bool)`
   - there is no `getArbiter` candidate and no support for a `bool + status` finalized tuple

3. Test coverage only reflects the older ABI family.
   - `market_admin_resolution_state.test.cjs` covers the old tuple shape and standalone `answer()` path
   - there is no regression for:
     - `getArbiter()`
     - `getFinalizedStatus(bool,uint256)` or equivalent bool+status shape
     - fallback answer derivation when there is no standalone answer getter
     - claim-all behavior when poll parsing is partial but redeem simulation succeeds

### Claims from the markdown that are not currently proven

1. The pari-mutuel `redeemWinnings()` return shape is not proven to be the direct reason simulation fails.
   - current `simulateRedeem()` already tries one-output and zero-output ABIs
   - viem decoding tolerates extra returndata for those signatures
   - adding a two-output candidate may still be reasonable, but it is not yet proven root cause

2. `claim --all` already simulates redeem regardless of parsed poll claimability.
   - `runClaimSingle()` always attempts `simulateRedeem()` when it has a simulation account
   - `runClaim()` simply fans out through `runClaimSingle()` for every discovered market
   - so the report’s suggested fix “always simulate regardless of poll parsing” is already the current behavior

## Proposed Solutions

### Option 1: Fix only the confirmed ABI compatibility gaps

- expand poll read candidates
- update `resolve` to match the supported poll family or block unsupported polls clearly
- add regression tests for the missing ABI shapes

Pros:

- addresses the real code defects now
- low ambiguity

Cons:

- does not explain the exact live `claim --all` miss by itself

### Option 2: Fix confirmed gaps and also add speculative claim ABI candidates

- do Option 1
- also add a `(uint256,uint256)` `redeemWinnings()` candidate

Pros:

- low-cost compatibility hedge
- may improve future pari-mutuel support if a live contract really needs it

Cons:

- risks encoding an unproven root cause into the codebase
- can hide the remaining real source of the live miss

### Option 3: Split compatibility fixes from live repro

- Track A: fix the confirmed poll/resolve compatibility issues
- Track B: reproduce the actual affected claimable markets and capture the real reason `claim --all --dry-run` missed them

Pros:

- keeps fixes evidence-based
- avoids solving the wrong problem

Cons:

- needs one more reproduction pass with real market addresses/wallet context

## Recommended Action

Take Option 3.

Implement in this order:

1. Fix the confirmed compatibility gaps:
   - add `getArbiter` support for operator/arbiter discovery
   - add support for newer finalized-status decoding if expected live contracts use a bool+status form
   - derive answer from supported status/finalized surfaces when there is no standalone answer getter
   - either:
     - add support for the newer poll resolution methods (`setAnswer`, `resolveArbitration`) with the correct caller-role checks, or
     - explicitly fail/document `resolve` as unsupported for that contract family

2. Add regression tests for the newer ABI family:
   - `getArbiter()`
   - finalized bool+status tuple
   - no standalone answer getter
   - claim-all with partial poll metadata but successful redeem simulation

3. Reproduce the live claim miss with real failing market addresses before declaring the claim path fixed.
   - only add a two-output pari `redeemWinnings()` ABI candidate if a live repro or targeted decoder check proves it is required

## Technical Details

Primary files:

- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/market_admin_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/tests/unit/market_admin_resolution_state.test.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/tests/cli/cli.integration.test.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/claim_command_service.cjs`

High-risk areas:

- `RESOLVE_MARKET_ABI`
- `CLAIM_MARKET_ABI_CANDIDATES`
- `POLL_FINALIZED_READ_CANDIDATES`
- `POLL_ANSWER_READ_CANDIDATES`
- `POLL_OPERATOR_READ_CANDIDATES`
- `readPollResolutionState()`
- `simulateRedeem()`
- `runClaimSingle()` / `runClaim()`

Evidence gathered during review:

- current code confirms `resolveMarket(bool)` is the only resolve path
- current code confirms the poll reader candidate lists are incomplete for the reported contract family
- current code contradicts the markdown’s claim that `claim --all` skips simulation based on poll parse state
- local viem decoder probing showed extra returndata does not by itself break one-output or zero-output `redeemWinnings()` decodes

## Acceptance Criteria

- [ ] Poll operator discovery supports `getArbiter()` when present
- [ ] Poll finalized-state parsing supports the live contract family used by current markets, including any bool+status form if applicable
- [ ] Poll answer derivation works when there is no standalone answer getter
- [ ] `resolve` either supports the live poll resolution methods or fails with an explicit unsupported-contract message instead of pretending `resolveMarket(bool)` is universal
- [ ] Regression tests cover the newer poll ABI family and claim-all with partial poll metadata
- [ ] The actual `claim --all` live miss is reproduced or falsified with concrete affected market addresses
- [ ] No speculative claim ABI change is merged without proof or targeted coverage

## Verification

- `node --test tests/unit/market_admin_resolution_state.test.cjs`
- `node --test tests/cli/cli.integration.test.cjs --test-name-pattern='resolve and lp commands are enabled'`
- targeted unit coverage for any new poll ABI candidates
- targeted live/dev repro with one or more affected claimable markets from the original report

## Resources

- `/Users/mac/Desktop/pandora-cli-claim-bugs.md`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/market_admin_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/tests/unit/market_admin_resolution_state.test.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/tests/cli/cli.integration.test.cjs`

## Notes

- The implementation addresses in the report were useful for selector inventory, but direct `eth_call` behavior on implementation contracts is not a clean substitute for reproducing the bug against actual live market/poll instances.
- Keep the worker focused on contract compatibility and proof-driven claim reproduction, not on blindly transcribing the markdown’s proposed fixes.

## Work Log

### 2026-03-15 - Claim bug review and todo creation

**By:** Codex

**Actions:**

- reviewed `/Users/mac/Desktop/pandora-cli-claim-bugs.md`
- cross-checked current claim/resolve implementation in `market_admin_service.cjs`
- reviewed current claim-resolution unit and CLI coverage
- validated that `claim --all` already flows through `runClaimSingle()` and still simulates redeem when a wallet/account is present
- probed viem decoder behavior for multi-word returndata against the current claim ABI candidates
- created a worker todo that separates confirmed compatibility bugs from unproven root-cause hypotheses

**Learnings:**

- the real confirmed problems are poll ABI compatibility and the stale `resolveMarket(bool)` assumption
- the markdown’s “always simulate” fix is already implemented
- the pari-mutuel two-output return shape is not yet proven to be the reason claim simulation failed in the reported live run
