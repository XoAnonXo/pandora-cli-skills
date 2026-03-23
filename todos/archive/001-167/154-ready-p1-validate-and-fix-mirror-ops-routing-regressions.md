---
status: ready
priority: p1
issue_id: "154"
tags: [mirror, daemon, flashbots, tx-routing, polymarket, docs, operations]
dependencies: []
---

# Validate and fix mirror ops and routing regressions

Recent operator feedback surfaced a cluster of mirror daemon, Flashbots, and Polymarket integration problems. Some of these are confirmed by current code and focused tests. Others are real UX mismatches or operational hazards. A few remain unproven locally and need live reproduction before they should be treated as product bugs.

This todo separates those categories and gives the worker a concrete burndown instead of forwarding an anecdotal bug list as-is.

## Problem Statement

Operators reported the following issues during live Chelsea / Arsenal mirror workflows:

- recurring tx drops during deploy and daemon rebalance approval
- Flashbots routes failing in multiple ways
- `--no-hedge` being the wrong default for some operator flows
- Polymarket Gamma sports search returning unrelated results
- mirror daemon CLI/docs mismatches around `--source`, `--stream`, and required risk flags
- `@ethersproject/wallet` disappearing after npm upgrades and breaking Poly preflight
- `viemRuntime.keccak256` failures on auto route
- pending-action locks requiring manual state surgery after timeouts

These reports are high impact, but they are not all the same class of issue:

- some are real runtime defects
- some are documented-but-surprising defaults
- some are docs/help mismatches
- some need live repro and telemetry before we can reliably fix them

## Findings

### Confirmed in code and/or focused tests

1. Flashbots private routing cannot include approval transactions by design.
   - `trade_execution_route_service.cjs` explicitly throws `FLASHBOTS_BUNDLE_REQUIRED` when `flashbots-private` is used and `needsApproval=true`.
   - This matches the operator report and needs clearer UX / route guidance.

2. `viemRuntime.keccak256` failure is a real Flashbots runtime guard path.
   - `flashbots_service.cjs` throws `FLASHBOTS_VIEM_RUNTIME_INVALID` when `viemRuntime.keccak256` or `stringToHex` is missing.
   - This supports the previously reported BUG-002 class of failure.

3. Pending-action lock recovery is currently fail-closed across both file lock and persisted state.
   - `mirror_sync/execution.cjs` blocks execution on:
     - pending-action lock file
     - `state.lastExecution.requiresManualReview`
     - persisted pending-action state
   - `mirror_sync/state.cjs` documents that unlock only removes the persisted lock file and does not settle or rewrite runtime state.
   - This matches the operator complaint that deleting the lock file alone is insufficient.

4. `--stream` is restricted in JSON mode.
   - `mirror_handlers/sync.cjs` blocks JSON streaming unless `PANDORA_DAEMON_LOG_JSONL=1`.
   - The current UX is inconsistent with a naive expectation that `--stream --output json` should work directly.

5. Mirror daemon surfaces do not support `--source`.
   - `mirror go` / `mirror sync` use explicit market selectors and route settings, not a `--source` flag.
   - Existing docs/help around mirror flows can still imply a `--source` mental model because `mirror plan` uses source-oriented language.

6. Live mirror flows require companion risk flags.
   - `mirror_go_flags.cjs` and `mirror_sync_flags.cjs` require `--max-open-exposure-usdc` and `--max-trades-per-day` in live execution mode.
   - Focused tests already cover this contract.
   - `docs/skills/command-reference.md` documents this requirement, so the remaining gap is likely CLI/help visibility, not total lack of documentation.

7. Hedging is enabled by default.
   - `mirror_sync_flags.cjs` defaults `hedgeEnabled: true`.
   - `mirror_go_flags.cjs` defaults `noHedge: false`, and `mirror_handlers/go.cjs` converts that to `hedgeEnabled: !options.noHedge`.
   - This means the reported capital-spend surprise is plausible, but it is a default/operator-safety issue, not a parser bug.

8. Polymarket runtime depends on `@ethersproject/wallet` at execution time.
   - `polymarket_ops_service.cjs` and `polymarket_trade_adapter.cjs` dynamically require `@ethersproject/wallet`.
   - If package upgrades or global installs omit or wipe that dependency, Poly preflight can break exactly as reported.

9. `auto` route fallback to public exists in the core route service, but only when explicitly configured.
   - `trade_execution_route_service.cjs` supports public fallback only when `executionRouteFallback === 'public'`.
   - Parser defaults for mirror and deploy-related flows use `fail`, not `public`.
   - So “auto hits 403 and does not fallback” is not universally a bug; it is at least partly explained by current defaults.

### Not fully validated locally and still need live repro

1. Recurring tx drops from mempool during Chelsea deploy and first daemon approval.
   - The exact pattern of “five drops, sixth landed” and the cited tx hash were not reproducible in local tests.
   - This needs live telemetry capture across provider, nonce, RPC route, and submission mode.

2. Flashbots bundle 403 and deploy/mirror `auto` route failure in the exact reported setup.
   - Core code supports public fallback when configured.
   - We still need to validate whether the deploy and daemon callers pass the intended fallback config, and whether relay 403s are treated as pre-submission failures in all paths.

3. Polymarket Gamma sports search quality problems.
   - Code clearly supports direct slug lookup and Gamma/event-based browsing.
   - The reported “Arsenal / Chelsea / EPL / soccer returns unrelated results” issue may be upstream relevance quality or our query strategy, but it was not reproduced in this pass.

### Likely docs or product-positioning mismatches

1. Operators can reasonably infer that `--stream` should work with JSON.
2. Operators can reasonably infer that mirror daemon commands share the same source selector vocabulary as planning commands.
3. Operators may not realize that hedging is on by default and can consume capital unless `--no-hedge` is set.
4. Operators may not realize that `auto` does not imply public fallback unless the fallback flag is also set to `public`.

## Proposed Solutions

### Option 1: Narrow bugfix-only pass

Focus only on confirmed code/runtime defects:

- improve pending-action unlock / recovery flow
- harden Flashbots runtime dependency checks
- make route/fallback behavior clearer in error output
- stabilize Polymarket dependency loading

Pros:

- fastest path to shipping concrete fixes
- minimal product-surface changes

Cons:

- leaves docs/UX traps in place
- does not address live-repro gaps

### Option 2: Operational hardening pass

Treat this as one operator-safety slice:

- fix confirmed runtime issues
- add clearer CLI/help text and docs
- add recovery commands / guidance for stuck daemon state
- make route and hedge defaults more explicit
- capture telemetry for live tx-drop and Gamma search issues

Pros:

- best operator experience improvement
- reduces repeat incidents
- gives clearer agent/operator guidance

Cons:

- broader scope
- needs coordination across code, docs, and tests

### Option 3: Split into runtime vs live-ops investigation tracks

Create one implementation track and one evidence-gathering track:

- Track A: fix code/docs issues we have already confirmed
- Track B: reproduce tx-drop / Gamma search / relay 403 failures with logs and fixtures

Pros:

- cleanly separates known bugs from unproven field reports
- avoids speculative fixes

Cons:

- requires two follow-up efforts
- some user pain remains until Track B lands

## Recommended Action

Take Option 3.

Do the work in this order:

1. Fix the confirmed operator-facing issues first:
   - pending-action unlock/manual-review recovery ergonomics
   - Flashbots route error messaging and fallback guidance
   - `@ethersproject/wallet` dependency hardening
   - mirror daemon help/docs mismatches around `--stream`, `--source`, and required live risk flags
   - explicit warning/help text that hedging is enabled by default

2. Add regression coverage around the confirmed contract points:
   - public fallback only when explicitly enabled
   - JSON stream restriction behavior
   - stuck lock + manual review recovery path
   - dependency sanity for Polymarket wallet adapter loading

3. Add a separate live-repro / telemetry capture plan for:
   - mempool drop investigations
   - Flashbots relay 403 behavior by route and caller path
   - Gamma sports search relevance

Do not mark the tx-drop and Gamma-search items as fixed until they are reproduced or falsified with captured evidence.

## Technical Details

Likely affected files:

- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/trade_execution_route_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/flashbots_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/pandora_deploy_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_handlers/go.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_handlers/sync.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_sync/execution.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_sync/state.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_sync/rebalance_trade.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/polymarket_ops_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/polymarket_trade_adapter.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/parsers/mirror_go_flags.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/parsers/mirror_sync_flags.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/docs/skills/mirror-operations.md`
- `/Users/mac/Desktop/pandora-market-setup-shareable/docs/skills/command-reference.md`

## Acceptance Criteria

- [ ] Pending-action recovery no longer requires manual JSON surgery for the common timeout/manual-review case, or the CLI provides a supported recovery command with clear guardrails
- [ ] Flashbots route failures clearly explain:
  - approval incompatibility with `flashbots-private`
  - when `auto` will or will not fall back to public
  - what relay/auth configuration is missing or rejected
- [ ] Mirror daemon docs/help make it explicit that:
  - `--stream` JSON behavior is restricted
  - `--source` is not a daemon flag
  - live mode requires `--max-open-exposure-usdc` and `--max-trades-per-day`
- [ ] Mirror daemon surfaces clearly warn that hedging is enabled by default unless `--no-hedge` is set
- [ ] Polymarket dependency loading is stable across install/upgrade flows, or preflight produces an actionable remediation instead of obscure runtime failure
- [ ] Regression tests cover the confirmed route/fallback and recovery contracts
- [ ] A separate reproduction note or telemetry checklist exists for tx-drop, relay-403, and Gamma sports-search investigations

## Verification

- `node --test tests/unit/trade_execution_route_service.test.cjs tests/unit/mirror_go_regressions.test.cjs`
- `node --test --test-name-pattern='mirror status surfaces unreadable pending-action locks as blocked runtime state|mirror sync unlock clears zombie pending-action locks by state-file' tests/cli/cli.integration.test.cjs`
- `node cli/pandora.cjs --output json mirror sync run --help`
- `node cli/pandora.cjs --output json mirror go --help`
- `node cli/pandora.cjs --output json mirror sync once --help`
- `npm run check:docs`

## Resources

- Operator report collected on 2026-03-14 covering Chelsea deploy and daemon failures
- Existing focused tests:
  - `/Users/mac/Desktop/pandora-market-setup-shareable/tests/unit/trade_execution_route_service.test.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/tests/unit/mirror_go_regressions.test.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/tests/cli/cli.integration.test.cjs`

## Work Log

### 2026-03-14 - Validation and triage

**By:** Codex

**Actions:**

- reviewed route, Flashbots, mirror daemon, Polymarket, and docs surfaces
- validated focused route and mirror regression tests
- classified the incoming report into confirmed defects, UX/docs mismatches, and live-repro-needed claims
- confirmed that hedge is enabled by default and that public fallback is opt-in rather than default

**Commands run:**

- `node --test tests/unit/trade_execution_route_service.test.cjs tests/unit/mirror_go_regressions.test.cjs`
- `node --test --test-name-pattern='mirror status surfaces unreadable pending-action locks as blocked runtime state|mirror sync unlock clears zombie pending-action locks by state-file' tests/cli/cli.integration.test.cjs`

**Learnings:**

- the strongest confirmed issues are recovery ergonomics, route messaging, and dependency brittleness
- the tx-drop and Gamma-search complaints are plausible but still need live evidence before they should be treated as fixed-scope bugs
- some operator pain came from defaults and flag contracts that are technically implemented but not obvious enough in CLI/help/docs

### 2026-03-14 - Operator hardening fixes

**By:** Codex

**Actions:**

- added fail-closed Flashbots fallback guidance to the shared route service
- taught `mirror sync unlock` to clear the matching persisted manual-review blocker when operators intentionally override the lock
- expanded mirror `go` / `sync` help and docs to call out `--source`, `--stream`, risk-cap, fallback, and default-hedging contracts explicitly
- hardened the Polymarket wallet-loader failure path with an actionable remediation message
- added a separate live-repro checklist for tx-drop, relay-403, and Gamma-search investigations

**Commands run:**

- `node --test tests/unit/trade_execution_route_service.test.cjs tests/unit/polymarket_ops_service.test.cjs tests/unit/mirror_go_regressions.test.cjs`
- `node --test --test-name-pattern='mirror sync --help json includes live hedge environment requirements|mirror go --help json includes flashbots routing flag contract|mirror sync unlock requires force for reconciliation-required locks' tests/cli/cli.integration.test.cjs`
- `npm run check:docs`

**Learnings:**

- the main operator gap was not just runtime logic; help and recovery affordances were too implicit for live use
- forced unlock needs to clear both the lock file and the matching persisted blocker state to be operationally complete
