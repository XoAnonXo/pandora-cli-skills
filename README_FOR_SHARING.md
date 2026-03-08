# Pandora CLI & Skills — Shareable Package

Sanitized, shareable copy of the Pandora CLI docs, SDK surfaces, and package metadata.

## Included
- `SKILL.md`
- `README.md`
- `README_FOR_SHARING.md`
- `docs/skills/*.md`
- `docs/trust/*.md`
- `docs/benchmarks/**`
- `benchmarks/latest/core-report.json`
- `sdk/generated/*`
- `sdk/typescript/**`
- `sdk/python/**`
- `package.json`
- `package-lock.json`
- `.gitignore`
- `scripts/.env.example`
- `scripts/create_market_launcher.ts`
- `scripts/create_polymarket_clone_and_bet.ts`
- `scripts/release/install_release.sh`
- `references/creation-script.md`
- `references/contracts.md`
- `references/checklist.md`

## Intentionally omitted
- `.env`
- `wallet.json`
- local runtime secrets
- `node_modules`

Packaging note:
- The published npm package ships the latest benchmark report and trust/reference docs.
- The full benchmark harness, CI workflows, and release-maintainer scripts remain repository surfaces rather than installed runtime baggage.

## Setup
Prerequisite: Node.js `>=18`.

```bash
npm install
node cli/pandora.cjs --output json bootstrap
node cli/pandora.cjs --output json capabilities
node cli/pandora.cjs --output json schema
node cli/pandora.cjs --output json policy list
node cli/pandora.cjs --output json profile list
node cli/pandora.cjs --output json recipe list
node cli/pandora.cjs help
```

Operation tracking:
- use `pandora --output json operations list --status planned,queued,running --limit 20` to inspect persisted mutable-operation records

Preferred agent path:
- start with `bootstrap`, then `schema`, `policy list`, `profile list`, and `recipe list`; none of those require signer material
- use `pandora mcp` for local stdio tool execution
- use `pandora mcp http --auth-scopes ...` when you intentionally want a remote MCP gateway
- for a remote read-only planning token that covers `scan`, `quote`, `portfolio`, `mirror plan`, `sports create plan`, and `operations list|get`, use `capabilities:read,contracts:read,help:read,schema:read,operations:read,scan:read,quote:read,portfolio:read,mirror:read,sports:read,network:indexer,network:rpc,network:polymarket,network:sports`
- add `operations:write` only when the remote runtime needs `operations cancel|close`; over MCP those mutating calls also require `intent.execute=true`
- give the agent the minimum bearer-token scopes it needs
- only provision signing secrets on the runtime that will actually execute live mutating tools
- if you are embedding the shipped SDKs, use each package's own generated artifacts:
  - standalone SDK package identities are `@pandora/agent-sdk` and `pandora-agent`
  - current release flow builds and verifies standalone SDK artifacts for those package identities; this guide does not yet claim public registry publication
  - this shareable package also includes vendored SDK copies under `sdk/typescript` and `sdk/python`
  - local SDK execution uses `pandora mcp`; remote SDK execution uses intentionally hosted `pandora mcp http ...` plus a bearer token to `/mcp`
  - `sdk/typescript/generated/manifest.json` is the TypeScript manifest entrypoint
  - `sdk/python/pandora_agent/generated/manifest.json` is the Python manifest entrypoint
  - `sdk/generated` is the shared contract bundle
- `bootstrap` and `GET /bootstrap` return canonical tools by default
- only use `--include-compatibility` or `?include_aliases=1` when you are debugging or migrating a legacy caller that still depends on alias names

Live execution setup:
- run `npm run init-env`
- run `npm run doctor`
- then, only if this local process will sign live transactions, populate `.env` or process env with only the fields your live workflow needs:
  - `CHAIN_ID`
  - `PRIVATE_KEY`
  - `RPC_URL`
  - `ORACLE`
  - `FACTORY`
  - `USDC`

Optional live Polymarket hedge env:
- `POLYMARKET_PRIVATE_KEY`
- `POLYMARKET_FUNDER`
- `POLYMARKET_API_KEY`
- `POLYMARKET_API_SECRET`
- `POLYMARKET_API_PASSPHRASE`
- `POLYMARKET_HOST`

Credential handling note:
- Current builds ship policy packs and named profiles in alpha via `policy list|get|lint` and `profile list|get|explain|validate`.
- Current builds also ship first-party recipes in alpha via `recipe list|get|validate|run`.
- Current live command execution still commonly resolves signer secrets from flags/env during rollout.
- Treat `bootstrap` as the recommendation surface for both policies and profiles:
  - `defaults.policyId` / `defaults.profileId`
  - `policyProfiles.policyPacks.recommendedReadOnlyPolicyId` / `recommendedMutablePolicyId`
  - `policyProfiles.signerProfiles.recommendedReadOnlyProfileId` / `recommendedMutableProfileId`
  - `nextSteps[]`
- `bootstrap` is still the preferred cold-start surface, but standalone `policy explain`, `policy recommend`, and `profile recommend` are available for exact context-aware reasoning.
- treat those exact-context commands as follow-ups after you already know the canonical target tool and execution context from `bootstrap`, `capabilities`, or `schema`
- Use `policy get` for pack inspection, `profile get` for raw profile state, and `profile explain` for exact execution-context decisions.
- Do not collapse signer readiness into one “pending” bucket:
  - implementation-status fields: `implementedBackends`, `placeholderBackends`
  - runtime-readiness fields: `readyBuiltinIds`, `degradedBuiltinIds`, `placeholderBuiltinIds`
  - backend rollup: `policyProfiles.signerProfiles.backendStatuses`
  - vocabulary: `policyProfiles.signerProfiles.statusAxes`
  - today, all shipped signer backends are implemented: `read-only`, `local-env`, `local-keystore`, `external-signer`
  - in the default runtime view, `market_observer_ro` is the only built-in profile reporting `ready`, and it is read-only
  - `--runtime-local-readiness` actively probes local signer/network prerequisites and can promote built-in mutable profiles such as `prod_trader_a`, `dev_keystore_operator`, and `desk_signer_service` to `ready` when their runtime requirements are satisfied
  - in the current runtime, no built-in mutable profile is ready
  - current built-in mutable profile states are:
    - `prod_trader_a`: backend rollup `degraded`, per-profile `resolutionStatus` `missing-secrets`
    - `dev_keystore_operator`: backend rollup `degraded`, per-profile `resolutionStatus` `missing-keystore`
    - `desk_signer_service`: backend rollup `degraded`, per-profile `resolutionStatus` `missing-context`
  - `degraded` means the backend exists, but this runtime is still missing signer material, keystore access, external-signer context, network context, or compatibility prerequisites
  - use `profile list` for the compact `runtimeReady` / `resolutionStatus` view
  - use `profile explain --id <profile-id> [--command <tool>] [--mode <mode>] [--policy-id <id>] [--chain-id <id>] [--category <id|name>]` before mutable execution to inspect `explanation.requestedContext`, `explanation.usable`, `explanation.readiness`, `explanation.compatibility`, `explanation.remediation`, and `explanation.blockers`
- Prefer process env, `.env`, or your own secret-manager wrapper that materializes those env vars before launching Pandora.
- Avoid putting raw `--private-key` values on the command line unless you explicitly need a one-off manual override.
- There is not yet a universal `--profile` selector across every mutating command family.
- Direct Pandora signer-bearing commands now accept `--profile-id` / `--profile-file` for `trade`, `sell`, `lp add`, `lp remove`, `resolve`, `claim`, `mirror deploy`, `mirror go`, `mirror sync once|run|start`, and `sports create run`.
- Mirror deploy/go/sync flows and sports live execution paths now also accept profile selectors in current builds; use `pandora --output json capabilities` or `schema` to confirm support on the exact command family you plan to call.

## Documentation map
- [`SKILL.md`](./SKILL.md)
  - root overview and doc router
- [`docs/skills/capabilities.md`](./docs/skills/capabilities.md)
  - capability map and PollCategory guidance
- [`docs/skills/agent-quickstart.md`](./docs/skills/agent-quickstart.md)
  - fastest safe bootstrap path for external agents
- [`docs/skills/command-reference.md`](./docs/skills/command-reference.md)
  - human-oriented command and flag reference; use capabilities/schema for machine authority
- [`docs/skills/trading-workflows.md`](./docs/skills/trading-workflows.md)
  - discover -> quote -> trade/sell -> claim workflows
- [`docs/skills/portfolio-closeout.md`](./docs/skills/portfolio-closeout.md)
  - portfolio inspection, LP exits, claim-all, mirror closeout, and operation tracking
- [`docs/skills/mirror-operations.md`](./docs/skills/mirror-operations.md)
  - mirror safety, validation, sync, and closeout workflow
- [`docs/skills/agent-interfaces.md`](./docs/skills/agent-interfaces.md)
  - schema, MCP, JSON envelopes, recovery hints, and runtime contracts
- [`docs/skills/policy-profiles.md`](./docs/skills/policy-profiles.md)
  - policy packs, signer profiles, gateway scopes, and secret-handling guidance
- [`docs/skills/recipes.md`](./docs/skills/recipes.md)
  - reusable safe workflows that compile to ordinary Pandora commands
- [`docs/skills/legacy-launchers.md`](./docs/skills/legacy-launchers.md)
  - legacy `launch` / `clone-bet` notes
- [`docs/trust/release-verification.md`](./docs/trust/release-verification.md)
  - verify tarballs, checksums, attestations, SBOM, and cosign signatures before install
- [`docs/trust/security-model.md`](./docs/trust/security-model.md)
  - trust boundaries, mutation controls, and secret-handling posture across CLI, MCP, gateway, and SDKs
- [`docs/trust/support-matrix.md`](./docs/trust/support-matrix.md)
  - support status and guarantees for local CLI, MCP transports, SDKs, benchmarks, and packaged docs

## Standalone SDKs And Contract Export

Current shipped consumer paths:
- TypeScript/Node:
  - standalone package identity: `@pandora/agent-sdk`
  - current external install path: signed GitHub release tarball attached to the tagged Pandora release
  - unpacked tree path: `sdk/typescript` for maintainers and in-tree consumers
  - vendored root-package copy: `pandora-cli-skills/sdk/typescript`
- Python:
  - standalone package identity: `pandora-agent`
  - current external install path: signed GitHub release wheel or sdist attached to the tagged Pandora release
  - embedded package source: `sdk/python` for maintainers and in-tree consumers
  - module/import name: `pandora_agent`
- Shared contract bundle:
  - standalone TypeScript package: `@pandora/agent-sdk/generated`
  - installed root-package subpath: `pandora-cli-skills/sdk/generated`
  - unpacked tree path: `sdk/generated`

```bash
npm run generate:sdk-contracts
```

Run that only from a repository checkout. The published npm package already includes the generated SDK artifacts and does not ship the repo-only generator script.

- This repository ships standalone SDK alpha packages plus vendored copies and the shared contract bundle:
  - JavaScript/TypeScript SDK package sources under `sdk/typescript`
  - Python SDK package sources under `sdk/python`
  - vendored TypeScript loader/manifest under `sdk/typescript/generated`
  - vendored Python manifest under `sdk/python/pandora_agent/generated`
  - shared JS contract export under `sdk/generated`
- `capabilities.data.transports.sdk` reports `supported=true` and `status="alpha"` in current builds.
- Export `capabilities` for compact routing, transport, and digest metadata.
- Export `schema` for authoritative JSON Schema definitions and per-command descriptors.
- In a repository checkout, `npm run generate:sdk-contracts` regenerates the shared export in `sdk/generated` plus the standalone SDK package-local copies in `sdk/typescript/generated` and `sdk/python/pandora_agent/generated`.
- Standalone SDK consumers should prefer the standalone package entrypoints and package-local generated artifacts:
  - TypeScript SDK package identity: `@pandora/agent-sdk`
  - TypeScript generated bundle subpath: `@pandora/agent-sdk/generated`
  - Python SDK package identity: `pandora-agent`
  - use signed GitHub release assets as the external installation path unless a release explicitly announces public npm/PyPI publication
- Current release/distribution status:
  - standalone SDK artifacts are built and verified in release flow
  - public npm/PyPI publication is not claimed by this guide yet
- This shareable root package also vendors matching copies:
  - TypeScript client: `pandora-cli-skills/sdk/typescript`
  - shared contract bundle: `pandora-cli-skills/sdk/generated`
  - vendored manifests: `sdk/typescript/generated/manifest.json` and `sdk/python/pandora_agent/generated/manifest.json`
- Raw `capabilities` / `schema` exports remain available for custom generators.
- Rebuild any generated client layer when `commandDescriptorVersion` or `registryDigest.descriptorHash` changes.
- Use `pandora mcp` for local stdio SDK/MCP execution, or intentionally hosted `pandora mcp http ...` for remote streamable HTTP execution instead of local code generation.

## Policy And Profile Status

- `pandora mcp http` enforces bearer-token scopes from `--auth-scopes` against each tool's declared `policyScopes`.
- `capabilities.data.policyProfiles.policyPacks` reports `supported=true` and `status="alpha"` in current builds. Use `policy list|get|lint` to inspect the shipped packs.
- `capabilities.data.policyProfiles.signerProfiles` reports `supported=true` and `status="alpha"` in current builds. Use `profile list|get|explain|validate` to inspect the shipped/sample profiles and readiness metadata.
- `bootstrap` is the canonical recommendation surface for cold agents:
  - `defaults.policyId` / `defaults.profileId`
  - `policyProfiles.policyPacks.recommendedReadOnlyPolicyId` / `recommendedMutablePolicyId`
  - `policyProfiles.signerProfiles.recommendedReadOnlyProfileId` / `recommendedMutableProfileId`
  - `nextSteps[]`
- Keep using `bootstrap` first for defaults, and use `policy explain`, `policy recommend`, or `profile recommend` when the agent already knows the exact workflow context it wants to evaluate.
- Compatibility aliases stay hidden by default; opt in only for legacy/debug inspection, not routine planning.
- The signer-profile payload now separates implementation status from runtime readiness:
  - implementation fields: `implementedBackends`, `placeholderBackends`
  - runtime fields: `readyBuiltinIds`, `degradedBuiltinIds`, `placeholderBuiltinIds`, `pendingBuiltinIds`
  - backend rollup: `backendStatuses`
  - vocabulary: `statusAxes`
- The built-in read-only bootstrap pair is `research-only` plus `market_observer_ro`.
- In the default runtime view, `market_observer_ro` is the only built-in profile reporting `ready`, and it is read-only.
- Use `pandora --output json capabilities --runtime-local-readiness` when you want the CLI to actively probe local signer/network prerequisites; under valid runtime conditions, built-in mutable profiles such as `prod_trader_a`, `dev_keystore_operator`, and `desk_signer_service` can move from `degraded` to `ready`.
- In the current runtime, no built-in mutable profile is ready:
  - `prod_trader_a` resolves as `missing-secrets`
  - `dev_keystore_operator` resolves as `missing-keystore`
  - `desk_signer_service` resolves as `missing-context`
- Treat `degraded` as the backend-level summary only. The exact reason lives in the profile payload:
  - `profile list` for `runtimeReady` and `resolutionStatus`
  - `profile get --id <profile-id>` for raw `resolution`
  - `profile explain --id <profile-id> [--command <tool>] [--mode <mode>] [--policy-id <id>] [--chain-id <id>] [--category <id|name>]` for the exact decision surface:
    - prefer canonical command names from `bootstrap`, `capabilities`, or `schema` when filling `--command`
    - `explanation.requestedContext.exact` tells you whether the evaluation is complete
    - `explanation.requestedContext.missingFlags` tells you what to add before trusting the result
    - `explanation.remediation[]` is the machine-usable action list; `blockers` is the human-readable summary
- Do not assume a global `--policy` or `--profile` selector exists across every mutating family yet.
- For current live automation, prefer scoped gateway tokens plus env-based signer injection over raw command-line private keys.

## Mirror operator guidance
- `mirror plan|deploy|go` use a sports-aware suggested `targetTimestamp`; they do not rely on a generic `+1h` rule.
- Use `--target-timestamp <unix|iso>` only for explicit close-time overrides.
- Fresh `mirror deploy` / `mirror go` runs require at least two independent public resolution URLs from different hosts in `--sources`.
- Polymarket, Gamma, and CLOB URLs are discovery inputs only and are not valid `--sources`.
- Validation is exact-payload:
  - validate the final `question`, `rules`, `sources`, and `targetTimestamp`
  - rerun CLI execute with `--validation-ticket <ticket>`
  - rerun MCP execute/live with `agentPreflight = { validationTicket, validationDecision: "PASS", validationSummary }`
- `sports create run` does not expose a CLI `--validation-ticket`; agent-controlled execute uses `agentPreflight` / `PANDORA_AGENT_PREFLIGHT`.

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
