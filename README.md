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

## Agent-first onboarding

Use this path when the consumer is an agent, not a human operator:

```bash
# 1) discover the live contract
pandora --output json capabilities
pandora --output json schema
pandora --output json policy list
pandora --output json profile list

# 2) start local stdio MCP, or intentionally host remote MCP
pandora mcp
# or
pandora mcp http [--auth-scopes <csv>]
```

If you are embedding the shipped SDKs instead of only consuming raw JSON:
- local SDK execution maps to `pandora mcp` over stdio
- remote SDK execution maps to intentionally hosted `pandora mcp http ...` plus a bearer token
- the shared JS contract export remains under `sdk/generated`
- the embedded TypeScript SDK keeps a local loader and manifest under `sdk/typescript/generated`, but the heavy generated JSON artifacts are shared from `sdk/generated` in the published root package
- the embedded Python SDK keeps a local manifest under `sdk/python/pandora_agent/generated` and falls back to `sdk/generated` for heavy generated JSON artifacts in the published root package

For live signing:
- current builds ship policy packs and named profiles in alpha
- current builds also ship first-party recipes in alpha via `recipe list|get|validate|run`
- inspect them with `policy list|get|lint` and `profile list|get|validate` before exposing tools to an agent
- do not assume every built-in signer profile is runtime-ready:
  - implemented backends today: `read-only`, `local-env`
  - planning/placeholder sample backends: `external-signer`, `local-keystore`
  - current built-in ready profile: `market_observer_ro`
  - current built-in pending profiles: `prod_trader_a`, `dev_keystore_operator`, `desk_signer_service`
- there is not yet a universal `--profile` selector across mutating commands, so live execution still commonly resolves signing material from env / `.env` / explicit flags
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

## SDK And Contract Export

```bash
npm run generate:sdk-contracts
```

Run that only from a repository checkout. The published npm package ships the generated SDK artifacts already and does not include the repo-only generator script.

- This package ships SDK alpha source/artifact surfaces:
  - JavaScript/TypeScript SDK entrypoints under `sdk/typescript`
  - TypeScript embedded loader/manifest under `sdk/typescript/generated`
  - Python SDK source/package under `sdk/python`
  - Python embedded manifest under `sdk/python/pandora_agent/generated`
  - shared JS contract export under `sdk/generated`
- `capabilities.data.transports.sdk` reports `supported=true` and `status="alpha"` in current builds.
- Use `capabilities` for compact discovery, canonical tool routing, transport status, and registry digests.
- Use `schema` for the authoritative contract export: JSON envelope definitions, per-command input schemas, and `commandDescriptors`.
- In a repository checkout, `npm run generate:sdk-contracts` regenerates the shared export in `sdk/generated` and the standalone SDK-local generated copies in `sdk/typescript/generated` and `sdk/python/pandora_agent/generated`.
- In the published root package, the shared JSON contract bundle is stored once under `sdk/generated`; embedded SDK loaders/manifests route to that shared bundle instead of duplicating it.
- For embedded SDK consumers, prefer each SDK's own generated manifest/artifact entrypoints instead of hard-coding `sdk/generated`:
  - TypeScript: `sdk/typescript/generated/manifest.json`
  - Python: `sdk/python/pandora_agent/generated/manifest.json`
- Custom generators can still export raw `capabilities` / `schema` snapshots if they need bespoke codegen.
- Regenerate cached clients or derived types when `commandDescriptorVersion` or `registryDigest.descriptorHash` changes.
- For most agent bootstrap flows, start with `capabilities`, `schema`, `policy`, `profile`, or MCP before embedding the alpha SDK sources into your own code.
- For direct execution instead of local codegen, connect an SDK or MCP client to `pandora mcp` for local stdio, or intentionally host `pandora mcp http ...` for remote streamable HTTP execution.

## Policy And Signer Guidance

- Prefer scoped MCP access over broad live credentials when an agent can work through `pandora mcp http`. The gateway enforces bearer-token scopes from `--auth-scopes` against each tool's declared `policyScopes`.
- Current builds ship policy packs in alpha. `capabilities.data.policyProfiles.policyPacks` reports `supported=true` and `status="alpha"`, and `pandora --output json policy list|get|lint` exposes the available built-in/user-defined packs.
- Current builds also ship named signer profiles in alpha. `capabilities.data.policyProfiles.signerProfiles` reports `supported=true` and `status="alpha"`, and `pandora --output json profile list|get|validate` exposes sample/user profiles plus readiness metadata.
- `capabilities.data.policyProfiles.signerProfiles` also exposes `implementedBackends`, `placeholderBackends`, `readyBuiltinIds`, and `pendingBuiltinIds`.
- In current builds, treat only `market_observer_ro` as built-in runtime-ready by default unless `profile get` reports otherwise in your runtime.
- There is not yet a universal `--profile` selector across mutating commands. Live execution still commonly resolves secrets from process env, `.env`, or explicit flags while profile-directed execution rolls out.
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
