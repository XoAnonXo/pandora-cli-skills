---
name: pandora-cli-skills
summary: Index and operator guide for Pandora CLI capabilities, mirror operations, and agent-native interfaces.
version: 1.1.73
---

# Pandora CLI & Skills

Production CLI for Pandora prediction markets with mirror tooling, sports consensus, on-chain trading, analytics, and agent-native interfaces.

## Use this file as the doc router
Start here, then open the smallest scoped doc that matches the task:

- [`docs/skills/capabilities.md`](./docs/skills/capabilities.md)
  - command families, canonical paths, use-case routing, and PollCategory mapping
- [`docs/skills/agent-quickstart.md`](./docs/skills/agent-quickstart.md)
  - smallest safe bootstrap for agents using local CLI, stdio MCP, remote MCP HTTP, or SDK consumers
- [`docs/skills/command-reference.md`](./docs/skills/command-reference.md)
  - human-oriented command and flag reference, sports matrix, mirror subcommands, and quant/model detail; use capabilities/schema for machine authority
- [`docs/skills/trading-workflows.md`](./docs/skills/trading-workflows.md)
  - canonical discover -> quote -> buy/sell -> claim flows, plus arbitrage routing
- [`docs/skills/portfolio-closeout.md`](./docs/skills/portfolio-closeout.md)
  - portfolio inspection, history/export, LP exits, claim-all, operations, and mirror closeout
- [`docs/skills/mirror-operations.md`](./docs/skills/mirror-operations.md)
  - mirror timing, validation, independent-source rules, deploy/go workflow, sync close-window guards, live diagnostics, daemon health, and closeout guidance
- [`docs/skills/agent-interfaces.md`](./docs/skills/agent-interfaces.md)
  - schema, MCP, JSON envelopes, recovery hints, fork runtime, streams, and error codes
- [`docs/skills/policy-profiles.md`](./docs/skills/policy-profiles.md)
  - policy packs, signer profiles, gateway scopes, and preferred secret-handling guidance
- [`docs/skills/recipes.md`](./docs/skills/recipes.md)
  - reusable safe workflows that compile to ordinary Pandora commands with policy/profile validation
- [`docs/benchmarks/README.md`](./docs/benchmarks/README.md)
  - benchmark harness overview, release-gate role, and agent-readiness framing
- [`docs/benchmarks/scenario-catalog.md`](./docs/benchmarks/scenario-catalog.md)
  - scenario-by-scenario benchmark coverage and parity groups
- [`docs/benchmarks/scorecard.md`](./docs/benchmarks/scorecard.md)
  - weighted scoring, parity failures, and interpretation of benchmark output
- [`docs/skills/legacy-launchers.md`](./docs/skills/legacy-launchers.md)
  - `launch` / `clone-bet` legacy script wrappers and how they differ from mirror flows
- [`docs/trust/release-verification.md`](./docs/trust/release-verification.md)
  - release verification flow for checksums, provenance attestations, SBOM, and cosign signatures
- [`docs/trust/release-bundle-playbook.md`](./docs/trust/release-bundle-playbook.md)
  - one-tag maintainer flow that republishes the CLI, standalone SDKs, benchmark bundle, and trust assets together
- [`docs/trust/security-model.md`](./docs/trust/security-model.md)
  - trust boundaries, mutation controls, secret handling, and release posture
- [`docs/trust/support-matrix.md`](./docs/trust/support-matrix.md)
  - support guarantees and limits for local CLI, MCP transports, SDKs, benchmarks, and packaged docs

## Critical safety rules
- `mirror plan|deploy|go` do **not** assume a generic `+1h` close buffer. They use a sports-aware suggested `targetTimestamp`; use `--target-timestamp <unix|iso>` only when intentionally overriding that suggestion.
- `mirror deploy|go` require at least **2 independent public resolution URLs from different hosts** in `--sources`.
- Polymarket / Gamma / CLOB URLs are discovery inputs only and are **not** valid `--sources`.
- Validation is payload-exact. Run `pandora --output json agent market validate ...` on the final `question`, `rules`, `sources`, and `targetTimestamp` before agent-controlled execute mode.
- CLI mirror execute reruns use `--validation-ticket <ticket>`. MCP execute/live reruns use `agentPreflight = { validationTicket, validationDecision: "PASS", validationSummary }`.
- `sports create run` does not expose a CLI `--validation-ticket`; agent-controlled execute uses `agentPreflight` / `PANDORA_AGENT_PREFLIGHT`.
- `launch` / `clone-bet` still expose `--target-timestamp-offset-hours`; that legacy script flag is **not** the mirror timing model.
- For live Polymarket hedges, `POLYMARKET_FUNDER` / `--funder` must point at the proxy wallet (Gnosis Safe) that holds Polygon USDC.e collateral, not the signer EOA.
- Use `pandora polymarket balance|deposit|withdraw` for proxy funding and balance inspection instead of ad hoc transfer scripts. `withdraw --execute` only works when the signer controls the source wallet; Safe/proxy-originated transfers normally require manual execution from the proxy wallet.
- Treat `pandora mirror status --with-live` as an operator dashboard. `netPnlApproxUsdc`, `pnlApprox`, and `pnlScenarios` are scenario or mark-to-market approximations, not realized ledger accounting.
- `pandora resolve --watch` is the current finalization wait path; `mirror close` does not auto-resolve for you.
- Prefer policy-scoped MCP access and the shipped read-only policy/profile artifacts over raw `--private-key` when operating live flows. Policy packs and named profiles are now shipped in alpha via `policy` / `profile`. Profile-directed execution already covers the highest-value signer-bearing paths:
  - `trade`, `sell`, `lp add`, `lp remove`, `resolve`, `claim`
  - `mirror deploy`, `mirror go`, `mirror sync once|run|start`
  - `sports create run`
  - `mirror deploy`, `mirror go`, `mirror sync once|run|start`
  - sports live execution paths routed through the shared sports command/parser stack
- Profile support is still not universal across every mutating family, so use `capabilities` / `schema` as the authority for the current command-level surface.
- Do not collapse signer readiness into one “pending” bucket. Use `capabilities.data.policyProfiles.signerProfiles.statusAxes` plus:
  - implementation fields: `implementedBackends`, `placeholderBackends`
  - runtime fields: `readyBuiltinIds`, `degradedBuiltinIds`, `placeholderBuiltinIds`, `pendingBuiltinIds`
  - backend rollup: `backendStatuses`
  - today, all shipped signer backends are implemented: `read-only`, `local-env`, `local-keystore`, `external-signer`
  - in the default runtime view, `market_observer_ro` is the only built-in profile reporting `ready`, and it is read-only
  - `--runtime-local-readiness` actively probes local signer/network prerequisites and can promote built-in mutable profiles such as `prod_trader_a`, `dev_keystore_operator`, and `desk_signer_service` to `ready` when their runtime requirements are satisfied
  - in the current runtime, no built-in mutable profile is ready
  - current built-in mutable profile states are:
    - `prod_trader_a`: backend rollup `degraded`, per-profile `resolutionStatus` `missing-secrets`
    - `dev_keystore_operator`: backend rollup `degraded`, per-profile `resolutionStatus` `missing-keystore`
    - `desk_signer_service`: backend rollup `degraded`, per-profile `resolutionStatus` `missing-context`
  - `degraded` means the backend is implemented, but the current process is still missing signer material, keystore access, external-signer context, network context, or other compatibility prerequisites
  - use `bootstrap` for machine-usable policy/profile recommendations:
    - `defaults.policyId` / `defaults.profileId`
    - `policyProfiles.policyPacks.recommendedReadOnlyPolicyId` / `recommendedMutablePolicyId`
    - `policyProfiles.signerProfiles.recommendedReadOnlyProfileId` / `recommendedMutableProfileId`
    - `nextSteps[]`
  - `bootstrap` returns canonical tools by default
  - use `--include-compatibility` or remote `include_aliases=1` only for legacy/debug workflows or migration diffing
  - use standalone exact-context commands when needed:
    - `policy explain --id <policy-id> --command <tool> --mode <mode> --chain-id <id> --category <id|name> [--profile-id <id>]`
    - `policy recommend --command <tool> --mode <mode> --chain-id <id> --category <id|name> [--profile-id <id>]`
    - `profile recommend --command <tool> --mode <mode> --chain-id <id> --category <id|name> [--policy-id <id>]`
  - use `profile list` for the compact readiness view and `profile explain --id <profile-id> [--command <tool>] [--mode <mode>] [--policy-id <id>] [--chain-id <id>] [--category <id|name>]` when you need the exact go/no-go answer via `requestedContext`, `usable`, `readiness`, `compatibility`, `remediation`, and `blockers`

## Capability routing
- Machine-first discovery:
  - run `pandora --output json bootstrap` for the canonical first-call summary
  - run `pandora --output json capabilities` for the compact runtime digest
  - run `pandora --output json schema` for the full contract surface
  - run `pandora --output json policy list` to inspect shipped policy packs
  - run `pandora --output json profile list` to inspect shipped profiles, `runtimeReady`, `resolutionStatus`, and backend readiness metadata
  - keep bootstrap/capabilities/schema planning on canonical tool names by default
  - opt into compatibility aliases only for legacy/debug workflows; do not promote alias names back into normal agent routing
  - use `bootstrap` first for defaults; use `policy explain`, `policy recommend`, and `profile recommend` only when you already know the exact command/mode/chain/category path you want evaluated
  - run `pandora --output json profile explain --id <profile-id> [--command <tool>] [--mode <mode>] [--policy-id <id>] [--chain-id <id>] [--category <id|name>]` before mutable execution to inspect `explanation.requestedContext`, `explanation.usable`, `explanation.readiness`, `explanation.compatibility`, `explanation.remediation`, and `explanation.blockers`
  - use `capabilities.data.policyProfiles.signerProfiles.backendStatuses` when you need the compact backend-level split between `implemented` / `placeholder` and `ready` / `degraded`
  - when exposing Pandora to external agents, start with `bootstrap`, then `schema`, then intentionally host `pandora mcp http --auth-scopes ...`, then provision signing secrets only on that runtime if a selected tool actually requires them
- in a repository checkout, use `npm run generate:sdk-contracts` when regenerating the shared JS export in `sdk/generated` plus the standalone SDK-local generated copies in `sdk/typescript/generated` and `sdk/python/pandora_agent/generated`
- SDK alpha source/artifact surfaces are already shipped in this build under `sdk/typescript`, `sdk/python`, and `sdk/generated`
- in the published root package, the shared JSON contract bundle lives once under `sdk/generated`; the embedded TypeScript/Python SDK loaders keep their own manifests and route heavy generated artifacts to the shared bundle
  - run `pandora mcp http ...` only when intentionally hosting the remote HTTP MCP gateway for external agents
- Discovery, scanning, and market lookup:
  - open [`docs/skills/capabilities.md`](./docs/skills/capabilities.md)
- First-time agent bootstrap:
  - open [`docs/skills/agent-quickstart.md`](./docs/skills/agent-quickstart.md)
- Exact flags for a command family:
  - open [`docs/skills/command-reference.md`](./docs/skills/command-reference.md)
- Buy/sell/claim/arbitrage workflows:
  - open [`docs/skills/trading-workflows.md`](./docs/skills/trading-workflows.md)
- Portfolio inspection, LP exits, and closeout:
  - open [`docs/skills/portfolio-closeout.md`](./docs/skills/portfolio-closeout.md)
- Mirror deployment, verification, sync, or closeout:
  - open [`docs/skills/mirror-operations.md`](./docs/skills/mirror-operations.md)
- Agent, MCP, schema, JSON output, or recovery contracts:
  - open [`docs/skills/agent-interfaces.md`](./docs/skills/agent-interfaces.md)
  - use it for policy scope behavior, gateway auth guidance, and signer-profile status
- Policy packs, signer profiles, or gateway scope design:
  - open [`docs/skills/policy-profiles.md`](./docs/skills/policy-profiles.md)
- Reusable workflows and safe recipe execution:
  - open [`docs/skills/recipes.md`](./docs/skills/recipes.md)
- Benchmark methodology, scenarios, or scorecards:
  - open [`docs/benchmarks/README.md`](./docs/benchmarks/README.md)
  - then [`docs/benchmarks/scenario-catalog.md`](./docs/benchmarks/scenario-catalog.md) or [`docs/benchmarks/scorecard.md`](./docs/benchmarks/scorecard.md) as needed
- Release verification, support matrix, or security posture:
  - open [`docs/trust/release-verification.md`](./docs/trust/release-verification.md)
  - then [`docs/trust/support-matrix.md`](./docs/trust/support-matrix.md) or [`docs/trust/security-model.md`](./docs/trust/security-model.md) as needed
- Manual market launcher scripts:
  - open [`docs/skills/legacy-launchers.md`](./docs/skills/legacy-launchers.md)

## Canonical command paths
- Discovery:
  - `pandora scan` is the canonical enriched discovery path.
  - `pandora markets scan` remains a backward-compatible alias for legacy/debug workflows.
  - `pandora markets list|get` are the raw indexer browse surfaces.
- Trading:
  - `pandora quote` is the canonical read-only pricing path.
  - `pandora trade` is buy-side execution.
  - `pandora sell` is the explicit sell-side execution path.
  - `pandora claim` is the canonical redeem path.
- Arbitrage:
  - `pandora arb scan` is the canonical arbitrage scan path.
  - `pandora arbitrage` remains the bounded one-shot wrapper for legacy/debug workflows.
- Mirror:
  - `pandora mirror browse|plan|deploy|verify|lp-explain|hedge-calc|simulate|go|sync|status|close`
- Agent-native:
  - `pandora --output json bootstrap`
  - preferred first call for cold agents; canonical tools only by default
  - `pandora --output json capabilities`
  - `pandora --output json schema`
  - `pandora --output json policy list|get|lint`
  - `pandora --output json profile list|get|explain|recommend|validate`
  - `pandora --output json recipe list|get|validate|run`
    - use `capabilities` for compact discovery/routing and `schema` for authoritative contract export when generating client types
    - for embedded SDK consumers, load the SDK-local manifest entrypoints first rather than assuming every language reads directly from `sdk/generated`
    - `pandora mcp`
    - `pandora mcp http ...` only for remote gateway hosting, not routine discovery
    - `pandora operations get|list|receipt|verify-receipt|cancel|close`

## PollCategory enum
Use this mapping anywhere a deploy-style flow explicitly exposes `--category`:

- `Politics=0`
- `Sports=1`
- `Finance=2`
- `Crypto=3`
- `Culture=4`
- `Technology=5`
- `Science=6`
- `Entertainment=7`
- `Health=8`
- `Environment=9`
- `Other=10`

Notes:
- Mirror `deploy|go` accept `--category <id|name>`.
- Read-only poll filters are documented with numeric category ids.
- For sports mirror flows, use `Sports` or `1`.

## Minimal setup
```bash
npm install
npm run init-env
npm run doctor
npm run build
```

Node.js `>=18` required.

## Primary references
- Full package/operator overview: [`README.md`](./README.md)
- Sanitized shareable setup guide: [`README_FOR_SHARING.md`](./README_FOR_SHARING.md)
- Contract addresses and protocol reference: [`references/contracts.md`](./references/contracts.md)
