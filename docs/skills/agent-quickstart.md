# Agent Quickstart

Use this file when an external agent needs the fastest safe bootstrap path into Pandora.

For release verification and support posture before you even start the runtime:
- [`../trust/release-verification.md`](../trust/release-verification.md)
- [`../trust/support-matrix.md`](../trust/support-matrix.md)

## Goal
Get an agent from zero to safe tool usage without starting from raw secrets or the full command reference.

## Choose the operating model first

### Self-custody local runtime

Use this when the agent should execute with the user's own wallet.

- start `pandora mcp` locally, or run `pandora mcp http` on the user's own machine
- keep signer material on the same runtime the user controls
- this is the preferred path for live execution with user-owned funds

### Hosted read-only / planning gateway

Use this when you want a shared remote endpoint for:

- bootstrap
- schema and tool discovery
- recipes and recommendations
- planning, audit, receipts, and operator guidance

Keep this gateway read-only by default. Treat hosted mutation as a separate custody decision.

## Preferred bootstrap order

### 1. Discover the live contract
```bash
pandora --output json bootstrap
pandora --output json capabilities
pandora --output json schema
pandora --output json policy list
pandora --output json profile list
```

Use:
- `bootstrap` for the canonical first-call summary: principal/scopes, canonical tools, recommended next calls, policy/profile readiness, and docs/trust routing
  - canonical tools are returned by default
  - use `--include-compatibility` only for legacy/debug inspection or migration diffing
  - machine-usable default policy/profile recommendations live here:
    - `defaults.policyId` / `defaults.profileId`
    - `policyProfiles.policyPacks.recommendedReadOnlyPolicyId` / `recommendedMutablePolicyId`
    - `policyProfiles.signerProfiles.recommendedReadOnlyProfileId` / `recommendedMutableProfileId`
    - `nextSteps[]`
  - exact-context follow-up commands are also available:
    - `policy explain --id <policy-id> --command <tool> --mode <mode> --chain-id <id> --category <id|name> [--profile-id <id>]`
    - `policy recommend --command <tool> --mode <mode> --chain-id <id> --category <id|name> [--profile-id <id>]`
    - `profile recommend --command <tool> --mode <mode> --chain-id <id> --category <id|name> [--policy-id <id>]`
- `capabilities` for compact routing, risk/idempotency hints, transports, and documentation pointers
- `schema` for authoritative tool inputs/outputs
- `policy list` to inspect what the runtime should allow
- `profile list` to inspect what signer backends are available and which built-ins are actually runtime-ready
- `profile explain --id <profile-id> [--command <tool>] [--mode <mode>] [--policy-id <id>] [--chain-id <id>] [--category <id|name>]` when you need the exact answer for a specific mutable profile and tool context
  - prefer canonical command names from `bootstrap`, `capabilities`, or `schema` when filling `--command`
  - check `explanation.requestedContext.exact` before trusting the result
  - if `exact=false`, fill `explanation.requestedContext.missingFlags` first
  - let the agent act on `explanation.remediation[]`; treat `blockers` as the human-readable fallback

Current profile-readiness baseline in this runtime:
- `market_observer_ro` is the only built-in profile reporting `ready`, and it is read-only
- no built-in mutable profile is ready
- built-in mutable profile states are:
  - `prod_trader_a`: `missing-secrets`
  - `dev_keystore_operator`: `missing-keystore`
  - `desk_signer_service`: `missing-context`
- `degraded` is the backend-level summary only; use `profile list`, `profile get`, and especially `profile explain` to see the exact blocker
- on a shared hosted gateway, `readyMutableBuiltinCount: 0` is a normal and often desirable default until you intentionally provision signer material

### 2. Decide the execution transport

#### Local stdio MCP
Use when the agent is running on the same machine as Pandora.

```bash
pandora mcp
```

#### Remote streamable HTTP MCP
Use when external agents should connect remotely without shelling out.

```bash
pandora mcp http --auth-scopes capabilities:read,contracts:read,help:read,schema:read,operations:read,scan:read,quote:read,portfolio:read,mirror:read,sports:read,network:indexer,network:rpc,network:polymarket,network:sports
```

Notes:
- if `--auth-token` and `--auth-token-file` are omitted, Pandora generates a bearer token at `~/.pandora/mcp-http/auth-token`
- for hosted multi-agent setups, prefer `--auth-tokens-file <json>` so each remote principal gets its own token id and scope set
- prefer generating those token records from `capabilities.data.principalTemplates.templates` rather than hand-assembling scope bags
- shipped template ids are:
  - `read-only-researcher`
  - `operator`
  - `auditor`
  - `recipe-validator`
  - `benchmark-runner`
- if the runtime cannot resolve a home directory, pass `--auth-token` or `--auth-token-file` explicitly instead of relying on auto-generated storage
- use `--public-base-url` when the bind address is not the public URL agents should see
- the full read-only planning scope set above covers `help`, `capabilities`, `schema`, `policy.*`, `profile.*`, `operations.list|get`, plus `scan`, `quote`, `portfolio`, `sports schedule`, `sports scores`, `mirror.plan`, and `sports.create.plan`
- if you omit `--auth-scopes`, Pandora now defaults to a conservative bootstrap scope set: `capabilities:read,contracts:read,help:read,schema:read,operations:read`
- if you only need catalog bootstrap, use that same conservative scope set explicitly
- add `operations:write` only when the remote runtime must call `operations.cancel` or `operations.close`; over MCP those mutating calls also require `intent.execute=true`
- remote-only bootstrap path:
  - call `GET /bootstrap`
  - treat `GET /bootstrap` as canonical-tool-first; only add `?include_aliases=1` for legacy/debug inspection
  - call `GET /schema` only if you need the full descriptor export
  - call `GET /tools` only if you need explicit MCP tool definitions
  - widen scopes only after you identify the exact target tool and policy surface
  - compatibility aliases stay hidden by default; opt in with `?include_aliases=1` only for legacy/debug inspection
- if you need to inspect tools or command descriptors that exist but are currently out of scope, use `GET /tools?include_denied=1` or `GET /schema?include_denied=1` and inspect the returned `missingScopes`

Minimal `--auth-tokens-file` example derived from a shipped principal template:

```json
{
  "tokens": [
    {
      "id": "read-only-researcher",
      "token": "replace-with-random-secret",
      "scopes": [
        "bootstrap:read",
        "capabilities:read",
        "contracts:read",
        "operations:read",
        "policy:read",
        "portfolio:read",
        "profile:read",
        "quote:read",
        "recipe:read",
        "scan:read",
        "schema:read",
        "network:indexer",
        "network:rpc"
      ]
    }
  ]
}
```

Use `capabilities.data.principalTemplates.templates[]` as the source of truth for the exact current scope set instead of copying this example forward blindly.

### 3. Only then decide whether the agent needs secrets
- many discovery, schema, policy, profile, and analysis paths are read-only
- check `requiresSecrets` and `policyScopes` from `capabilities` or `schema` before provisioning signer material
- check signer-profile readiness fields such as `readyBuiltinIds`, `pendingBuiltinIds`, and per-profile `runtimeReady` before assuming a mutable profile is usable
- in the current runtime, no built-in mutable profile is usable until its missing prerequisites are supplied
- do not start with `--private-key`
- if you need a direct Pandora signing command, prefer `--profile-id` / `--profile-file` plus `profile explain` over assuming a mutable built-in profile is already ready
- current builds also accept profile selectors on `mirror deploy`, `mirror go`, `mirror sync once|run|start`, and `sports create run`

## Recommended agent bootstrap patterns

### Read-only research agent
1. `bootstrap`
2. `schema`
3. `policy list`
4. `profile list`
5. `pandora mcp` or `pandora mcp http --auth-scopes capabilities:read,contracts:read,help:read,schema:read,operations:read,scan:read,quote:read,portfolio:read,mirror:read,sports:read,network:indexer,network:rpc,network:polymarket,network:sports`

### Remote-only agent with bearer-token access
1. `GET /bootstrap`
2. `GET /schema`
3. `GET /tools`
4. if a needed tool is out of scope, inspect `GET /schema?include_denied=1` or `GET /tools?include_denied=1`
5. request a narrower additional token or wider scopes only for the exact tool family you need

Suggested template:
- `read-only-researcher`

### Live execution agent
1. perform the read-only bootstrap above
2. choose the smallest policy scopes required by the target tools
3. provision signer material only on the execution runtime
4. run `profile explain` for the exact profile/tool/mode you plan to use
   - only trust the answer when `explanation.requestedContext.exact=true`
   - consume `explanation.remediation[]` before turning `blockers` into prose
5. use validation-first flows for mutable tools

Suggested template:
- `operator`

### Audit and release-validation agent
1. `bootstrap`
2. `capabilities`
3. `schema`
4. `profile explain` or `policy explain` for the exact command family under review
5. `operations receipt` / `operations verify-receipt` for finished mutable work

Suggested templates:
- `auditor`
- `benchmark-runner` for parity/trust automation

### Recipe planning and CI validation agent
1. `bootstrap`
2. `recipe list`
3. `recipe validate`
4. `policy recommend`
5. `profile recommend`

Suggested template:
- `recipe-validator`

## SDK bootstrap

Status:
- both shipped SDK surfaces are alpha
- use them when you want a generated catalog plus a single tool-call client API
- keep local-vs-remote backend choice explicit; the SDKs do not bypass MCP transport or gateway policy checks
- standalone package identities are `@thisispandora/agent-sdk` and `pandora-agent`
- release flow already builds and verifies standalone SDK artifacts for those package identities
- public package publication is available for both SDKs
- use the SDK READMEs and package manifests as the source of truth for the current install command and package version
- signed GitHub release assets remain the parity and audit-friendly distribution path
- the repository and the root Pandora package also vendor matching SDK copies under `sdk/typescript` and `sdk/python`

### TypeScript
- standalone package identity: `@thisispandora/agent-sdk`
 - external install path: public npm package `@thisispandora/agent-sdk` using the currently published tag or signed GitHub release tarball attached to the tagged Pandora release
 - install command: `npm install @thisispandora/agent-sdk@alpha`
 - authoritative install and usage guide: `sdk/typescript/README.md`
 - repository checkout path: `sdk/typescript` for maintainers and in-tree consumers
- vendored root-package copy: `pandora-cli-skills/sdk/typescript`
- generated manifest/loader: `sdk/typescript/generated`
- local backend: `pandora mcp`
- remote backend: intentionally hosted `pandora mcp http ...` plus a bearer token to `/mcp`
- the standalone TypeScript package does not bundle the Pandora runtime; local backend use still requires a reachable `pandora mcp` process
- cold agents should prefer the canonical `bootstrap` contract before low-level `capabilities` / `schema` inspection

### Python
- standalone package identity: `pandora-agent`
 - external install path: public PyPI package `pandora-agent` using the current published version or signed GitHub release wheel or sdist attached to the tagged Pandora release
- install command: `pip install pandora-agent==0.1.0a14`
 - authoritative install and usage guide: `sdk/python/README.md`
 - repository checkout path: `sdk/python` for maintainers and in-tree consumers
- module/import name: `pandora_agent`
- vendored root-package copy: `sdk/python`
- package-local generated artifacts live under `pandora_agent/generated` in the standalone package
- vendored manifest path: `sdk/python/pandora_agent/generated/manifest.json`
- local backend: `pandora mcp`
- remote backend: intentionally hosted `pandora mcp http ...` plus a bearer token to `/mcp`
- the standalone Python package keeps its generated contract bundle under `pandora_agent/generated`
- the standalone Python package does not bundle the Pandora runtime; local backend use still requires a reachable `pandora mcp` process

### Shared contract export
- standalone TypeScript package subpath: `@thisispandora/agent-sdk/generated`
- vendored root-package subpath: `pandora-cli-skills/sdk/generated`
- repository checkout path: `sdk/generated`
- this is the shared root contract bundle used for repo parity and vendored root-package fallback behavior

Regenerate all shipped SDK artifacts from a repository checkout with:
```bash
npm run generate:sdk-contracts
```

## First commands agents should prefer

### Discovery
```bash
pandora --output json bootstrap
pandora --output json capabilities
pandora --output json schema
pandora scan --output json --limit 10
```

### Pricing before mutation
```bash
pandora quote --output json --market-address 0x... --side yes --amount-usdc 25
```

## Canonical routing for common requested names

- `pandora dashboard` is the top-level active-mirror dashboard.
  - it summarizes discovered mirror contexts side-by-side and enables live enrichment unless you pass `--no-live`.
- `pandora mirror dashboard` is the mirror-family version of that operator summary.
- `pandora mirror drift` and `pandora mirror hedge-check` are standalone commands.
  - use them when you want narrower live drift or hedge-gap surfaces than the full dashboard.
- `pandora mirror calc` is the exact target-percentage sizing command.
  - use it when you need precise Pandora notional plus derived hedge inventory.
  - use `pandora mirror hedge-calc` only for offline sizing from explicit reserves or a resolved pair.
- `quote --target-pct` is part of the quote contract for AMM buy quotes.
  - it is mutually exclusive with explicit buy amounts; `--yes-pct` only overrides odds.
- `pandora markets mine` is the owned-exposure discovery command.
  - use `pandora markets list --creator <address>` or `pandora scan --creator <address>` only for creator-scoped discovery.
- `pandora fund-check` is the aggregated hedge-readiness command.
  - use `pandora polymarket check` for readiness and `pandora polymarket balance` for raw signer/proxy balances when you want the underlying granular surfaces.

### Portfolio and closeout
```bash
pandora portfolio --output json --wallet 0x...
pandora operations list --output json --limit 20
```

After terminal mutable work, also inspect the local operation receipt artifact if you need tamper-evident post-execution audit:
- local CLI:
  - `~/.pandora/operations/<operation-id>.receipt.json`
- MCP/workspace-guarded runtime:
  - `./.pandora/operations/<operation-id>.receipt.json`

### Mirror and sports preflight
```bash
pandora mirror plan --output json --source polymarket --polymarket-slug <slug>
pandora sports create plan --output json --event-id <id>
```

## What agents should not do first
- do not start with compatibility mode or alias inspection unless you are debugging a legacy integration
- do not start with `trade --execute`, `sell --execute`, `mirror deploy --execute`, or `sports create run --execute`
- do not assume every mutating family supports `--profile` yet; current direct Pandora commands plus `mirror deploy|go|sync` and `sports create run` do, but some other automation families still rely on env/direct flag resolution
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
