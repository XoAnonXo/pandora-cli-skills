# Agent Quickstart

Use this file when an external agent needs the fastest safe bootstrap path into Pandora.

For release verification and support posture before you even start the runtime:
- [`../trust/release-verification.md`](../trust/release-verification.md)
- [`../trust/support-matrix.md`](../trust/support-matrix.md)

## Goal
Get an agent from zero to safe tool usage without starting from raw secrets or the full command reference.

## Preferred bootstrap order

### 1. Discover the live contract
```bash
pandora --output json capabilities
pandora --output json schema
pandora --output json policy list
pandora --output json profile list
```

Use:
- `capabilities` for compact routing, risk/idempotency hints, transports, and documentation pointers
- `schema` for authoritative tool inputs/outputs
- `policy list` to inspect what the runtime should allow
- `profile list` to inspect what signer backends are available and which built-ins are actually runtime-ready

### 2. Decide the execution transport

#### Local stdio MCP
Use when the agent is running on the same machine as Pandora.

```bash
pandora mcp
```

#### Remote streamable HTTP MCP
Use when external agents should connect remotely without shelling out.

```bash
pandora mcp http --auth-scopes capabilities:read,contracts:read,help:read,schema:read,policy:read,profile:read,operations:read,scan:read,quote:read,portfolio:read,mirror:read,sports:read,network:indexer,network:rpc,network:polymarket,network:sports
```

Notes:
- if `--auth-token` and `--auth-token-file` are omitted, Pandora generates a bearer token at `~/.pandora/mcp-http/auth-token`
- if the runtime cannot resolve a home directory, pass `--auth-token` or `--auth-token-file` explicitly instead of relying on auto-generated storage
- use `--public-base-url` when the bind address is not the public URL agents should see
- the full read-only planning scope set above covers `help`, `capabilities`, `schema`, `policy.*`, `profile.*`, `operations.list|get`, plus `scan`, `quote`, `portfolio`, `mirror.plan`, and `sports.create.plan`
- if you omit `--auth-scopes`, Pandora now defaults to a conservative bootstrap scope set: `capabilities:read,contracts:read,help:read,schema:read,policy:read,profile:read,operations:read`
- if you only need catalog bootstrap, use that same conservative scope set explicitly
- add `operations:write` only when the remote runtime must call `operations.cancel` or `operations.close`; over MCP those mutating calls also require `intent.execute=true`

### 3. Only then decide whether the agent needs secrets
- many discovery, schema, policy, profile, and analysis paths are read-only
- check `requiresSecrets` and `policyScopes` from `capabilities` or `schema` before provisioning signer material
- check signer-profile readiness fields such as `readyBuiltinIds`, `pendingBuiltinIds`, and per-profile `runtimeReady` before assuming a mutable profile is usable
- do not start with `--private-key`

## Recommended agent bootstrap patterns

### Read-only research agent
1. `capabilities`
2. `schema`
3. `policy list`
4. `profile list`
5. `pandora mcp` or `pandora mcp http --auth-scopes capabilities:read,contracts:read,help:read,schema:read,policy:read,profile:read,operations:read,scan:read,quote:read,portfolio:read,mirror:read,sports:read,network:indexer,network:rpc,network:polymarket,network:sports`

### Live execution agent
1. perform the read-only bootstrap above
2. choose the smallest policy scopes required by the target tools
3. provision signer material only on the execution runtime
4. use validation-first flows for mutable tools

## SDK bootstrap

### TypeScript
- package: `sdk/typescript`
- generated manifest/loader: `sdk/typescript/generated`

### Python
- package: `sdk/python/pandora_agent`
- generated manifest: `sdk/python/pandora_agent/generated`

### Shared contract export
- `sdk/generated` (shared root contract bundle used by embedded SDK fallbacks in the published root package)

Regenerate all shipped SDK artifacts from a repository checkout with:
```bash
npm run generate:sdk-contracts
```

## First commands agents should prefer

### Discovery
```bash
pandora --output json capabilities
pandora --output json schema
pandora scan --output json --limit 10
```

### Pricing before mutation
```bash
pandora quote --output json --market-address 0x... --side yes --amount-usdc 25
```

### Portfolio and closeout
```bash
pandora portfolio --output json --wallet 0x...
pandora operations list --output json --limit 20
```

### Mirror and sports preflight
```bash
pandora mirror plan --output json --source polymarket --polymarket-slug <slug>
pandora sports create plan --output json --event-id <id>
```

## What agents should not do first
- do not start with `trade --execute`, `sell --execute`, `mirror deploy --execute`, or `sports create run --execute`
- do not assume a universal `--profile` selector exists yet
- do not use Polymarket discovery URLs as mirror resolution `--sources`
- do not reuse validation material if `question`, `rules`, `sources`, or `targetTimestamp` changed

## Where to go next
- command selection and canonical paths:
  - [`capabilities.md`](./capabilities.md)
- JSON/MCP/runtime contracts:
  - [`agent-interfaces.md`](./agent-interfaces.md)
- policy packs and signer profiles:
  - [`policy-profiles.md`](./policy-profiles.md)
- concrete trading workflow:
  - [`trading-workflows.md`](./trading-workflows.md)
- portfolio and closeout workflow:
  - [`portfolio-closeout.md`](./portfolio-closeout.md)
