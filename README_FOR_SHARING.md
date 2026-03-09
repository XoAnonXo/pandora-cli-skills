# Pandora CLI & Skills — Shareable Package

Sanitized, shareable copy of the Pandora CLI docs, SDK surfaces, generated contracts, and package metadata.

```text
+----------------------------------------------------------------------------------+
| This bundle is meant for review, integration, and safe bootstrap.                |
| It excludes local secrets and runtime-only state.                                |
| Start read-only, confirm the contract surface, then add execution context only   |
| on the runtime that will actually perform mutable work.                          |
+----------------------------------------------------------------------------------+
```

```text
+--------------------- SHAREABLE PACKAGE MAP ---------------------+
| humans  -> install, inspect docs, understand workflows         |
| agents  -> bootstrap, schema, MCP, policies, profiles          |
| trust   -> verify release and support posture                  |
| bundle  -> see what is included vs intentionally omitted       |
+----------------------------------------------------------------+
```

## Start Here

- Anthropic skill install: [`docs/skills/install-anthropic-skill.md`](./docs/skills/install-anthropic-skill.md)
- Main landing page: [`README.md`](./README.md)
- Agent bootstrap: [`docs/skills/agent-quickstart.md`](./docs/skills/agent-quickstart.md)
- Command reference: [`docs/skills/command-reference.md`](./docs/skills/command-reference.md)
- Agent contracts / MCP: [`docs/skills/agent-interfaces.md`](./docs/skills/agent-interfaces.md)
- Policies and signer profiles: [`docs/skills/policy-profiles.md`](./docs/skills/policy-profiles.md)
- Trust and release verification: [`docs/trust/release-verification.md`](./docs/trust/release-verification.md)
- Security model: [`docs/trust/security-model.md`](./docs/trust/security-model.md)
- Support matrix: [`docs/trust/support-matrix.md`](./docs/trust/support-matrix.md)

## What This Package Includes

```text
docs/
  skills/               human and agent documentation
  trust/                release, security, and support docs
  benchmarks/           benchmark methodology and scorecards
sdk/
  typescript/           TypeScript SDK surface
  python/               Python SDK surface
  generated/            shared contract bundle
cli/                    packaged CLI entrypoint
references/             contracts and protocol references
scripts/.env.example    sample environment scaffold
```

Included files of interest:

- `README.md`
- `README_FOR_SHARING.md`
- `SKILL.md`
- `docs/skills/*.md`
- `docs/trust/*.md`
- `docs/benchmarks/**`
- `benchmarks/latest/core-report.json`
- `sdk/generated/*`
- `sdk/typescript/**`
- `sdk/python/**`
- `package.json`
- `package-lock.json`
- `scripts/.env.example`
- `scripts/create_market_launcher.ts`
- `scripts/create_polymarket_clone_and_bet.ts`
- `scripts/release/install_release.sh`
- `references/creation-script.md`
- `references/contracts.md`
- `references/checklist.md`

## What Is Intentionally Omitted

- `.env`
- `wallet.json`
- local runtime secrets
- local mutable runtime state
- `node_modules`

Packaging note:

- The published package ships docs, SDK surfaces, generated contracts, and benchmark/trust artifacts.
- Full maintainer-only release machinery and local secret material are intentionally not part of the shareable surface.

## For Humans

Use this path if you want to inspect the package safely and understand the repo before any live setup.

### Anthropic skill install

If you want to install Pandora as a Claude skill, use the dedicated guide:

- [`docs/skills/install-anthropic-skill.md`](./docs/skills/install-anthropic-skill.md)

Important:

- build the Anthropic skill with `npm run pack:anthropic-skill`
- install `dist/pandora-skill/` or `dist/pandora-skill.zip`
- do **not** upload the repo root as a skill
- keep Pandora runtime setup separate from skill installation

### Detailed setup

```bash
npm install
npx pandora --output json bootstrap
npx pandora --output json capabilities
npx pandora --output json schema
npx pandora --output json policy list
npx pandora --output json profile list
npx pandora help
```

### Human reading order

1. [`README.md`](./README.md) for the main landing page and task routing.
2. [`docs/skills/install-anthropic-skill.md`](./docs/skills/install-anthropic-skill.md) for Claude.ai and Claude Code skill installation.
3. [`docs/skills/command-reference.md`](./docs/skills/command-reference.md) for command families and flags.
4. [`docs/skills/trading-workflows.md`](./docs/skills/trading-workflows.md) for discover -> quote -> trade -> claim flows.
5. [`docs/skills/mirror-operations.md`](./docs/skills/mirror-operations.md) for mirror-specific planning and validation.
6. [`docs/trust/release-verification.md`](./docs/trust/release-verification.md) before install verification or external handoff.

### Optional live setup

Only do this on the runtime that will sign live transactions:

```bash
npm run init-env
npm run doctor
```

Then populate only the environment variables your live workflow actually requires, such as:

- `CHAIN_ID`
- `PRIVATE_KEY`
- `RPC_URL`
- `ORACLE`
- `FACTORY`
- `USDC`

Optional Polymarket hedge inputs:

- `POLYMARKET_PRIVATE_KEY`
- `POLYMARKET_FUNDER`
- `POLYMARKET_API_KEY`
- `POLYMARKET_API_SECRET`
- `POLYMARKET_API_PASSPHRASE`
- `POLYMARKET_HOST`

## For Agents

Use this path if the package is being consumed by an LLM, MCP client, SDK wrapper, or automation runtime.

### One command: bootstrap the contract

```bash
npm install && npx pandora --output json bootstrap
```

### One command: start local stdio MCP

```bash
npm install && npx pandora mcp
```

### One command: host remote read-only HTTP MCP

```bash
npm install && npx pandora mcp http --auth-scopes capabilities:read,contracts:read,help:read,schema:read,operations:read,scan:read,quote:read,portfolio:read,mirror:read,sports:read,network:indexer,network:rpc,network:polymarket,network:sports
```

### Recommended agent order

```text
bootstrap
  -> capabilities
  -> schema
  -> policy list
  -> profile list
  -> recipe list
  -> profile explain (only when a mutable path is selected)
```

### Agent recommendations

- Start with `bootstrap`; it is the canonical recommendation surface.
- Use `schema` for machine authority and `capabilities` for compact routing.
- Use `policy list` and `profile list` before asking for execution credentials.
- Use `profile explain` for the exact go/no-go answer before mutable execution.
- Start remote MCP with the minimum bearer-token scopes needed by the selected tool family.
- Use canonical tool names by default; only opt into compatibility aliases for debugging or migration.

## Critical Safety Rules

- `mirror plan|deploy|go` uses a sports-aware suggested `targetTimestamp`, not a generic `+1h` rule.
- `mirror deploy|go` requires at least 2 independent public resolution URLs from different hosts in `--sources`.
- Polymarket, Gamma, and CLOB URLs are discovery inputs only. They are not valid resolution sources.
- Validation is exact-payload; reuse validation tickets or `agentPreflight` payloads for execute/live reruns.
- Do not treat a mutable profile as ready until `profile explain` confirms the exact command, mode, and runtime context.

## Shareable Bundle Recommendations

- Prefer this package for review, contract inspection, and integration planning.
- Prefer the generated Anthropic skill bundle when the goal is Claude.ai / Claude Code skill installation.
- Prefer read-only bootstrap commands first; they work without signer material.
- Prefer environment variables or a secret-manager wrapper over raw command-line private keys.
- Prefer shipped docs and trust artifacts over copying operational assumptions from old notes.
- Prefer the SDK-local manifests under `sdk/typescript/generated` and `sdk/python/pandora_agent/generated` when embedding the shipped SDKs.

## Docs By Task

- Main landing page: [`README.md`](./README.md)
- Command surface: [`docs/skills/command-reference.md`](./docs/skills/command-reference.md)
- Trading workflows: [`docs/skills/trading-workflows.md`](./docs/skills/trading-workflows.md)
- Mirror operations: [`docs/skills/mirror-operations.md`](./docs/skills/mirror-operations.md)
- Portfolio and closeout: [`docs/skills/portfolio-closeout.md`](./docs/skills/portfolio-closeout.md)
- Capabilities and category routing: [`docs/skills/capabilities.md`](./docs/skills/capabilities.md)
- Agent bootstrap: [`docs/skills/agent-quickstart.md`](./docs/skills/agent-quickstart.md)
- MCP and JSON interfaces: [`docs/skills/agent-interfaces.md`](./docs/skills/agent-interfaces.md)
- Policies, profiles, and scopes: [`docs/skills/policy-profiles.md`](./docs/skills/policy-profiles.md)
- Recipes: [`docs/skills/recipes.md`](./docs/skills/recipes.md)
- Benchmarks: [`docs/benchmarks/README.md`](./docs/benchmarks/README.md), [`docs/benchmarks/scenario-catalog.md`](./docs/benchmarks/scenario-catalog.md), [`docs/benchmarks/scorecard.md`](./docs/benchmarks/scorecard.md)
- Trust docs: [`docs/trust/release-verification.md`](./docs/trust/release-verification.md), [`docs/trust/release-bundle-playbook.md`](./docs/trust/release-bundle-playbook.md), [`docs/trust/security-model.md`](./docs/trust/security-model.md), [`docs/trust/support-matrix.md`](./docs/trust/support-matrix.md)

## SDK Surfaces

- TypeScript SDK: [`sdk/typescript/README.md`](./sdk/typescript/README.md)
- Python SDK: [`sdk/python/README.md`](./sdk/python/README.md)
- Shared generated contracts: `sdk/generated`

Status notes:

- The shipped SDK surfaces are alpha.
- The shared package vendors matching manifests and generated contract data.
- External install/publication details should be confirmed against the tagged release and trust docs.

## Short Version

```text
Anthropic skill?  Upload the generated bundle -> test with Pandora-specific prompts -> keep repo root out of the upload.
Human?  Install -> bootstrap -> read docs -> run doctor only on live runtimes.
Agent?  bootstrap -> capabilities -> schema -> policy/profile -> MCP.
Share?  This bundle is sanitized; secrets and local runtime state are omitted.
```
