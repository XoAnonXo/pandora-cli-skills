# Agent Interfaces, JSON Contracts, and MCP

Use this guide for `schema`, `mcp`, JSON output contracts, recovery hints, and machine-facing runtime details.

For a faster task-focused path:
- external-agent bootstrap:
  - [`agent-quickstart.md`](./agent-quickstart.md)
- policy packs and signer profiles:
  - [`policy-profiles.md`](./policy-profiles.md)
- release verification and trust posture:
  - [`../trust/release-verification.md`](../trust/release-verification.md)
  - [`../trust/security-model.md`](../trust/security-model.md)
  - [`../trust/support-matrix.md`](../trust/support-matrix.md)
- trade/sell/claim workflows:
  - [`trading-workflows.md`](./trading-workflows.md)
- portfolio and closeout workflows:
  - [`portfolio-closeout.md`](./portfolio-closeout.md)

## Agent-native entrypoints
- `pandora --output json capabilities`
  - compact runtime discovery digest: canonical tool routing, risk/idempotency metadata, output modes, transport status
- `pandora --output json schema`
  - emits machine-readable envelope schema and full command descriptors
- `pandora --output json policy list|get|lint`
  - inspect the shipped policy packs and validate candidate custom packs
- `pandora --output json profile list|get|validate`
  - inspect shipped/sample signer profiles, readiness, and validate candidate custom profiles
- `pandora mcp`
  - runs MCP over stdio for direct tool execution
- `pandora mcp http [--host <host>] [--port <port>] [--public-base-url <url>] [--auth-token <token>|--auth-token-file <path>] [--auth-scopes <csv>]`
  - runs the shipped remote streamable HTTP MCP gateway; inactive until started
  - if `--auth-token` / `--auth-token-file` are omitted, the gateway generates a bearer token and stores it at `~/.pandora/mcp-http/auth-token`
- `pandora operations get|list|cancel|close`
  - inspect and control persisted mutable-operation records
- `pandora --output json agent market autocomplete ...`
- `pandora --output json agent market validate ...`

## SDK generation and contract export
- SDK alpha source/artifact surfaces ship in this build:
  - JavaScript/TypeScript SDK entrypoints under `sdk/typescript`
  - TypeScript embedded loader/manifest under `sdk/typescript/generated`
  - Python SDK source/package under `sdk/python`
  - Python embedded manifest under `sdk/python/pandora_agent/generated`
  - shared JS contract export under `sdk/generated`
- `capabilities.data.transports.sdk` reports the shipping state; current builds return `supported=true` and `status="alpha"`.
- Regenerate the vendored bundle with:

```bash
npm run generate:sdk-contracts
```

Run that only from a repository checkout. Installed packages already include the generated SDK artifacts and do not ship the repo-only generator script.

- Use `capabilities` for compact bootstrap metadata:
  - `commandDigests` for routing and safety hints
  - `canonicalTools` for alias/preferred-command mapping
  - `versionCompatibility` for transport and descriptor version notes
  - `registryDigest` for drift detection
  - `trustDistribution` for packaged trust signals, release scripts, and verification posture
- Use `schema` for authoritative codegen input:
  - top-level envelope definitions
  - exact per-command `inputSchema`
  - `commandDescriptors` and descriptor metadata
- In a repository checkout, `npm run generate:sdk-contracts` regenerates all shipped SDK artifacts:
  - `sdk/generated`
  - `sdk/typescript/generated`
  - `sdk/python/pandora_agent/generated`
- In the published root package, `sdk/generated` remains the shared JS contract export surface and embedded SDK loaders/manifests route to it instead of duplicating the heavy JSON bundle.
- The TypeScript SDK keeps its embedded manifest at `sdk/typescript/generated/manifest.json`.
- The Python SDK keeps its embedded manifest at `sdk/python/pandora_agent/generated/manifest.json`.
- Rebuild generated clients when either of these changes:
  - `commandDescriptorVersion`
  - `capabilities.data.registryDigest.descriptorHash`
- For direct live execution today, use an MCP client against `pandora mcp` or intentionally hosted `pandora mcp http`; contract export is for local generation, while MCP is the supported execution transport.

## SDK bootstrap modes

- Local SDK execution:
  - start `pandora mcp`
  - connect the SDK over stdio
  - no gateway token is involved
- Remote SDK execution:
  - intentionally host `pandora mcp http --auth-scopes <csv>`
  - connect the SDK to the `/mcp` endpoint with a bearer token
  - provision signer material only on that gateway runtime if a selected tool actually requires secrets
- Package-local generated artifact usage:
  - use `capabilities` / `schema` for live runtime discovery
  - use the SDK package's own generated manifest/artifacts for installed local metadata
  - for Python specifically, the shipped package-local manifest lives at `sdk/python/pandora_agent/generated/manifest.json`

## Policy scopes and signer profiles
- Policy metadata is wired now:
  - MCP tool metadata includes `xPandora.policyScopes`
  - `capabilities` / `schema` expose `policyScopes`, `requiresSecrets`, and `policyProfiles`
  - the HTTP gateway checks bearer-token scopes from `--auth-scopes` before invoking a tool
- Policy/profile status fields are active alpha surfaces:
  - `policyProfiles.policyPacks` reports the shipped policy-pack catalog state
  - `policyProfiles.signerProfiles` reports the shipped signer-profile catalog state
- signer-profile capability metadata also exposes:
  - `implementedBackends`
  - `placeholderBackends`
  - `readyBuiltinIds`
  - `pendingBuiltinIds`
- Use the policy/profile command families directly:
  - `policy list|get|lint` for pack discovery, compiled-rule inspection, and custom-pack validation
  - `profile list|get|validate` for profile discovery, backend readiness inspection, and custom-profile validation
- Current builds do **not** expose a universal `--profile` selector across mutating commands. Live commands that require signing still commonly resolve credentials from flags/env during rollout.
- Built-in sample profiles cover the `read-only`, `local-env`, `local-keystore`, and `external-signer` backend classes. Inspect concrete ids such as `market_observer_ro`, `prod_trader_a`, `dev_keystore_operator`, and `desk_signer_service` with `profile get --id <profile-id>` before assuming a backend is operational.
- In current builds, only `market_observer_ro` is built-in runtime-ready by default. Treat the other built-in mutable profiles as planning samples unless `profile get` reports them ready in your runtime.
- Preferred operator pattern:
  - for agent access, mint narrow gateway tokens and grant only the tool scopes you intend to expose
  - for read-only bootstrap, start with the built-in `research-only` policy and `market_observer_ro` profile pattern
  - for live signing, inject secrets through env, `.env`, or your own secret-manager wrapper before invoking Pandora
  - avoid raw `--private-key` on command lines for recurring automation unless you explicitly need a manual fallback
- Use `pandora --output json capabilities` or `pandora --output json schema` to answer:
  - which commands require secrets
  - which `policyScopes` a token must grant
  - which policy/profile alpha surfaces are shipped in the current build

## Minimal agent onboarding flow

Use this as the concrete preferred sequence:

1. Discover the contract:
   - `pandora --output json capabilities`
   - `pandora --output json schema`
   - `pandora --output json policy list`
   - `pandora --output json profile list`
2. Inspect the target tool's `policyScopes` and `requiresSecrets` fields.
3. Start `pandora mcp` for local stdio, or start the remote gateway only if the agent needs remote tool execution:
   - `pandora mcp http --auth-scopes <csv>`
   - if you are embedding the shipped SDKs, keep using their package-local generated artifacts for static metadata and MCP only for execution
4. Hand the agent the bearer token from `~/.pandora/mcp-http/auth-token` or your own supplied token.
5. If the tool requires signing, provision env-based secrets on the gateway host itself. Gateway scopes authorize tool use; they do not replace signer material.

Use raw `--private-key` only for manual/operator fallback. It is not the preferred agent path.

## MCP server mode
- Transport:
  - MCP stdio JSON-RPC
- Remote HTTP transport:
  - streamable HTTP via `pandora mcp http`
  - bearer-token protected
  - if no auth token is supplied, the gateway generates one and stores it at `~/.pandora/mcp-http/auth-token`
  - use `--public-base-url` when the gateway is behind a proxy, TLS terminator, or non-routable bind host such as `0.0.0.0`
  - read-only scopes by default when no `--auth-scopes` override is supplied
  - gateway endpoints:
    - `/health`
    - `/capabilities`
    - `/operations`
    - `/mcp`
- Scope model:
  - default gateway scopes are the non-mutating remote-eligible tool scopes plus `operations:read`
  - remote-eligible mutating tools can still appear in tool discovery, but calls are rejected with `FORBIDDEN` unless the bearer token includes the required `xPandora.policyScopes`
  - use `pandora --output json schema` or MCP tool metadata to inspect a tool's declared `policyScopes`
  - for signer-bearing tools, prefer granting only the exact tool scopes plus `secrets:use` rather than handing an agent raw private-key material
  - `secrets:use` authorizes secret-bearing tool invocation; it does not materialize signer credentials by itself
- Tool model:
  - one tool per command family entrypoint
- Exclusions:
  - `launch` and `clone-bet` are intentionally not exposed over MCP because they stream script output
- Guardrails:
  - mutating tools require explicit execute intent (`intent.execute=true`) for live execution
  - long-running modes are blocked in v1 for `watch`, `odds.record`, `autopilot run`, `mirror sync run|start`, and `sports sync run|start`
  - mutually-exclusive safe/live mode flags are rejected at the MCP boundary

## Next Best Action recovery hints
JSON errors can include additive recovery guidance:
- `error.recovery.action`
- `error.recovery.command`
- `error.recovery.retryable`

Human-facing hints can still appear under `details.hints`.

## Fork runtime
Shared flags:
- `--fork`
- `--fork-rpc-url <url>`
- `--fork-chain-id <id>`

Fork RPC precedence:
1. `--fork-rpc-url`
2. `FORK_RPC_URL` when `--fork` is set
3. the normal live RPC path

Payloads annotate runtime mode as:
- `runtime.mode = "fork" | "live"`

Note:
- `polymarket trade --execute` in fork mode is simulation-only unless `--polymarket-mock-url` is provided.

## Stream contract
- `pandora stream prices|events` is NDJSON-only.
- One JSON object is emitted per line.
- Tick envelope fields:
  - `type`
  - `ts`
  - `seq`
  - `channel`
  - `source.transport`
  - `source.url`
  - `data`

Transport behavior:
- primary: WebSocket when `--indexer-ws-url` is available or derivable
- fallback: polling with `source.transport = "polling"`

## Error code guide
Common structured error families for automation:
- `MISSING_REQUIRED_FLAG`
- `INVALID_FLAG_VALUE`
- `INVALID_ARGS`
- `UNKNOWN_FLAG`
- `UNKNOWN_COMMAND`
- `NOT_FOUND`
- `INDEXER_HTTP_ERROR` / `INDEXER_TIMEOUT`
- `MIRROR_*`
- `POLYMARKET_*`
- `RISK_*`
- `LIFECYCLE_*`
- `ODDS_*`
- `ARB_*`
- `CONFIG_*`
- `SIMULATE_*`
- `MODEL_*`
- `FORECAST_*`
- `BRIER_*`
- `MCP_FILE_ACCESS_BLOCKED`
- `WEBHOOK_DELIVERY_FAILED`

Error envelope:
```json
{ "ok": false, "error": { "code": "...", "message": "...", "details": {}, "recovery": { "action": "...", "command": "...", "retryable": true } } }
```

## Common JSON envelopes

### Core operator families
- `doctor`:
  - `{ ok: true, command: "doctor", data: { schemaVersion, generatedAt, env, rpc, codeChecks, polymarket, summary } }`
- `history`:
  - `{ ok: true, command: "history", data: { schemaVersion, generatedAt, indexerUrl, wallet, chainId, filters, pagination, pageInfo, summary, count, items[] } }`
- `export`:
  - `{ ok: true, command: "export", data: { schemaVersion, generatedAt, format, wallet, chainId, count, filters, columns[], outPath, rows[], content } }`
- `portfolio`:
  - `{ ok: true, command: "portfolio", data: { wallet, summary, positions[], events } }`
- `watch`:
  - `{ ok: true, command: "watch", data: { parameters, iterationsRequested, snapshots[], alerts[] } }`

### Mirror and automation
- `mirror.browse`:
  - `{ ok: true, command: "mirror.browse", data: { schemaVersion, generatedAt, source, filters, count, items[], diagnostics[] } }`
- `mirror.go`:
  - `{ ok: true, command: "mirror.go", data: { schemaVersion, generatedAt, mode, plan, deploy, verify, sync, polymarketPreflight, suggestedSyncCommand, trustManifest, diagnostics[] } }`
- `mirror.close`:
  - `{ ok: true, command: "mirror.close", data: { schemaVersion, generatedAt, mode, target, steps[], summary, diagnostics[] } }`
- `autopilot`:
  - `{ ok: true, command: "autopilot", data: { schemaVersion, generatedAt, strategyHash, mode, executeLive, stateFile, killSwitchFile, parameters, state, actionCount, actions[], snapshots[], webhookReports[] } }`
- `operations.get` / `operations.cancel` / `operations.close`:
  - `{ ok: true, command: "operations.*", data: { operationId, operationHash, tool, action, command, summary, status, createdAt, updatedAt, cancelable, closable, checkpoints[], metadata, result, recovery, error } }`

### Trading and LP
- `quote`:
  - `{ ok: true, command: "quote", data: { marketAddress, side, mode, odds, quoteAvailable, estimate } }`
- `trade` dry-run:
  - `{ ok: true, command: "trade", data: { mode: "dry-run", quote, selectedProbabilityPct, riskGuards, executionPlan } }`
- `trade` execute:
  - `{ ok: true, command: "trade", data: { mode: "execute", approveTxHash?, buyTxHash, selectedProbabilityPct, riskGuards } }`
- `sell`:
  - `{ ok: true, command: "sell", data: { action: "sell", quote, tx?, minAmountOutRaw } }`
- `lp add|remove`:
  - `{ ok: true, command: "lp", data: { action: "add"|"remove", mode, txPlan, tx? } }`
- `lp positions`:
  - `{ ok: true, command: "lp", data: { action: "positions", mode: "read", wallet, count, items[] } }`

### Quant/model
- `simulate.mc`:
  - `{ ok: true, command: "simulate.mc", data: { inputs, summary, distribution, diagnostics[] } }`
- `simulate.particle-filter`:
  - `{ ok: true, command: "simulate.particle-filter", data: { inputs, summary, trajectory[], diagnostics[] } }`
- `simulate.agents`:
  - `{ ok: true, command: "simulate.agents", data: { parameters, convergenceError, spreadTrajectory[], volume, pnlByAgentType, finalState, runtimeBounds } }`
- `model.calibrate|correlation|diagnose|score.brier`:
  - all return `{ ok: true, command, data }` with `schemaVersion` and `generatedAt`

## Validation flow reminder
- `agent market validate` must run on the exact final payload for agent-controlled execute mode.
- CLI mirror execute reruns use `--validation-ticket <ticket>`.
- MCP execute/live reruns use `agentPreflight`.
- `sports create run` uses `agentPreflight` / `PANDORA_AGENT_PREFLIGHT`, not a CLI validation-ticket flag.
