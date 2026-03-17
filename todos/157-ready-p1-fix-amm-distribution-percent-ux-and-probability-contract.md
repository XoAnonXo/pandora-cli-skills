---
status: ready
priority: p1
issue_id: "157"
tags: [amm, cli, mirror, markets-create, pricing, ux, probability, distribution]
dependencies: []
---

# Fix AMM distribution percent UX and probability contract

The current AMM creation flags expose raw reserve weights under names that operators naturally interpret as initial YES/NO price or probability. That mismatch causes systematic market mispricing.

Today, `--distribution-yes-pct 77` means “seed 77% of pool tokens on the YES side,” but the AMM prices YES as:

- `yesPrice = reserveNo / (reserveYes + reserveNo)`

So a 77/23 reserve split produces an initial YES price of roughly 23%, not 77%.

This is not a math bug in the AMM. It is a product and parameter-contract bug in the CLI/MCP surface.

## Problem Statement

Operators expect:

- `--distribution-yes-pct 77` => market opens with YES around 77%

Current behavior is:

- `--distribution-yes-pct 77` => YES reserve share = 77%
- initial YES price ≈ 23%

That is a dangerous naming and UX footgun because:

1. the flag names imply price/probability semantics
2. help text reinforces that misunderstanding
3. plan/run/deploy outputs do not clearly surface the derived initial YES probability
4. the same issue exists across:
   - `markets create`
   - `mirror deploy`
   - `mirror go`
   - agent/MCP input schemas

Current mitigation status:

- `--initial-yes-pct` / `--initial-no-pct` now exist in the current CLI and generated SDK/MCP contracts.
- help/docs/schema text now describe raw `--distribution-yes-pct` / `--distribution-no-pct` as reserve-weight controls.
- the remaining gap is that the legacy raw percent flags still exist with the old semantics, so operators and stale MCP sessions can still hit the footgun unless they switch to the probability-native flags.

## Findings

### Confirmed implementation behavior

1. Percentage flags currently map directly to reserve weights.
   - `markets_create_flags.cjs` converts `distribution-yes-pct` directly into `distributionYes`
   - `mirror_deploy_flags.cjs` does the same
   - `mirror_go_flags.cjs` does the same

2. Pandora AMM YES price is derived inversely from YES reserve share.
   - `pandora_amm_connector.cjs` derives:
     - `yesPrice = reserveNo / (reserveYes + reserveNo)`
   - `amm_target_pct_service.cjs` uses the same YES-percent derivation from reserves

3. Another part of the product already knows the correct probability-to-distribution mapping.
   - `mirror_sizing_service.cjs` converts target YES probability `p` into:
     - `distributionNo = p`
     - `distributionYes = 1 - p`

4. Tests currently encode the misleading reserve-weight behavior as if it were the intended UX contract.
   - parser tests assert that `--distribution-yes-pct 63` becomes `distributionYes = 630_000_000`
   - there is no test asserting the user-facing initial YES probability implied by those reserves

5. A probability-native workaround is now live in the current tree.
   - `version` reports `1.1.113`
   - parser/help and agent contract registry surfaces now expose `--initial-yes-pct` / `--initial-no-pct`
   - generated SDK contract registries include the same fields

6. Runtime verification confirms the exact behavioral split between the legacy and preferred flags.
   - `markets create plan --distribution-yes-pct 77` yields `distributionYes = 770000000`, `distributionNo = 230000000`, and `initialYesProbabilityPct = 23`
   - `markets create plan --initial-yes-pct 77` yields `distributionYes = 230000000`, `distributionNo = 770000000`, and `initialYesProbabilityPct = 77`

7. MCP visibility issues after upgrade are consistent with stale session state, not a missing schema export.
   - current `pandora --output json schema` output includes `initial-yes-pct`
   - current generated contract registries include `initial-yes-pct`
   - long-lived MCP clients may need restart/reconnect to pick up the updated capabilities surface

### User-facing contract bug

The current names:

- `--distribution-yes-pct`
- `--distribution-no-pct`

sound like market probability controls, but they are actually reserve allocation controls.

That is the core bug.

## Recommended Action

Introduce a probability-native surface for AMM creation and make the reserve-weight surface explicit.

The worker should optimize for:

1. preventing future operator mistakes
2. preserving low-level reserve-weight control for advanced users
3. making the derived initial YES/NO probability visible in plan/dry-run/deploy output

## Proposed Solutions

### Option 1: Rename only

- rename ambiguous flags to something like:
  - `--yes-token-share-pct`
  - `--no-token-share-pct`
  - or `--pool-yes-weight-pct`

Pros:

- clarifies the raw control surface

Cons:

- still does not give operators the probability-native input they actually want
- likely breaks compatibility unless old flags remain aliased

### Option 2: Add probability-native flags and keep reserve-weight flags as advanced controls

- add flags like:
  - `--initial-yes-pct`
  - `--initial-no-pct`
  - or `--yes-price-pct`
- internally convert those into the inverse reserve split
- keep raw distribution flags, but document them as reserve weights

Pros:

- best user experience
- low ambiguity
- preserves advanced/operator escape hatch

Cons:

- touches parser contracts, help, docs, MCP schema, and tests

### Option 3: Keep current flags, add confirmation output only

- leave semantics unchanged
- show:
  - reserve split
  - derived initial YES probability
  - derived initial NO probability

Pros:

- smallest compatibility risk

Cons:

- still leaves the footgun in the input contract
- operators can still make the wrong assumption when scripting

## Recommended Approach

Take Option 2, plus the confirmation output from Option 3.

Specifically:

1. Add a probability-native AMM input surface:
   - preferred: `--initial-yes-pct`
   - optionally `--initial-no-pct`
2. Convert that probability to the correct inverse reserve allocation internally.
3. Keep raw reserve-weight controls available under explicit names:
   - `--yes-reserve-weight-pct`
   - `--no-reserve-weight-pct`
4. Retire `--distribution-yes-pct` / `--distribution-no-pct` with a migration error so stale scripts and MCP sessions get clear guidance instead of silent inversion risk.
5. Add a confirmation block in plan/run/deploy outputs showing:
   - `Initial YES probability`
   - `Initial NO probability`
   - `YES reserve weight`
   - `NO reserve weight`
6. Make the agent/MCP schemas prefer the probability-native flag for AMM workflows.

## Technical Areas

Likely files:

- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/parsers/markets_create_flags.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/parsers/mirror_deploy_flags.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/parsers/mirror_go_flags.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/markets_create_command_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/pandora_deploy_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_sizing_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/agent_contract_registry.cjs`
- relevant docs/help surfaces for market creation and mirror deploy/go

Potentially useful helper extraction:

- a shared utility to convert:
  - target initial YES probability -> reserve weights
  - reserve weights -> derived initial YES probability

## Acceptance Criteria

- [ ] AMM users can specify initial YES probability directly without having to manually invert reserve weights
- [ ] Raw reserve-weight controls remain available, but are named/described as reserve weights rather than price/probability
- [ ] `markets create` plan/run output shows derived initial YES/NO probability before execution
- [ ] `mirror deploy` and `mirror go` expose the same derived probability confirmation
- [ ] Help/docs/MCP schema text no longer imply that `distribution-yes-pct` is the initial YES price
- [ ] Tests cover both:
  - probability-native input -> inverse reserve allocation
  - reserve-weight input -> correct derived YES probability
- [ ] Existing low-level workflows remain either backward compatible or explicitly migrated with clear diagnostics

## Verification

- targeted parser/unit tests for:
  - `markets create`
  - `mirror deploy`
  - `mirror go`
- targeted plan/dry-run integration tests asserting derived initial YES probability in output
- direct repro:
  - desired initial YES = 77%
  - derived reserve allocation = roughly YES 23 / NO 77
  - surfaced output clearly shows that mapping

## Resources

- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/parsers/markets_create_flags.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/parsers/mirror_deploy_flags.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/parsers/mirror_go_flags.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/connectors/pandora_amm_connector.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/amm_target_pct_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_sizing_service.cjs`

## Notes

- The AMM pricing math is not the bug. The bug is that user-facing parameter names and help text imply price semantics while the implementation consumes reserve weights.
- This should be treated as a CLI/MCP contract correction, not just a docs tweak.

## Work Log

### 2026-03-16 - AMM distribution flag review and todo creation

**By:** Codex

**Actions:**

- reviewed AMM reserve-price math and distribution parsing
- confirmed that `distribution-yes-pct` maps directly to YES reserve weight
- confirmed that YES price is derived inversely from reserve share
- confirmed the same issue exists across `markets create`, `mirror deploy`, and `mirror go`
- created a worker handoff focused on probability-native AMM inputs plus explicit derived-price confirmation

**Learnings:**

- the current behavior is internally consistent but externally misleading
- the product already contains the correct inverse mapping logic in mirror sizing, so the fix should standardize around that contract

### 2026-03-17 - BUG-004 status recheck on v1.1.113

**By:** Codex

**Actions:**

- rechecked `markets create` runtime behavior on the local `1.1.113` CLI
- verified that `--distribution-yes-pct 77` still opens at roughly 23% YES because it maps to raw reserve weight
- verified that `--initial-yes-pct 77` applies the inverse mapping and opens at 77% YES
- confirmed the current parser/help/agent/schema/generated-contract surfaces already include `--initial-yes-pct`
- recorded that MCP clients may need a session restart to observe the new flag after upgrade

**Verification:**

- `node cli/pandora.cjs version`
- `node cli/pandora.cjs --output json markets create plan --question Q --rules R --sources https://a.test https://b.test --target-timestamp 1893456000 --liquidity-usdc 100 --distribution-yes-pct 77`
- `node cli/pandora.cjs --output json markets create plan --question Q --rules R --sources https://a.test https://b.test --target-timestamp 1893456000 --liquidity-usdc 100 --initial-yes-pct 77`
- `node cli/pandora.cjs --output json schema`

**Learnings:**

- BUG-004 is no longer a missing-feature problem because the probability-native workaround is shipped
- BUG-004 is still an input-contract and operator-safety problem as long as the legacy raw percent flags remain agent-facing and easy to misuse
- stale MCP visibility after upgrade is an operational session-refresh issue rather than a contract-generation gap

### 2026-03-17 - Explicit reserve-weight flag migration

**By:** Codex

**Actions:**

- retired legacy `--distribution-yes-pct` / `--distribution-no-pct` in `markets create`, `mirror deploy`, `mirror go`, and sports creation parsers
- added explicit reserve-weight replacements:
  - `--yes-reserve-weight-pct`
  - `--no-reserve-weight-pct`
- updated CLI help, MCP/agent schemas, built-in recipes, docs, and focused tests to advertise only the new reserve-weight names
- regenerated the SDK contract bundle so exported descriptors and schemas match the new flag contract

**Verification:**

- `node --test tests/unit/markets_create_flags.test.cjs`
- `node --test tests/unit/deploy_parser_decoder.test.cjs`
- `npm run generate:sdk-contracts`
- `node --test --test-name-pattern='generated SDK contract bundle stays in parity with live schema and capabilities commands|mirror deploy --help json surfaces validation-ticket caveats and reserve-weight distribution flags|command descriptors surface validation, distribution, and stop-file caveats for agent workflows|markets create --help json surfaces validation-ticket and balanced-distribution caveats' tests/cli/cli.integration.test.cjs`
- `npm run typecheck`
- `node cli/pandora.cjs --output json markets create plan --question Q --rules R --sources https://a.test https://b.test --target-timestamp 1893456000 --liquidity-usdc 100 --distribution-yes-pct 77`
- `node cli/pandora.cjs --output json markets create plan --question Q --rules R --sources https://a.test https://b.test --target-timestamp 1893456000 --liquidity-usdc 100 --initial-yes-pct 77`
- `node cli/pandora.cjs --output json markets create plan --question Q --rules R --sources https://a.test https://b.test --target-timestamp 1893456000 --liquidity-usdc 100 --yes-reserve-weight-pct 77`

**Learnings:**

- documenting the inverse AMM math was not enough; the ambiguous legacy percent flags had to be retired to make the agent/MCP contract safe by default
- explicit reserve-weight naming preserves low-level control without implying price semantics
