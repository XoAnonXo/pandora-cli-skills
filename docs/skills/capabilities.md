# Pandora CLI Capabilities

This document maps the CLI to operator use cases. Use it to decide which command family to reach for before opening the full command reference.

For machine-first discovery, start with:
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
- exhaustive flags:
  - [`command-reference.md`](./command-reference.md)

## Contract export for SDK generators

- SDK alpha source/artifact surfaces are shipped in this build under `sdk/typescript`, `sdk/python`, and `sdk/generated`.
- Package layout matters:
  - shared JS contract export: `sdk/generated`
  - TypeScript embedded loader/manifest: `sdk/typescript/generated`
  - Python embedded manifest: `sdk/python/pandora_agent/generated`
- Check `capabilities.data.transports.sdk` for the runtime status; current builds report `supported=true` and `status="alpha"`.
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
  - the standalone TypeScript package-local copy in `sdk/typescript/generated`
  - the standalone Python package-local copy in `sdk/python/pandora_agent/generated`
- In the published root package, the shared JSON contract bundle is stored once under `sdk/generated`; embedded SDK loaders/manifests route to that shared bundle instead of duplicating it.
- For embedded SDK consumers, prefer the SDK package's own generated manifest/artifacts instead of assuming every language reads directly from `sdk/generated`.
- Treat `commandDescriptorVersion` and `registryDigest.descriptorHash` as the main drift signals for rebuilding generated clients.
- Use `pandora mcp` for local stdio SDK execution or intentionally hosted `pandora mcp http` for remote streamable HTTP SDK execution instead of local contract export.

## Policy scopes and signer-profile status

- Every command digest and schema descriptor exposes machine-readable `policyScopes`, `requiresSecrets`, and related readiness metadata.
- `capabilities.data.trustDistribution` is the machine-readable trust/distribution digest for packaged artifacts, release checks, and shipped trust signals.
- `capabilities.data.policyProfiles.policyPacks` reports `supported=true` and `status="alpha"` in current builds.
  - use `pandora --output json policy list` to inspect the shipped packs
  - use `pandora --output json policy get --id <policy-id>` to inspect compiled rules and remediation hints
  - use `pandora --output json policy lint --file <path>` to validate candidate custom packs
- `capabilities.data.policyProfiles.signerProfiles` reports `supported=true` and `status="alpha"` in current builds.
  - use `pandora --output json profile list` to inspect the shipped/sample profiles
  - use `pandora --output json profile get --id <profile-id>` to inspect backend readiness and resolution notes
  - use `pandora --output json profile validate --file <path>` to validate candidate custom profiles
- signer-profile capability metadata also exposes:
  - `implementedBackends`
  - `placeholderBackends`
  - `readyBuiltinIds`
  - `pendingBuiltinIds`
- In current builds, treat only `market_observer_ro` as built-in runtime-ready by default unless `profile get` reports otherwise for your runtime.
- There is not yet a universal `--profile` selector across mutating commands. Live command execution still commonly resolves credentials from flags/env during rollout.
- `pandora mcp http` is the policy-enforced execution surface available today:
  - grant the minimum `--auth-scopes` needed for the tools you expose
  - inspect `policyScopes` in `capabilities` / `schema` before minting gateway tokens
  - expect mutating tools that need signing to include scopes such as the tool action plus `secrets:use`
- Operator preference order for live execution:
  - read-only bootstrap via `capabilities`, `schema`, `policy`, and `profile`
  - scoped gateway tokens for agent access
  - env or `.env` values supplied by a secret manager or other runtime bootstrap you control
  - raw `--private-key` only for one-off/manual fallback
- The command reference still shows `--private-key` where the parser accepts it. Treat that as supported compatibility surface, not the preferred long-lived operating model.

### Preferred agent bootstrap

Use this sequence instead of starting with secrets:

1. `pandora --output json capabilities`
2. `pandora --output json schema`
3. `pandora --output json policy list`
4. `pandora --output json profile list`
5. choose the smallest scope set required by the target tools
6. start `pandora mcp` for local stdio or `pandora mcp http --auth-scopes <csv>` for a remote gateway
7. only if the selected tools require signing, provision env-based signer material on that runtime

## Core capability map

| Use case | Canonical commands | Notes |
| --- | --- | --- |
| Market discovery | `scan`, `markets list|get`, `polls list|get`, `positions list`, `events list|get` | `scan` is the enriched discovery path; `markets scan` is an alias. |
| Sports data and consensus | `sports books list`, `sports events list|live`, `sports odds snapshot|bulk`, `sports consensus` | Focused on sportsbook inputs and operator-safe market prep. |
| Market creation planning | `sports create plan`, `mirror plan`, `mirror browse` | `mirror plan` computes the sports-aware suggested `targetTimestamp`. |
| Market deployment and verification | `mirror deploy`, `mirror verify`, `mirror go`, `resolve` | Mirror execute paths require payload validation and valid resolution sources. |
| Trading and exits | `quote`, `trade`, `sell`, `claim` | `trade` is buy-side; `sell` is explicit sell-side. |
| LP operations | `lp add|remove|positions`, `mirror lp-explain`, `mirror hedge-calc`, `mirror simulate` | LP explain/simulate are read-only modeling tools. |
| Mirror sync and hedge operations | `mirror sync once|run|start|stop|status`, `mirror close`, `polymarket check|approve|preflight|trade` | `mirror close` is the deterministic closeout path. |
| Monitoring and automation | `watch`, `stream prices|events`, `autopilot run|once`, `risk show|panic`, `lifecycle start|status|resolve` | `stream` is NDJSON-only. |
| Durable operation tracking | `operations get|list|cancel|close` | Use for inspecting and controlling persisted mutable-operation records. |
| Analytics and export | `portfolio`, `history`, `export`, `leaderboard`, `analyze`, `suggest` | `portfolio` and `history` are operator analytics, not full accounting ledgers. |
| Cross-venue analysis | `arb scan`, `arbitrage` | `arb scan` is the canonical scanner; `arbitrage` is the one-shot wrapper. |
| Quant/model tooling | `simulate mc|particle-filter|agents`, `model calibrate|correlation|diagnose|score brier` | Separate from trading/runtime execution. |
| Agent-native integration | `capabilities`, `schema`, `policy list|get|lint`, `profile list|get|validate`, `mcp`, `agent market autocomplete`, `agent market validate` | Open `agent-interfaces.md` for exact envelope and MCP details. |
| Legacy script launchers | `launch`, `clone-bet` | Legacy wrappers, documented separately because their timing model differs from mirror. |

## Canonical paths and aliases

### Discovery
- `pandora scan`
  - canonical enriched discovery path
- `pandora markets scan`
  - backward-compatible alias of `scan`
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
