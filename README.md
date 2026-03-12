# Pandora CLI & Skills

Pandora is a prediction-market runtime for agents, operators, and integrators. It gives you three ways to work with the same capability surface:

- `MCP` for agents that need Pandora tools
- `CLI` for humans, scripts, and CI
- `SDK` for applications that embed Pandora in code

```text
+----------------------------------------------------------------------------------+
| Start read-only.                                                                 |
| Learn the contract surface first.                                                |
| Add policy scopes, signer profiles, and secrets only on the runtime that         |
| actually needs to execute mutable work.                                          |
+----------------------------------------------------------------------------------+
```

```text
+----------------------- README MAP -----------------------+
| humans  -> install, inspect, follow task guides          |
| agents  -> bootstrap, schema, MCP, policy/profile checks |
| trust   -> release verification, security, support       |
| sdk     -> TypeScript, Python, generated contracts       |
+----------------------------------------------------------+
```

## External Users

If you are evaluating Pandora for external use, start here instead of reading the full repo top to bottom.

### Which path should you use?

| If you want to... | Use | Why |
| --- | --- | --- |
| Let an agent call Pandora tools | `MCP` | Fastest path for Claude, Codex, and other MCP-capable agents |
| Run Pandora yourself in terminal, automation, or CI | `CLI` | Best for deterministic commands and operator workflows |
| Build a product or custom integration on top of Pandora | `SDK` | Best for application code that needs library access |

### Recommended install paths

- Agent users: start with `npm install && npx pandora mcp`
- CLI users: start with `npm install && npx pandora help`
- Builders: start with [`sdk/typescript/README.md`](./sdk/typescript/README.md) or [`sdk/python/README.md`](./sdk/python/README.md)

### Practical recommendation

- If the goal is "my agent should be able to use Pandora", choose `MCP`.
- If the goal is "I want to run commands or automate workflows", choose the `CLI`.
- If the goal is "I am writing software on top of Pandora", choose the `SDK`.
- Most external users should start with `MCP` or `CLI`, not the `SDK`.

## Start Here

If you want the main documentation map, use these jump points:

- Anthropic skill install: [`docs/skills/install-anthropic-skill.md`](./docs/skills/install-anthropic-skill.md)
- Humans: [`docs/skills/command-reference.md`](./docs/skills/command-reference.md)
- Agents: [`docs/skills/agent-quickstart.md`](./docs/skills/agent-quickstart.md)
- MCP / JSON contracts: [`docs/skills/agent-interfaces.md`](./docs/skills/agent-interfaces.md)
- Policy packs / signer profiles: [`docs/skills/policy-profiles.md`](./docs/skills/policy-profiles.md)
- Release trust: [`docs/trust/release-verification.md`](./docs/trust/release-verification.md)
- Security posture: [`docs/trust/security-model.md`](./docs/trust/security-model.md)
- Support guarantees: [`docs/trust/support-matrix.md`](./docs/trust/support-matrix.md)
- Root doc router: [`SKILL.md`](./SKILL.md)

## For Humans

Use this path if you want the repo explained in order and prefer detailed guidance over terse machine contracts.

### Anthropic skill install

If you want Claude.ai or Claude Code to use Pandora as a skill, start here:

- [`docs/skills/install-anthropic-skill.md`](./docs/skills/install-anthropic-skill.md)

Use the generated Anthropic skill bundle from the packaging flow. Do **not** zip and upload the repo root as a skill.
Build it with `npm run pack:anthropic-skill`, then upload `dist/pandora-skill.zip` in Claude.ai or install `dist/pandora-skill/` in Claude Code.

### Detailed setup

```bash
npm install
npm run init-env
npm run doctor
npm run build
npx pandora help
```

What each step is for:

- `npm install`: install the local CLI and docs/test dependencies
- `npm run init-env`: scaffold the expected environment inputs
- `npm run doctor`: inspect local runtime readiness before live work
- `npm run build`: run the repo’s verification gates, including docs, trust, SDK parity, and benchmark checks
- `npx pandora help`: browse the command surface manually

### Human reading order

1. [`docs/skills/command-reference.md`](./docs/skills/command-reference.md) for the command families and flags.
2. [`docs/skills/trading-workflows.md`](./docs/skills/trading-workflows.md) for discover -> quote -> trade -> claim flows.
3. [`docs/skills/mirror-operations.md`](./docs/skills/mirror-operations.md) for mirror planning, validation, deploy, sync, and status.
4. [`docs/skills/portfolio-closeout.md`](./docs/skills/portfolio-closeout.md) for portfolio inspection, LP exits, and closeout.
5. [`docs/trust/release-verification.md`](./docs/trust/release-verification.md) before installs, release checks, or operator handoff.

If you are testing the Anthropic skill itself rather than the repo manually, use the install guide first and then come back to the docs above for deeper workflow detail.

### Safe human-first discovery

If you want to explore without touching signer material:

```bash
npx pandora --output json bootstrap
npx pandora --output json capabilities
npx pandora --output json schema
npx pandora --output json policy list
npx pandora --output json profile list
```

Those commands are the preferred front door for both humans and agents because they expose the current surface area without assuming execution readiness.

## For Agents

Use this path if the consumer is an LLM, automation runtime, SDK client, or MCP host.

### Choose the operating model first

#### Self-custody local runtime

Use this when the agent should execute with the user's own wallet and signer material.

- run `pandora mcp` locally, or `pandora mcp http` on the user's own machine or server
- keep signer material on the user's own runtime
- prefer this path for live execution with user-owned funds

#### Hosted read-only / planning gateway

Use this when you want a shared remote endpoint for discovery, bootstrap, schema inspection, recipes, planning, audit, and receipts.

- host `pandora mcp http` centrally
- keep the shared gateway read-only by default
- only add hosted mutation if you explicitly want a BYO-signer or custodial model
- do not require self-custody users to route live execution through the shared gateway

### One command: bootstrap the contract

```bash
npm install && npx pandora --output json bootstrap
```

Use `bootstrap` first for canonical tools, recommended next steps, default policy/profile hints, and doc routing.

### One command: start local stdio MCP

```bash
npm install && npx pandora mcp
```

Use local stdio MCP when the agent runs on the same machine as Pandora. This is the default self-custody path for live execution.

### One command: host remote read-only HTTP MCP

```bash
npm install && npx pandora mcp http --auth-scopes capabilities:read,contracts:read,help:read,schema:read,operations:read,scan:read,quote:read,portfolio:read,mirror:read,sports:read,network:indexer,network:rpc,network:polymarket,network:sports
```

Use remote HTTP MCP only when you intentionally want external agents to connect over the network. Start with read-only scopes and widen later. For most teams, this gateway should be the shared discovery and planning surface, not the default home of user signer material.

### Recommended agent order

```text
bootstrap
  -> capabilities
  -> schema
  -> policy list
  -> profile list
  -> profile explain (only when mutation is actually needed)
```

### Agent-first docs

- [`docs/skills/agent-quickstart.md`](./docs/skills/agent-quickstart.md): fastest safe bootstrap path
- [`docs/skills/agent-interfaces.md`](./docs/skills/agent-interfaces.md): JSON envelopes, schema, MCP, recovery, and error contracts
- [`docs/skills/policy-profiles.md`](./docs/skills/policy-profiles.md): policy packs, signer profiles, gateway scopes, and readiness guidance
- [`docs/skills/recipes.md`](./docs/skills/recipes.md): reusable safe workflows compiled from ordinary Pandora commands

## Recommendations

- Prefer `bootstrap` over raw `help` output when the caller is an agent.
- Prefer canonical tool names. Only use compatibility aliases for legacy callers or migration diffing.
- Prefer self-custody local runtimes for live execution with user-owned funds.
- Prefer a hosted HTTP gateway for shared discovery, planning, schema, recipes, audit, and receipt retrieval.
- Prefer read-only planning first. Do not provision secrets until `requiresSecrets`, `policyScopes`, and `profile explain` say the workflow actually needs them.
- Prefer `--profile-id` or `--profile-file` over raw `--private-key` when a command family supports profile-directed execution.
- Prefer `pandora mcp` for local agents and `pandora mcp http` for intentionally hosted remote agents.
- Prefer `operations list|get|receipt|verify-receipt` when you need persisted state or audit evidence for mutable work.
- Prefer the trust docs before install, release verification, or external sharing of artifacts.

## Critical Safety Rules

- `mirror plan|deploy|go` do not use a generic `+1h` close rule. They use a sports-aware suggested `targetTimestamp`.
- `mirror deploy|go` requires at least 2 independent public resolution URLs from different hosts in `--sources`.
- Polymarket, Gamma, and CLOB URLs are discovery inputs only. They are not valid resolution sources.
- Validation is payload-exact. Reuse the validation ticket or `agentPreflight` data for execute/live reruns.
- Treat mutable profiles as not ready until `profile explain` confirms the exact tool, mode, and runtime context are usable.

## Common Paths

### Discovery and planning

```bash
npx pandora --output json bootstrap
npx pandora --output json capabilities
npx pandora --output json schema
npx pandora scan --output json --limit 10
```

### Pricing before mutation

```bash
npx pandora quote --output json --market-address 0x... --side yes --amount-usdc 25
```

### Local runtime checks

```bash
npm run doctor
npx pandora --output json profile list
npx pandora --output json profile explain --id market_observer_ro
```

## Docs By Task

- General command surface: [`docs/skills/command-reference.md`](./docs/skills/command-reference.md)
- Trading and claim flows: [`docs/skills/trading-workflows.md`](./docs/skills/trading-workflows.md)
- Mirror planning and operations: [`docs/skills/mirror-operations.md`](./docs/skills/mirror-operations.md)
- Portfolio and closeout: [`docs/skills/portfolio-closeout.md`](./docs/skills/portfolio-closeout.md)
- Capability map and category routing: [`docs/skills/capabilities.md`](./docs/skills/capabilities.md)
- Agent bootstrap: [`docs/skills/agent-quickstart.md`](./docs/skills/agent-quickstart.md)
- Agent interface contracts: [`docs/skills/agent-interfaces.md`](./docs/skills/agent-interfaces.md)
- Policies, profiles, and scopes: [`docs/skills/policy-profiles.md`](./docs/skills/policy-profiles.md)
- Recipes: [`docs/skills/recipes.md`](./docs/skills/recipes.md)
- Benchmarks and scorecards: [`docs/benchmarks/README.md`](./docs/benchmarks/README.md), [`docs/benchmarks/scenario-catalog.md`](./docs/benchmarks/scenario-catalog.md), [`docs/benchmarks/scorecard.md`](./docs/benchmarks/scorecard.md)
- Trust and release posture: [`docs/trust/release-verification.md`](./docs/trust/release-verification.md), [`docs/trust/release-bundle-playbook.md`](./docs/trust/release-bundle-playbook.md), [`docs/trust/security-model.md`](./docs/trust/security-model.md), [`docs/trust/support-matrix.md`](./docs/trust/support-matrix.md)

## SDK Surfaces

- TypeScript SDK: [`sdk/typescript/README.md`](./sdk/typescript/README.md)
- Python SDK: [`sdk/python/README.md`](./sdk/python/README.md)
- Shared generated contracts: `sdk/generated`

Notes:

- The shipped SDK surfaces are alpha.
- The SDK is for developers embedding Pandora in their own code. It is not the default path for ordinary agent usage or shell automation.
- The repository also vendors matching generated manifests under `sdk/typescript/generated` and `sdk/python/pandora_agent/generated`.
- Use the SDK-local manifests first when embedding Pandora in a client.

## Repository Layout

```text
.
|-- cli/                  CLI entrypoint and runtime surface
|-- docs/skills/          operator and agent documentation
|-- docs/trust/           release, security, and support docs
|-- docs/benchmarks/      benchmark methodology and scorecards
|-- sdk/typescript/       TypeScript SDK surface
|-- sdk/python/           Python SDK surface
|-- sdk/generated/        shared generated contract bundle
|-- references/           contracts and protocol references
|-- scripts/              build, trust, benchmark, and release helpers
`-- tests/                CLI, MCP, workflow, and smoke coverage
```

## Minimal Install Facts

- Node.js `>=18`
- Package bin: `pandora`
- Main repo homepage: this README
- Shareable/sanitized companion guide: [`README_FOR_SHARING.md`](./README_FOR_SHARING.md)

## Short Version

```text
Anthropic skill? Install the generated bundle -> test with Pandora-specific prompts -> keep repo root out of skill upload.
Human?  Install -> doctor -> build -> read command/workflow docs.
Agent?  bootstrap -> capabilities -> schema -> policy/profile -> MCP.
Live?   Add scopes and secrets only after exact readiness checks pass.
```
