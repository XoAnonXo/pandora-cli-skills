---
status: complete
priority: p2
issue_id: "133"
tags: [mirror, flashbots, private-routing, execution, mev]
dependencies: ["118"]
---

# Add Flashbots private routing

## Problem Statement

The sync engine now knows how to size a single on-chain Pandora rebalance more accurately, but it still submits the Ethereum leg through ordinary public execution paths. That leaves the trade visible to the public mempool and falls short of the private-routing workflow we discussed for atomic rebalance execution.

## Findings

- [`cli/lib/mirror_sync/execution.cjs`](../cli/lib/mirror_sync/execution.cjs) delegates the live rebalance through the injected rebalance function and records ordinary transaction hashes/nonces; there is no route abstraction for private relays.
- [`cli/lib/mirror_sync/rebalance_trade.cjs`](../cli/lib/mirror_sync/rebalance_trade.cjs) is the natural integration seam for route selection around approvals and trade submission.
- [`docs/skills/mirror-operations.md`](../docs/skills/mirror-operations.md) is explicit that `mirror sync` still runs separate Pandora and Polymarket legs and is not atomic across venues.
- Flashbots documents two Ethereum mainnet relay endpoints: `rpc.flashbots.net` for wallet-style use and `relay.flashbots.net` for advanced apps. It recommends `eth_sendPrivateTransaction` for single transactions and `eth_sendBundle` or `mev_sendBundle` for bundles. Sources: [Sending Tx and Bundles](https://docs.flashbots.net/guide-send-tx-bundle), [Flashbots JSON-RPC endpoints](https://docs.flashbots.net/flashbots-auction/advanced/rpc-endpoint), [Flashbots Protect quick start](https://docs.flashbots.net/flashbots-protect/quick-start)
- Flashbots is Ethereum-focused. It can protect the Pandora leg, but it cannot make the Polygon hedge leg part of one cross-chain atomic settlement.

## Proposed Solutions

### Option 1: Add an execution-route abstraction with private tx and bundle support

**Approach:** Introduce `public`, `flashbots-private`, `flashbots-bundle`, and `auto` execution modes for the Pandora leg. Use a private tx when no approval is needed, and a bundle when approval plus trade must land together.

**Pros:**
- Correctly models the actual execution choices
- Avoids pretending the feature is simpler than it is
- Gives operators explicit control over fallback behavior

**Cons:**
- New relay/auth configuration and simulation paths
- More complex error handling and receipt recording

**Effort:** 2-3 days

**Risk:** Medium

### Option 2: Private transaction only

**Approach:** Route only the final trade transaction privately and require approvals to be pre-configured.

**Pros:**
- Smaller initial scope

**Cons:**
- Fails on approval-required paths
- Encourages hidden preconditions instead of clear runtime behavior

**Effort:** 1 day

**Risk:** Medium

### Option 3: Leave Flashbots outside the CLI as an external wrapper

**Approach:** Keep private routing in custom scripts.

**Pros:**
- No product-surface change

**Cons:**
- Preserves the exact operator gap we are trying to close
- Hard to audit or support

**Effort:** 0.5 day

**Risk:** High

## Recommended Action

Use Option 1.

Add a Pandora-leg execution-route abstraction with explicit Flashbots relay support on Ethereum mainnet. Scope the feature honestly: it protects the Ethereum rebalance leg and can bundle approval plus trade, but it does not make the Polygon hedge leg cross-chain atomic. Fail closed on unsupported chains unless the operator explicitly selects public fallback.

## Technical Details

**Likely files:**
- [`cli/lib/flashbots_service.cjs`](../cli/lib/flashbots_service.cjs)
- [`cli/lib/trade_execution_route_service.cjs`](../cli/lib/trade_execution_route_service.cjs)
- [`cli/pandora.cjs`](../cli/pandora.cjs)
- [`cli/lib/mirror_sync/execution.cjs`](../cli/lib/mirror_sync/execution.cjs)
- [`cli/lib/mirror_sync/rebalance_trade.cjs`](../cli/lib/mirror_sync/rebalance_trade.cjs)
- [`cli/lib/mirror_handlers/sync.cjs`](../cli/lib/mirror_handlers/sync.cjs)
- [`cli/lib/mirror_handlers/go.cjs`](../cli/lib/mirror_handlers/go.cjs)
- [`cli/lib/parsers/mirror_go_flags.cjs`](../cli/lib/parsers/mirror_go_flags.cjs)
- [`cli/lib/parsers/mirror_sync_flags.cjs`](../cli/lib/parsers/mirror_sync_flags.cjs)
- [`cli/lib/mirror_command_service.cjs`](../cli/lib/mirror_command_service.cjs)
- [`cli/lib/agent_contract_registry.cjs`](../cli/lib/agent_contract_registry.cjs)
- [`docs/skills/mirror-operations.md`](../docs/skills/mirror-operations.md)
- [`docs/skills/command-reference.md`](../docs/skills/command-reference.md)
- [`tests/unit/flashbots_service.test.cjs`](../tests/unit/flashbots_service.test.cjs)
- [`tests/unit/trade_execution_route_service.test.cjs`](../tests/unit/trade_execution_route_service.test.cjs)
- [`tests/unit/mirror_sync_execution.test.cjs`](../tests/unit/mirror_sync_execution.test.cjs)
- [`tests/unit/mutator_operation_hooks.test.cjs`](../tests/unit/mutator_operation_hooks.test.cjs)
- [`tests/unit/mirror_go_regressions.test.cjs`](../tests/unit/mirror_go_regressions.test.cjs)
- [`tests/cli/cli.integration.test.cjs`](../tests/cli/cli.integration.test.cjs)

**Implementation notes:**
- Add route-level config such as relay URL, auth key, builder list, block targeting, and fallback policy
- Support bundle simulation before submission when approval plus trade are both required
- Record relay route, bundle hash, targeted block, and fallback reason in audit entries and receipts
- Keep policy/profile guidance explicit so live execution surfaces explain new network requirements

## Resources

- Flashbots guide: [https://docs.flashbots.net/guide-send-tx-bundle](https://docs.flashbots.net/guide-send-tx-bundle)
- Flashbots JSON-RPC endpoints: [https://docs.flashbots.net/flashbots-auction/advanced/rpc-endpoint](https://docs.flashbots.net/flashbots-auction/advanced/rpc-endpoint)
- Flashbots Protect quick start: [https://docs.flashbots.net/flashbots-protect/quick-start](https://docs.flashbots.net/flashbots-protect/quick-start)

## Acceptance Criteria

- [x] Live mirror sync can select a private execution route for the Pandora leg
- [x] The runtime uses private tx submission for single-tx paths and bundle submission when approval plus trade must land together
- [x] Unsupported chain or relay scenarios return explicit errors or operator-chosen fallback behavior
- [x] Audit entries and receipts include route provenance, targeted block, relay response IDs, and fallback reasons
- [x] Docs explicitly state that Flashbots protects the Ethereum leg only and does not make the Polygon hedge leg atomic
- [x] Unit and CLI tests cover relay success, relay rejection, bundle simulation failure, and configured fallback paths

## Work Log

### 2026-03-09 - Initial research

**By:** Codex

**Actions:**
- Reviewed current live mirror execution seams and where route abstraction would fit
- Verified the current docs still describe separate-leg execution semantics
- Checked current Flashbots docs for relay endpoints and method selection guidance

**Learnings:**
- This issue is important, but it is not the next foundation item; correctness and accounting primitives still come first
- The product must describe this as private routing for the Ethereum leg, not "cross-chain atomic execution"

### 2026-03-09 - Implementation, audit fixes, and verification

**By:** Codex

**Actions:**
- Added a Flashbots relay client and a trade-route abstraction for `public`, `auto`, `flashbots-private`, and `flashbots-bundle`
- Integrated private routing into Pandora trade execution and preserved route provenance through sync receipts, operation hooks, and audit payloads
- Added CLI/parser/help/contract/docs support for route selection, fallback behavior, relay configuration, and operator guidance
- Ran a six-agent audit pass and fixed the issues it surfaced around raw-signature auth, post-submit fallback suppression, suggested-command fidelity, multi-action operation summaries, and parser validation

**Verification:**
- `node --test tests/unit/flashbots_service.test.cjs tests/unit/trade_execution_route_service.test.cjs tests/unit/mirror_sync_execution.test.cjs tests/unit/mutator_operation_hooks.test.cjs tests/unit/mirror_go_regressions.test.cjs tests/unit/agent_contract_registry.test.cjs tests/unit/sdk_contract_service.test.cjs tests/unit/docs_skills_drift.test.cjs`
- `node --test --test-name-pattern "mirror sync rejects invalid rebalance route enums using flashbots naming contract|mirror command dispatcher preserves normalized live sync trade execution payloads including flashbots routing contract|mirror sync --help json includes live hedge environment requirements|mirror go --help json includes flashbots routing flag contract|command descriptors expose flashbots routing flags for mirror go and sync surfaces" tests/cli/cli.integration.test.cjs`

**Learnings:**
- Suggested follow-up commands must preserve hedge and routing intent exactly or operators will paste themselves back onto the public path
- Operation summaries cannot assume the last sync tick is the meaningful one; they need to preserve the last real rebalance provenance across multi-action runs
