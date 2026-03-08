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
- start with `capabilities`, `schema`, `policy list`, `profile list`, and `recipe list`; none of those require signer material
- use `pandora mcp` for local stdio tool execution
- use `pandora mcp http --auth-scopes ...` when you intentionally want a remote MCP gateway
- for a remote read-only planning token that covers `scan`, `quote`, `portfolio`, `mirror plan`, `sports create plan`, and `operations list|get`, use `capabilities:read,contracts:read,documentation:read,policy:read,profile:read,operations:read,scan:read,quote:read,portfolio:read,mirror:read,sports:read,network:indexer,network:rpc,network:polymarket,network:sports`
- add `operations:write` only when the remote runtime needs `operations cancel|close`; over MCP those mutating calls also require `intent.execute=true`
- give the agent the minimum bearer-token scopes it needs
- only provision signing secrets on the runtime that will actually execute live mutating tools
- if you are embedding the shipped SDKs, use each package's own generated artifacts:
  - `sdk/typescript/generated` for the embedded TypeScript loader/manifest
  - `sdk/python/pandora_agent/generated` for the embedded Python manifest
  - `sdk/generated` for the shared JS contract export

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
- Current builds ship policy packs and named profiles in alpha via `policy list|get|lint` and `profile list|get|validate`.
- Current builds also ship first-party recipes in alpha via `recipe list|get|validate|run`.
- Current live command execution still commonly resolves signer secrets from flags/env during rollout.
- Do not assume every built-in signer profile is runtime-ready:
  - implemented backends today: `read-only`, `local-env`
  - planning/placeholder sample backends: `external-signer`, `local-keystore`
  - current built-in ready profile: `market_observer_ro`
  - current built-in pending profiles: `prod_trader_a`, `dev_keystore_operator`, `desk_signer_service`
- Prefer process env, `.env`, or your own secret-manager wrapper that materializes those env vars before launching Pandora.
- Avoid putting raw `--private-key` values on the command line unless you explicitly need a one-off manual override.
- There is not yet a universal `--profile` selector across mutating commands.

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

## SDK And Contract Export

```bash
npm run generate:sdk-contracts
```

Run that only from a repository checkout. The published npm package already includes the generated SDK artifacts and does not ship the repo-only generator script.

- This package ships SDK alpha source/artifact surfaces:
  - JavaScript/TypeScript SDK entrypoints under `sdk/typescript`
  - TypeScript embedded loader/manifest under `sdk/typescript/generated`
  - Python SDK source/package under `sdk/python`
  - Python embedded manifest under `sdk/python/pandora_agent/generated`
  - shared JS contract export under `sdk/generated`
- `capabilities.data.transports.sdk` reports `supported=true` and `status="alpha"` in current builds.
- Export `capabilities` for compact routing, transport, and digest metadata.
- Export `schema` for authoritative JSON Schema definitions and per-command descriptors.
- In a repository checkout, `npm run generate:sdk-contracts` regenerates the shared export in `sdk/generated` plus the standalone SDK-local generated copies in `sdk/typescript/generated` and `sdk/python/pandora_agent/generated`.
- In the published root package, the shared JSON contract bundle is stored once under `sdk/generated`; embedded SDK loaders/manifests route to that shared bundle instead of duplicating it.
- SDK consumers should prefer the package-local manifests/artifacts they ship with:
  - TypeScript: `sdk/typescript/generated/manifest.json`
  - Python: `sdk/python/pandora_agent/generated/manifest.json`
- Raw `capabilities` / `schema` exports remain available for custom generators.
- Rebuild any generated client layer when `commandDescriptorVersion` or `registryDigest.descriptorHash` changes.
- Use `pandora mcp` for local stdio SDK/MCP execution, or intentionally hosted `pandora mcp http ...` for remote streamable HTTP execution instead of local code generation.

## Policy And Profile Status

- `pandora mcp http` enforces bearer-token scopes from `--auth-scopes` against each tool's declared `policyScopes`.
- `capabilities.data.policyProfiles.policyPacks` reports `supported=true` and `status="alpha"` in current builds. Use `policy list|get|lint` to inspect the shipped packs.
- `capabilities.data.policyProfiles.signerProfiles` reports `supported=true` and `status="alpha"` in current builds. Use `profile list|get|validate` to inspect the shipped/sample profiles and readiness metadata.
- The signer-profile payload also exposes `implementedBackends`, `placeholderBackends`, `readyBuiltinIds`, and `pendingBuiltinIds`.
- The built-in read-only bootstrap pair is `research-only` plus `market_observer_ro`.
- Do not assume a global `--policy` or `--profile` selector exists across mutating commands yet.
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
