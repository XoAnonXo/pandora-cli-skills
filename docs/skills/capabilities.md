# Pandora CLI Capabilities

This document maps the CLI to operator use cases. Use it to decide which command family to reach for before opening the full command reference.

For machine-first discovery, start with:
- `pandora --output json bootstrap`
- `pandora --output json capabilities`
- `pandora --output json schema`
- `pandora --output json policy list`
- `pandora --output json profile list`
- `pandora mcp`

Use `pandora mcp http` only when you intentionally want to host the remote streamable HTTP gateway for external agents.

## Small-doc routing

Use the smallest scoped doc that matches the task:
- external agent bootstrap:
  - [`agent-quickstart.md`](./agent-quickstart.md)
- JSON/MCP/runtime contract details:
  - [`agent-interfaces.md`](./agent-interfaces.md)
- buy/sell/claim/arbitrage workflow:
  - [`trading-workflows.md`](./trading-workflows.md)
- portfolio, LP exit, claim-all, and closeout:
  - [`portfolio-closeout.md`](./portfolio-closeout.md)
- mirror deploy/sync/close:
  - [`mirror-operations.md`](./mirror-operations.md)
- policy packs, signer profiles, and gateway scopes:
  - [`policy-profiles.md`](./policy-profiles.md)
- release verification, support guarantees, and security posture:
  - [`../trust/release-verification.md`](../trust/release-verification.md)
  - [`../trust/support-matrix.md`](../trust/support-matrix.md)
  - [`../trust/security-model.md`](../trust/security-model.md)
- benchmark reproducibility and the shipped latest report:
  - [`../benchmarks/README.md`](../benchmarks/README.md)
  - [`../benchmarks/scenario-catalog.md`](../benchmarks/scenario-catalog.md)
- exhaustive flags:
  - [`command-reference.md`](./command-reference.md)

## Contract export for SDK generators

- SDK alpha surfaces are productized as standalone packages, and this repository also vendors matching copies:
  - TypeScript/Node SDK: standalone package identity `@thisispandora/agent-sdk`, repository path `sdk/typescript`, vendored root-package copy `pandora-cli-skills/sdk/typescript`
  - Python SDK: standalone package identity `pandora-agent`, repository path `sdk/python`, module name `pandora_agent`
  - shared contract bundle: standalone TypeScript subpath `@thisispandora/agent-sdk/generated`, repository/root bundle `sdk/generated`, vendored root-package subpath `pandora-cli-skills/sdk/generated`
  - release flow builds and verifies standalone SDK artifacts for those identities; the current public packages are `@thisispandora/agent-sdk` and `pandora-agent`
- Package layout matters:
  - shared JS contract export: `sdk/generated`
  - TypeScript embedded loader/manifest: `sdk/typescript/generated`
  - Python embedded manifest: `sdk/python/pandora_agent/generated`
- Check `capabilities.data.transports.sdk` for the runtime status; current builds report `supported=true` and `status="alpha"`.
- Check `capabilities.data.transports.sdk.packages.*.publicRegistryPublished` and `publicationStatus` before assuming the standalone package identity is already publicly installable from a registry.
- Export `pandora --output json capabilities` when you need compact bootstrap metadata:
  - `commandDigests`
  - `canonicalTools`
  - `outputModeMatrix`
  - `versionCompatibility`
  - `registryDigest`
- Export `pandora --output json schema` when you need the authoritative contract surface for local code generation or validation:
  - JSON envelope definitions
  - per-command `commandDescriptors`
  - descriptor metadata and field capabilities
- In a repository checkout, use `npm run generate:sdk-contracts` when regenerating:
  - the shared JS export in `sdk/generated`
  - the repository-local TypeScript copy in `sdk/typescript/generated`
  - the repository-local Python copy in `sdk/python/pandora_agent/generated`
- Standalone SDK packages ship package-local generated artifacts.
- The published root Pandora package also keeps the shared JSON contract bundle under `sdk/generated`, and the vendored SDK manifests/loaders route back to that shared bundle instead of duplicating it.
- The published root Pandora package also ships benchmark reference material under `docs/benchmarks/**` plus `benchmarks/latest/core-report.json`.
  - The runner scripts, scenario manifests, and lock files remain repository maintainer surfaces; the benchmark docs spell out that split exactly.
- For SDK consumers, separate static metadata access from execution transport:
  - local execution backend: `pandora mcp` over stdio on the same machine
  - remote execution backend: intentionally hosted `pandora mcp http` with bearer-token access to `/mcp`
- For standalone SDK consumers, prefer the standalone package entrypoints first.
- For repo/root-package consumers, prefer the vendored SDK entrypoints and manifests instead of assuming every language reads directly from tree-relative JSON files.
- Treat `commandDescriptorVersion` and `registryDigest.descriptorHash` as the main drift signals for rebuilding generated clients.
- Use `pandora mcp` for local stdio SDK execution or intentionally hosted `pandora mcp http` for remote streamable HTTP SDK execution instead of local contract export.

## Policy scopes and signer-profile status

- Every command digest and schema descriptor exposes machine-readable `policyScopes`, `requiresSecrets`, and related readiness metadata.
- `capabilities.data.trustDistribution` is the machine-readable trust/distribution digest for packaged artifacts, release checks, and shipped trust signals.
- `capabilities.data.policyProfiles.policyPacks` reports `supported=true` and `status="alpha"` in current builds.
  - use `pandora --output json policy list` to inspect the shipped packs
  - use `pandora --output json policy get --id <policy-id>` to inspect compiled rules and remediation hints
  - use `pandora --output json policy lint --file <path>` to validate candidate custom packs
- for cold start, consume `bootstrap.defaults.policyId`, `policyProfiles.policyPacks.recommendedReadOnlyPolicyId`, `recommendedMutablePolicyId`, and `nextSteps[]`
- for exact context-aware ranking, call `pandora --output json policy recommend --command <tool> --mode <mode> --chain-id <id> --category <id|name> [--profile-id <id>]`
- `capabilities.data.policyProfiles.signerProfiles` reports `supported=true` and `status="alpha"` in current builds.
  - use `pandora --output json profile list` to inspect the shipped/sample profiles
  - use `pandora --output json profile get --id <profile-id>` to inspect backend readiness and resolution notes
  - use `pandora --output json profile explain --id <profile-id> [--command <tool>] [--mode <mode>] [--policy-id <id>] [--chain-id <id>] [--category <id|name>]` when you need the exact go/no-go answer for a specific execution context
  - use `pandora --output json profile validate --file <path>` to validate candidate custom profiles
- for cold start, consume `bootstrap.defaults.profileId`, `policyProfiles.signerProfiles.recommendedReadOnlyProfileId`, `recommendedMutableProfileId`, and `nextSteps[]`
- for exact context-aware ranking, call `pandora --output json profile recommend --command <tool> --mode <mode> --chain-id <id> --category <id|name> [--policy-id <id>]`
- use `pandora --output json policy explain --id <policy-id> --command <tool> --mode <mode> --chain-id <id> --category <id|name> [--profile-id <id>]` when you need policy-specific blockers and remediation
- signer-profile capability metadata also exposes:
  - `implementedBackends`
  - `placeholderBackends`
  - `readyBuiltinIds`
  - `pendingBuiltinIds`
- In the default runtime view, `market_observer_ro` is the only built-in profile reporting `ready`, and it is read-only.
- Use `pandora --output json capabilities --runtime-local-readiness` when you want the CLI to actively probe local signer/network prerequisites; under valid runtime conditions, built-in mutable profiles such as `market_deployer_a`, `prod_trader_a`, `dev_keystore_operator`, and `desk_signer_service` can move from `degraded` to `ready`.
- In the current runtime, no built-in mutable profile is ready:
  - `prod_trader_a` resolves as `missing-secrets`
  - `market_deployer_a` resolves as `missing-secrets`
  - `dev_keystore_operator` resolves as `missing-keystore`
  - `desk_signer_service` resolves as `missing-context`
- Treat `degraded` as the backend-level rollup only. The exact reason lives in the per-profile payload:
  - `profile list` for `runtimeReady` and `resolutionStatus`
  - `profile get --id <profile-id>` for raw `resolution`
  - `profile explain --id <profile-id> ...` for:
    - `explanation.requestedContext.exact` and `missingFlags` to prove the evaluation is complete
    - `explanation.usable`, `readiness`, and `compatibility` for the decision
    - `explanation.remediation[]` for machine-usable next actions
    - `explanation.blockers` for the human-readable summary
- Direct signer-bearing execution now supports `--profile-id` / `--profile-file` on:
  - `trade`, `sell`, `lp add`, `lp remove`, `resolve`, `claim`
  - `mirror deploy`, `mirror go`, `mirror sync once|run|start`
  - `sports create run`
  - `mirror deploy`, `mirror go`, `mirror sync once|run|start`
  - sports live execution paths routed through the shared sports stack
- Profile support is still not universal across every mutating family, so keep using `capabilities` / `schema` as the authority for command-level availability.
- `pandora mcp http` is the policy-enforced execution surface available today:
  - grant the minimum `--auth-scopes` needed for the tools you expose
  - inspect `policyScopes` in `capabilities` / `schema` before minting gateway tokens
  - expect mutating tools that need signing to include scopes such as the tool action plus `secrets:use`
- Operator preference order for live execution:
  - read-only bootstrap via `bootstrap`, then `capabilities`, `schema`, `policy`, and `profile`
  - scoped gateway tokens for agent access
  - env or `.env` values supplied by a secret manager or other runtime bootstrap you control
  - raw `--private-key` only for one-off/manual fallback
- The command reference still shows `--private-key` where the parser accepts it. Treat that as supported compatibility surface, not the preferred long-lived operating model.

### Preferred agent bootstrap

Use this sequence instead of starting with secrets:

1. `pandora --output json bootstrap`
2. `pandora --output json schema`
3. `pandora --output json policy list`
4. `pandora --output json profile list`
5. choose the smallest scope set required by the target tools
6. start `pandora mcp` for local stdio or `pandora mcp http --auth-scopes <csv>` for a remote gateway
7. only if the selected tools require signing, provision env-based signer material on that runtime

Notes:
- `bootstrap` is the canonical first call and hides compatibility aliases by default.
- use `bootstrap --include-compatibility` or remote `include_aliases=1` only for legacy/debug inspection or migration diffing.
- Use `capabilities` after `bootstrap` when you need the full compact digest or transport/trust detail.

## Core capability map

| Use case | Canonical commands | Notes |
| --- | --- | --- |
| Market discovery | `scan`, `markets list|get`, `polls list|get`, `positions list`, `events list|get` | `scan` is the enriched discovery path; `markets scan` is a compatibility alias for legacy/debug workflows. |
| Sports data and consensus | `sports schedule|scores`, `sports books list`, `sports events list|live`, `sports odds snapshot|bulk`, `sports consensus` | `sports schedule` and `sports scores` are operator-oriented read surfaces; the `events` family remains the lower-level normalized feed view. |
| Market creation planning | `markets hype plan`, `agent market hype`, `sports create plan`, `mirror plan`, `mirror browse` | `markets hype plan` freezes live trend research into reusable candidate payloads; `agent market hype` is the prompt-only fallback when the agent performs the research itself. `mirror plan` computes the sports-aware suggested `targetTimestamp`. |
| Market deployment and verification | `markets hype run`, `mirror deploy`, `mirror verify`, `mirror go`, `resolve` | `markets hype run` executes only from a frozen plan file and expects the selected candidate to remain ready-to-deploy. Mirror execute paths require payload validation and valid resolution sources. `resolve` also supports `--watch` when you need to wait for finalization instead of polling epochs manually. |
| Trading and exits | `quote`, `trade`, `sell`, `claim` | `trade` is buy-side; `sell` is explicit sell-side. Pari-mutuel markets are buy-only and do not expose a sell path. |
| LP operations | `lp add|remove|positions`, `lp simulate-remove`, `mirror lp-explain`, `mirror hedge-calc`, `mirror simulate` | LP explain/simulate are read-only modeling tools. `lp simulate-remove` is the dedicated LP removal preview path. |
| Mirror sync and hedge operations | `dashboard`, `fund-check`, `mirror dashboard`, `mirror sync once|run|start|stop|status`, `mirror status`, `mirror health`, `mirror panic`, `mirror drift`, `mirror hedge-check`, `mirror calc`, `mirror pnl`, `mirror audit`, `mirror replay`, `mirror logs`, `mirror close`, `polymarket check|approve|preflight|balance|deposit|withdraw|trade` | Default execution stays in paper mode until live flags are supplied. Sync remains separate-leg, not atomic; payloads expose `reserveSource` and rebalance sizing truth. Use `dashboard` / `mirror dashboard` for operator summaries, `mirror sync status` for daemon health, `mirror status --with-live` for full feed/position diagnostics with graceful fallback, `mirror health` or `mirror panic` for daemon safety control, `mirror drift` or `mirror hedge-check` for narrower actionability views, `mirror calc` for exact target-percentage sizing, `fund-check` for high-level funding shortfalls, `mirror pnl` for dedicated cross-venue scenario estimates, `mirror audit` for the classified persisted runtime ledger, `mirror replay` for read-only reconciliation against persisted execution history, `mirror logs` for tailed daemon logs, `polymarket balance|deposit` for signer/proxy funding on Polygon USDC.e, and treat `polymarket withdraw` execute mode as signer-controlled only unless the proxy itself submits the transfer. |
| Monitoring and automation | `watch`, `stream prices|events`, `autopilot run|once`, `risk show|panic`, `lifecycle start|status|resolve` | `stream` is NDJSON-only. |
| Durable operation tracking | `operations get|list|receipt|verify-receipt|cancel|close` | Use for inspecting and controlling persisted mutable-operation records. Terminal mutable operations also emit local receipt artifacts for post-execution audit, and authenticated gateways expose receipt fetch/verify endpoints. |
| Analytics and export | `portfolio`, `history`, `export`, `leaderboard`, `analyze`, `suggest` | `portfolio` and `history` are operator analytics, not full accounting ledgers. |
| Cross-venue analysis | `arb scan` | `arb scan` is the canonical scanner. `arbitrage` remains available only as a bounded compatibility wrapper for legacy/debug workflows. |
| Quant/model tooling | `simulate mc|particle-filter|agents`, `model calibrate|correlation|diagnose|score brier` | Separate from trading/runtime execution. |
| Agent-native integration | `bootstrap`, `capabilities`, `schema`, `policy list|get|lint|explain|recommend`, `profile list|get|explain|recommend|validate`, `mcp`, `explain`, `agent market hype`, `agent market autocomplete`, `agent market validate` | Start with `bootstrap`; open `agent-interfaces.md` for exact envelope and MCP details. |
| Legacy script launchers | `launch`, `clone-bet` | Legacy wrappers, documented separately because their timing model differs from mirror. `launch --market-type parimutuel` is the current generic scripted pari-mutuel creator; `clone-bet` is pari-mutuel-only. |

Mirror and resolve operator notes:
- `POLYMARKET_FUNDER` / `--funder` is the Polymarket proxy wallet (Gnosis Safe), not the signer EOA.
- `mirror status --with-live` is the single-mirror live dashboard, but its P&L fields remain scenario or mark-to-market approximations rather than realized ledger accounting.
- `mirror close` does not auto-resolve Pandora or auto-settle Polymarket inventory; use `resolve --watch` plus `claim` as the post-close follow-up path.

## Canonical paths and aliases

### Discovery
- `pandora scan`
  - canonical enriched discovery path
- `pandora markets scan`
  - backward-compatible alias of `scan`
  - use only for legacy/debug workflows or when matching an older caller's command string
- `pandora markets list|get`
  - raw browse/get indexer surfaces

### Trading
- `pandora quote`
  - canonical read-only quote path for buy and sell estimates
- `pandora trade`
  - buy-side execution only
- `pandora sell`
  - explicit sell-side execution path
- `pandora claim`
  - canonical winning-token redemption path

### Arbitrage and mirror
- `pandora arb scan`
  - canonical arbitrage scanner
- `pandora arbitrage`
  - bounded compatibility wrapper
  - use only for legacy/debug workflows or when matching an older caller's wrapper semantics
- `pandora mirror ...`
  - canonical market mirroring and hedge workflow

## PollCategory mapping
Use numeric ids where a read-only filter explicitly documents `<int>`. Use ids or canonical names where deploy-style flows document `<id|name>`.

| Name | Id |
| --- | --- |
| Politics | `0` |
| Sports | `1` |
| Finance | `2` |
| Crypto | `3` |
| Culture | `4` |
| Technology | `5` |
| Science | `6` |
| Entertainment | `7` |
| Health | `8` |
| Environment | `9` |
| Other | `10` |

Notes:
- `mirror deploy|go` accept `--category <id|name>`.
- Sports mirror examples should use `Sports` or `1`.
- Read-only examples in the reference use numeric ids to match the documented filter surface.

## Safety invariants that matter across command families
- Resolution sources must be public URLs.
- Mirror deploy/go require at least two independent resolution sources from different hosts.
- Polymarket / Gamma / CLOB URLs are source-market discovery inputs, not resolution sources.
- Validation is exact-payload. If `question`, `rules`, `sources`, or `targetTimestamp` change, the old validation ticket is stale.
- `mirror plan|deploy|go` use a sports-aware suggested `targetTimestamp`; do not backfill a generic `+1h` rule.
- `launch` / `clone-bet` still carry script-layer `--target-timestamp-offset-hours`; that behavior does not define mirror timing.

## Capability routing by task
- Need the full CLI surface with flags:
  - open [`command-reference.md`](./command-reference.md)
- Need the fastest safe external-agent bootstrap:
  - open [`agent-quickstart.md`](./agent-quickstart.md)
- Need buy/sell/claim/arbitrage workflow guidance:
  - open [`trading-workflows.md`](./trading-workflows.md)
- Need portfolio inspection or closeout guidance:
  - open [`portfolio-closeout.md`](./portfolio-closeout.md)
- Need safe mirror operational guidance:
  - open [`mirror-operations.md`](./mirror-operations.md)
- Need JSON contracts, schema, or MCP tool behavior:
  - open [`agent-interfaces.md`](./agent-interfaces.md)
- Need policy and signer-profile guidance:
  - open [`policy-profiles.md`](./policy-profiles.md)
- Need legacy launcher semantics:
  - open [`legacy-launchers.md`](./legacy-launchers.md)
