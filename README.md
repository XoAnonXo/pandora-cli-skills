# Pandora CLI & Skills

Production CLI for Pandora prediction markets with mirror tooling, sports consensus, on-chain trading, analytics, and agent-native interfaces.

## Install

```bash
npm i -g pandora-cli-skills
pandora --help
```

Or without installing:

```bash
npx pandora-cli-skills@latest --help
```

Node.js `>=18` required.

## Documentation map
- [`SKILL.md`](./SKILL.md)
  - root overview and routing index
- [`docs/skills/capabilities.md`](./docs/skills/capabilities.md)
  - capability map, canonical paths, and PollCategory mapping
- [`docs/skills/agent-quickstart.md`](./docs/skills/agent-quickstart.md)
  - fastest safe bootstrap path for agents using local CLI, stdio MCP, remote MCP HTTP, and SDKs
- [`docs/skills/command-reference.md`](./docs/skills/command-reference.md)
  - human-oriented command and flag reference; use capabilities/schema for machine authority
- [`docs/skills/trading-workflows.md`](./docs/skills/trading-workflows.md)
  - discover -> quote -> trade/sell -> claim workflows
- [`docs/skills/portfolio-closeout.md`](./docs/skills/portfolio-closeout.md)
  - portfolio inspection, history/export, LP exits, claim-all, and mirror closeout
- [`docs/skills/mirror-operations.md`](./docs/skills/mirror-operations.md)
  - mirror deploy/go safety, timing, validation, sync, and closeout guidance
- [`docs/skills/agent-interfaces.md`](./docs/skills/agent-interfaces.md)
  - schema, MCP, JSON envelopes, recovery hints, fork runtime, and error codes
- [`docs/skills/policy-profiles.md`](./docs/skills/policy-profiles.md)
  - policy packs, signer profiles, gateway scopes, and preferred secret handling
- [`docs/skills/recipes.md`](./docs/skills/recipes.md)
  - reusable safe workflows that compile to ordinary Pandora commands
- [`docs/benchmarks/README.md`](./docs/benchmarks/README.md)
  - public benchmark harness, release-gate role, and agent-readiness interpretation
- [`docs/benchmarks/scenario-catalog.md`](./docs/benchmarks/scenario-catalog.md)
  - scenario-by-scenario benchmark coverage and parity groups
- [`docs/benchmarks/scorecard.md`](./docs/benchmarks/scorecard.md)
  - weighted scoring, parity failures, and benchmark output interpretation
- [`docs/skills/legacy-launchers.md`](./docs/skills/legacy-launchers.md)
  - `launch` / `clone-bet` legacy script wrappers
- [`docs/trust/release-verification.md`](./docs/trust/release-verification.md)
  - verify tarballs, checksums, attestations, SBOM, and cosign signatures before install
- [`docs/trust/security-model.md`](./docs/trust/security-model.md)
  - trust boundaries, mutation controls, and secret-handling posture across CLI, MCP, gateway, and SDKs
- [`docs/trust/support-matrix.md`](./docs/trust/support-matrix.md)
  - support status and guarantees for local CLI, MCP transports, SDKs, benchmarks, and packaged docs

## Quickstart

```bash
# compact capability digest for agents
pandora --output json bootstrap
pandora --output json capabilities

# schema for typed consumers
pandora --output json schema

# inspect shipped policy packs and named profiles
pandora --output json policy list
pandora --output json profile list
pandora --output json recipe list

# MCP server mode
pandora mcp

# read-only discovery
pandora --output json scan --limit 10

# buy-side dry-run
pandora --output json trade --dry-run \
  --market-address 0x... --side yes --amount-usdc 10

# sell-side dry-run
pandora --output json sell --dry-run \
  --market-address 0x... --side no --shares 25

# inspect persisted mutable-operation records
pandora --output json operations list --status planned,queued,running --limit 20
```

Notes:
- `bootstrap` is the preferred first call for cold agents and returns canonical tools by default.
- Use `pandora --output json bootstrap --include-compatibility` only when you are debugging or migrating a legacy caller that still speaks in alias commands.

## Agent-first onboarding

Use this path when the consumer is an agent, not a human operator:

```bash
# 1) discover the live contract
pandora --output json bootstrap
pandora --output json capabilities
pandora --output json schema
pandora --output json policy list
pandora --output json profile list

# 2) start local stdio MCP, or intentionally host remote MCP
pandora mcp
# or
pandora mcp http [--auth-scopes <csv>]
```

Canonical-routing note:
- start from `bootstrap`, then resolve any follow-up decisions against canonical tool names from `bootstrap`, `capabilities`, or `schema`
- only opt into compatibility aliases with `--include-compatibility` when you are inspecting legacy/debug workflows; do not use alias names as the default planning surface for new agents

If you are embedding the shipped SDKs instead of only consuming raw JSON:
- standalone SDK package identities:
  - TypeScript/Node: `@pandora/agent-sdk`
  - Python: `pandora-agent`
- current release flow builds and verifies standalone SDK artifacts for those package identities; this document does not yet claim public registry publication
- this repository and the root Pandora package also vendor matching SDK copies under `sdk/typescript` and `sdk/python` for parity, local audit, and in-tree consumption
- local SDK execution maps to `pandora mcp` over stdio on the same machine
- remote SDK execution maps to intentionally hosted `pandora mcp http ...`; remote clients connect to the `/mcp` endpoint with a bearer token
- standalone SDK packages ship package-local generated artifacts
- the repository root also keeps a shared contract bundle under `sdk/generated` for parity checks, custom generators, and vendored consumers
- the vendored TypeScript copy keeps a local loader and manifest under `sdk/typescript/generated`
- the vendored Python copy keeps a local manifest under `sdk/python/pandora_agent/generated/manifest.json`; in the published root package its loader falls back to the shared `sdk/generated` bundle for the heavy generated JSON artifacts

For live signing:
- current builds ship policy packs and named profiles in alpha
- current builds also ship first-party recipes in alpha via `recipe list|get|validate|run`
- inspect them with `policy list|get|lint` and `profile list|get|explain|validate` before exposing tools to an agent
- treat `bootstrap` as the machine-usable recommendation surface:
  - `defaults.policyId` / `defaults.profileId`
  - `policyProfiles.policyPacks.recommendedReadOnlyPolicyId` / `recommendedMutablePolicyId`
  - `policyProfiles.signerProfiles.recommendedReadOnlyProfileId` / `recommendedMutableProfileId`
  - `nextSteps[]`
- use `bootstrap` for safe defaults, then use `policy explain`, `policy recommend`, and `profile recommend` for exact context-aware remediation or ranking
  - use `policy get` for pack inspection
  - use `profile get` for raw profile state
  - use `profile explain` for exact usability decisions
- do not collapse signer readiness into one “pending” bucket:
  - implementation-status fields: `implementedBackends`, `placeholderBackends`
  - runtime-readiness fields: `readyBuiltinIds`, `degradedBuiltinIds`, `placeholderBuiltinIds`
  - backend-level rollup: `policyProfiles.signerProfiles.backendStatuses`
  - vocabulary: `policyProfiles.signerProfiles.statusAxes`
  - today, all shipped signer backends are implemented: `read-only`, `local-env`, `local-keystore`, `external-signer`
  - in the default runtime view, `market_observer_ro` is the only built-in profile reporting `ready`, and it is read-only
  - `--runtime-local-readiness` actively probes local signer/network prerequisites and can promote built-in mutable profiles such as `prod_trader_a`, `dev_keystore_operator`, and `desk_signer_service` to `ready` when their runtime requirements are satisfied
  - in the current runtime, no built-in mutable profile is ready
  - current built-in mutable profile states are:
    - `prod_trader_a`: backend rollup `degraded`, per-profile `resolutionStatus` `missing-secrets`
    - `dev_keystore_operator`: backend rollup `degraded`, per-profile `resolutionStatus` `missing-keystore`
    - `desk_signer_service`: backend rollup `degraded`, per-profile `resolutionStatus` `missing-context`
  - `degraded` means the backend is implemented, but this process is still missing signer material, keystore access, external-signer context, network context, or other compatibility prerequisites
  - use `profile list` for the compact `runtimeReady` / `resolutionStatus` view
  - use `profile explain --id <profile-id> [--command <tool>] [--mode <mode>] [--policy-id <id>] [--chain-id <id>] [--category <id|name>]` before mutable execution to inspect `explanation.requestedContext`, `explanation.usable`, `explanation.readiness`, `explanation.compatibility`, `explanation.remediation`, and `explanation.blockers`
- there is not yet a universal `--profile` selector across mutating commands
- direct Pandora signer-bearing commands now accept `--profile-id` / `--profile-file` for `trade`, `sell`, `lp add`, `lp remove`, `resolve`, `claim`, `mirror deploy`, `mirror go`, `mirror sync once|run|start`, and `sports create run`
- other live families still commonly resolve signing material from env / `.env` / explicit flags
- the preferred agent pattern is a scoped MCP gateway plus signer material only on the runtime that actually executes live tools

## Live execution setup

Only do this when the runtime will execute signing commands:

```bash
npm run init-env
npm run doctor
```

Populate `.env` or process env with only the fields your live workflow actually needs:
- `CHAIN_ID`
- `RPC_URL`
- `PRIVATE_KEY`
- `ORACLE`
- `FACTORY`
- `USDC`

## Standalone SDKs And Contract Export

Current shipped consumer paths:
- TypeScript/Node:
  - standalone package identity: `@pandora/agent-sdk`
  - current external install path: signed GitHub release tarball attached to the tagged Pandora release
  - repository checkout path: `sdk/typescript` for maintainers and in-tree consumers
  - vendored root-package copy: `pandora-cli-skills/sdk/typescript`
- Python:
  - standalone package identity: `pandora-agent`
  - current external install path: signed GitHub release wheel or sdist attached to the tagged Pandora release
  - repository checkout path: `sdk/python` for maintainers and in-tree consumers
  - module/import name: `pandora_agent`
- Shared static contract bundle:
  - standalone TypeScript package: `@pandora/agent-sdk/generated`
  - repository/root shared bundle: `sdk/generated`
  - vendored root-package subpath: `pandora-cli-skills/sdk/generated`

```bash
npm run generate:sdk-contracts
```

Run that only from a repository checkout. The published npm package ships the generated SDK artifacts already and does not include the repo-only generator script.

- This repository ships standalone SDK alpha packages plus vendored copies and the shared contract bundle:
  - JavaScript/TypeScript SDK package sources under `sdk/typescript`
  - Python SDK package sources under `sdk/python`
  - vendored TypeScript loader/manifest under `sdk/typescript/generated`
  - vendored Python manifest under `sdk/python/pandora_agent/generated`
  - shared JS contract export under `sdk/generated`
- `capabilities.data.transports.sdk` reports `supported=true` and `status="alpha"` in current builds.
- Use `capabilities` for compact discovery, canonical tool routing, transport status, and registry digests.
- Use `schema` for the authoritative contract export: JSON envelope definitions, per-command input schemas, and `commandDescriptors`.
- In a repository checkout, `npm run generate:sdk-contracts` regenerates the shared export in `sdk/generated` plus the standalone SDK package-local copies in `sdk/typescript/generated` and `sdk/python/pandora_agent/generated`.
- Standalone SDK consumers should prefer the standalone package entrypoints and package-local generated artifacts:
  - TypeScript SDK package identity: `@pandora/agent-sdk`
  - TypeScript generated bundle subpath: `@pandora/agent-sdk/generated`
  - Python SDK package identity: `pandora-agent`
- Current release/distribution status:
  - standalone SDK artifacts are built and verified in release flow
  - use signed GitHub release assets as the external installation path unless a release explicitly announces public npm/PyPI publication
- The root Pandora package continues to vendor matching copies:
  - TypeScript client: `pandora-cli-skills/sdk/typescript`
  - shared contract bundle: `pandora-cli-skills/sdk/generated`
  - vendored manifests: `sdk/typescript/generated/manifest.json` and `sdk/python/pandora_agent/generated/manifest.json`
- Custom generators can still export raw `capabilities` / `schema` snapshots if they need bespoke codegen.
- Regenerate cached clients or derived types when `commandDescriptorVersion` or `registryDigest.descriptorHash` changes.
- For most agent bootstrap flows, start with `bootstrap`, then `schema`, `policy`, `profile`, or MCP before embedding the alpha SDK sources into your own code.
- For direct execution instead of local codegen, connect an SDK or MCP client to `pandora mcp` for local stdio, or intentionally host `pandora mcp http ...` for remote streamable HTTP execution.

## Policy And Signer Guidance

- Prefer scoped MCP access over broad live credentials when an agent can work through `pandora mcp http`. The gateway enforces bearer-token scopes from `--auth-scopes` against each tool's declared `policyScopes`.
- Current builds ship policy packs in alpha. `capabilities.data.policyProfiles.policyPacks` reports `supported=true` and `status="alpha"`, and `pandora --output json policy list|get|lint` exposes the available built-in/user-defined packs.
- Current builds also ship named signer profiles in alpha. `capabilities.data.policyProfiles.signerProfiles` reports `supported=true` and `status="alpha"`, and `pandora --output json profile list|get|explain|validate` exposes sample/user profiles plus readiness metadata.
- `bootstrap` is the canonical recommendation surface today:
  - `defaults.policyId` and `defaults.profileId` are the cold-start defaults
  - `policyProfiles.policyPacks.recommendedReadOnlyPolicyId` / `recommendedMutablePolicyId` are the machine-usable policy recommendations
  - `policyProfiles.signerProfiles.recommendedReadOnlyProfileId` / `recommendedMutableProfileId` are the machine-usable profile recommendations
  - `nextSteps[]` gives the canonical follow-up commands in order
- `bootstrap` remains the preferred cold-start surface, but exact-context commands are also available:
  - `policy explain`
  - `policy recommend`
  - `profile recommend`
- treat those exact-context commands as follow-ups after you already know the canonical target tool and execution context; they are not a substitute for `bootstrap`
- `capabilities.data.policyProfiles.signerProfiles` now separates implementation status from runtime readiness:
  - implementation fields: `implementedBackends`, `placeholderBackends`
  - runtime fields: `readyBuiltinIds`, `degradedBuiltinIds`, `placeholderBuiltinIds`, `pendingBuiltinIds`
  - backend rollup: `backendStatuses`
  - vocabulary: `statusAxes`
- In the default runtime view, `market_observer_ro` is the only built-in profile reporting `ready`, and it is read-only.
- Use `pandora --output json capabilities --runtime-local-readiness` when you want the CLI to actively probe local signer/network prerequisites; under valid runtime conditions, built-in mutable profiles such as `prod_trader_a`, `dev_keystore_operator`, and `desk_signer_service` can move from `degraded` to `ready`.
- In the current runtime, no built-in mutable profile is ready:
  - `prod_trader_a` resolves as `missing-secrets`
  - `dev_keystore_operator` resolves as `missing-keystore`
  - `desk_signer_service` resolves as `missing-context`
- Treat `degraded` as the backend-level summary only. The exact cause lives in the per-profile payload:
  - `profile list` for `runtimeReady` and `resolutionStatus`
  - `profile get --id <profile-id>` for raw `resolution` and constraint details
  - `profile explain --id <profile-id> [--command <tool>] [--mode <mode>] [--policy-id <id>] [--chain-id <id>] [--category <id|name>]` for the exact decision surface:
    - prefer canonical command names from `bootstrap`, `capabilities`, or `schema` when filling `--command`
    - `explanation.requestedContext.exact` tells you whether the evaluation is complete or still missing flags
    - `explanation.requestedContext.missingFlags` tells the agent what to add before trusting the answer
    - `explanation.remediation[]` is the machine-usable action list; treat `blockers` as the human-readable summary
- There is not yet a universal `--profile` selector across mutating commands.
- Direct signer-bearing execution now supports `--profile-id` / `--profile-file` on:
  - `trade`, `sell`, `lp add`, `lp remove`, `resolve`, `claim`
  - `mirror deploy`, `mirror go`, `mirror sync once|run|start`
  - sports live execution paths that route through the shared sports parsers/services
- Some families still commonly bootstrap secrets from process env, `.env`, or explicit flags, but profile-directed execution is no longer limited to the core trading/admin commands.
- The built-in read-only pair is `research-only` plus `market_observer_ro`. Use that pattern for discovery, schema inspection, validation, and other non-signing agent workflows before granting write access.
- If you host `pandora mcp http` without `--auth-token` or `--auth-token-file`, Pandora generates a bearer token at `~/.pandora/mcp-http/auth-token`. If the runtime cannot resolve a home directory, pass one of those flags explicitly.
- `--private-key <hex>` remains supported because the live parser surface still accepts it, but use it as a manual fallback rather than the default operator pattern.

## Mirror safety summary
- `mirror plan|deploy|go` use a sports-aware suggested `targetTimestamp`; they do not assume a generic `+1h` buffer.
- Use `--target-timestamp <unix|iso>` only when you intentionally need to override the suggested close time.
- Fresh `mirror deploy` / `mirror go` runs require at least two independent public resolution URLs from different hosts in `--sources`.
- Polymarket, Gamma, and CLOB URLs are discovery inputs only and are not valid `--sources`.
- Validation is exact-payload: validate the final `question`, `rules`, `sources`, and `targetTimestamp` before execute mode.
- CLI mirror execute reruns use `--validation-ticket`; MCP execute/live reruns use `agentPreflight`.

## PollCategory mapping
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

For sports mirror deploy/go flows, use `--category Sports` or `--category 1`.
