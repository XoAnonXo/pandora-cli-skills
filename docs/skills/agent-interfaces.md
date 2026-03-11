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
  - [`../trust/operator-deployment.md`](../trust/operator-deployment.md)
- trade/sell/claim workflows:
  - [`trading-workflows.md`](./trading-workflows.md)
- portfolio and closeout workflows:
  - [`portfolio-closeout.md`](./portfolio-closeout.md)

## Agent-native entrypoints
- `pandora --output json bootstrap`
  - canonical first-call bootstrap payload for cold clients: principal/scopes, canonical tools, recommended next calls, policy/profile readiness, and docs/trust routing
- `pandora --output json capabilities`
  - compact runtime discovery digest: canonical tool routing, risk/idempotency metadata, output modes, transport status
- `pandora --output json schema`
  - emits machine-readable envelope schema and full command descriptors
- `pandora --output json policy list|get|lint`
  - inspect the shipped policy packs and validate candidate custom packs
- `pandora --output json profile list|get|explain|recommend|validate`
  - inspect shipped/sample signer profiles, readiness, and validate candidate custom profiles
- `pandora mcp`
  - runs MCP over stdio for direct tool execution
- `pandora mcp http [--host <host>] [--port <port>] [--public-base-url <url>] [--auth-token <token>|--auth-token-file <path>] [--auth-scopes <csv>]`
  - runs the shipped remote streamable HTTP MCP gateway; inactive until started
  - if `--auth-token` / `--auth-token-file` are omitted, the gateway generates a bearer token and stores it at `~/.pandora/mcp-http/auth-token`
  - for multi-principal operator deployments, prefer `--auth-tokens-file <path>`
  - remote discovery and observability endpoints are:
    - `GET /auth`
    - `GET /auth/current`
    - `GET /auth/principals`
    - `GET /bootstrap`
    - `GET /capabilities`
    - `GET /schema`
    - `GET /tools`
    - `GET /health`
    - `GET /ready`
    - `GET /metrics` (authenticated, requires bearer auth plus `capabilities:read`)
    - `GET /operations/{operationId}/webhooks`
    - `POST /auth/principals/{principalId}/rotate`
    - `POST /auth/principals/{principalId}/revoke`
  - compatibility aliases stay hidden by default on `/bootstrap` and `/tools`; opt in with `include_aliases=1` only for legacy/debug inspection or migration diffing
  - use [`../trust/operator-deployment.md`](../trust/operator-deployment.md) for reverse-proxy, TLS, systemd, and container guidance
- `pandora operations get|list|receipt|verify-receipt|cancel|close`
  - inspect and control persisted mutable-operation records
  - terminal mutable operations also emit durable receipt artifacts in the operation store
- `pandora [--output json] dashboard|mirror dashboard|mirror status|mirror health|mirror drift|mirror hedge-check|mirror pnl|mirror audit|mirror logs|mirror replay|fund-check|explain`
  - `dashboard` / `mirror dashboard` are the multi-market operator summary surfaces
  - `mirror status` is the single-mirror operator dashboard surface
  - `mirror health` is the machine-usable daemon/runtime health shell
  - `mirror drift` and `mirror hedge-check` are narrower live actionability surfaces
  - `mirror pnl` is the canonical mirror accounting-summary surface
    - current builds still expose approximate/operator scenario metrics
    - `--reconciled` attaches normalized realized/unrealized, LP fee, hedge-cost, gas, funding, and reserve-trace attribution on that same surface
  - `mirror audit` is the canonical mirror ledger/audit surface
    - current builds still expose operational/classified runtime history first
    - `--reconciled` attaches normalized cross-venue ledger rows, provenance, and export-ready rows on that same surface
  - `mirror logs` returns tailed daemon log lines from state/strategy/selector lookup
  - `mirror replay` compares modeled hedge/rebalance sizing against persisted audit history
  - `fund-check` is the high-level funding planner for the current mirror context
  - `explain` turns Pandora failures or freeform error text into canonical remediation commands
- `pandora --output json agent market autocomplete ...`
- `pandora --output json agent market validate ...`

## SDK generation and contract export
- SDK alpha surfaces ship in this build as standalone packages, and the repository/root package also vendors matching copies:
  - TypeScript/Node SDK: standalone package identity `@thisispandora/agent-sdk`, repository path `sdk/typescript`, vendored root-package copy `pandora-cli-skills/sdk/typescript`
  - Python SDK: standalone package identity `pandora-agent`, repository path `sdk/python`, module/import name `pandora_agent`
  - shared JS contract export: standalone TypeScript subpath `@thisispandora/agent-sdk/generated`, repository/root bundle `sdk/generated`, vendored root-package subpath `pandora-cli-skills/sdk/generated`
  - release flow builds and verifies standalone SDK artifacts for those identities, and the current public packages are `@thisispandora/agent-sdk` and `pandora-agent`
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
  - `principalTemplates` for shipped remote-gateway auth personas and least-privilege token-record templates
- Use `schema` for authoritative codegen input:
  - top-level envelope definitions
  - exact per-command `inputSchema`
  - `commandDescriptors` and descriptor metadata
- In a repository checkout, `npm run generate:sdk-contracts` regenerates all shipped SDK artifacts:
  - `sdk/generated`
  - `sdk/typescript/generated`
  - `sdk/python/pandora_agent/generated`
- Standalone SDK packages ship package-local generated artifacts.
- In the published root package, `sdk/generated` remains the shared JS contract export surface and the vendored SDK manifests/loaders route back to it instead of duplicating the heavy JSON bundle.
- The TypeScript SDK keeps its embedded manifest at `sdk/typescript/generated/manifest.json`.
- The Python SDK keeps its embedded manifest at `sdk/python/pandora_agent/generated/manifest.json`.
- Standalone-package consumers should treat the SDK packages as the primary delivery vehicle:
  - TypeScript package identity: `@thisispandora/agent-sdk`
  - TypeScript generated bundle subpath: `@thisispandora/agent-sdk/generated`
  - Python package identity: `pandora-agent`
- The root Pandora package still vendors matching copies:
  - TypeScript client entrypoint: `pandora-cli-skills/sdk/typescript`
  - shared static contract bundle: `pandora-cli-skills/sdk/generated`
  - Python vendored source tree: `sdk/python` inside the repository or unpacked Pandora package tree
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
  - standalone TypeScript consumers should use the `@thisispandora/agent-sdk` package surface and `@thisispandora/agent-sdk/generated` when that package is installed from a validated artifact
  - standalone Python consumers should use the `pandora-agent` package surface and its package-local `pandora_agent/generated` artifacts when installed from a validated artifact
  - vendored root-package consumers should use `pandora-cli-skills/sdk/typescript`, `sdk/python`, and `sdk/generated`

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
  - `profile list|get|explain|recommend|validate` for profile discovery, backend readiness inspection, exact-context recommendations, explicit usability explanations, and custom-profile validation
- Current builds do **not** expose a universal `--profile` selector across every mutating command family.
- Direct Pandora signer-bearing commands now accept `--profile-id` / `--profile-file`:
  - `trade`
  - `sell`
  - `lp add`
  - `lp remove`
  - `resolve`
  - `claim`
  - `mirror deploy`
  - `mirror go`
  - `mirror sync once|run|start`
  - `sports create run`
- Mirror deploy/go/sync flows and sports live execution paths now also accept profile selectors in current builds.
- Polymarket and some automation families still commonly resolve credentials from flags/env; use `capabilities` or `schema` to confirm current support on the exact command family you plan to call.
- Built-in sample profiles cover the `read-only`, `local-env`, `local-keystore`, and `external-signer` backend classes. Inspect concrete ids such as `market_observer_ro`, `prod_trader_a`, `dev_keystore_operator`, and `desk_signer_service` with `profile get --id <profile-id>` before assuming a backend is operational.
- In current builds, only `market_observer_ro` is built-in runtime-ready by default in artifact-neutral mode. Use `pandora --output json capabilities --runtime-local-readiness` or `npm run check:final-readiness:runtime-local` on the target host when you need certified local mutable readiness.
- Preferred operator pattern:
  - for agent access, mint narrow gateway tokens and grant only the tool scopes you intend to expose
  - for read-only bootstrap, start with the built-in `research-only` policy and `market_observer_ro` profile pattern
  - for live signing on direct Pandora commands, mirror deployment/sync flows, and sports creation flows, prefer `--profile-id` / `--profile-file` when your runtime has a ready signer profile
  - for other live families still rolling out profile support, inject secrets through env, `.env`, or your own secret-manager wrapper before invoking Pandora
  - avoid raw `--private-key` on command lines for recurring automation unless you explicitly need a manual fallback
- Use `pandora --output json capabilities` or `pandora --output json schema` to answer:
  - which commands require secrets
  - which `policyScopes` a token must grant
  - which policy/profile alpha surfaces are shipped in the current build

## Shipped principal templates

Pandora now ships machine-readable principal templates in `capabilities.data.principalTemplates`.

What they are:
- least-privilege starter personas for `pandora mcp http --auth-tokens-file <path>`
- reference token-record templates, not a hosted identity system
- canonical-tool-first guidance for common remote-agent roles

Current shipped template ids:
- `read-only-researcher`
- `operator`
- `auditor`
- `recipe-validator`
- `benchmark-runner`

What each template includes:
- canonical commands/tools it is intended to call
- exact granted scopes derived from live command descriptors
- optional scopes you may add later
- whether the persona is mutating
- whether the persona expects signer material
- a token-record template shape with `id`, `tokenPlaceholder`, and `scopes`

Use them like this:
1. read `capabilities.data.principalTemplates.templates`
2. choose the narrowest template that matches the agent goal
3. write an `--auth-tokens-file` JSON entry using that template's `tokenRecordTemplate`
4. only widen scopes after `bootstrap`, `policy explain`, or `profile explain` says the target workflow needs more

Important limits:
- templates describe gateway bearer-token scope sets only
- they do not provision signer profiles, policies, or secrets
- `operator` is the only shipped template that intentionally grants mutation scopes
- compatibility aliases are not used as template anchors; templates point to canonical commands only

## Minimal agent onboarding flow

Use this as the concrete preferred sequence:

1. Discover the contract:
   - `pandora --output json bootstrap`
   - `pandora --output json capabilities`
   - `pandora --output json schema`
   - `pandora --output json policy list`
   - `pandora --output json profile list`
   - keep routing on canonical tool names by default; use `--include-compatibility` or `include_aliases=1` only for legacy/debug workflows
2. Inspect the target tool's `policyScopes` and `requiresSecrets` fields.
3. Start `pandora mcp` for local stdio, or start the remote gateway only if the agent needs remote tool execution:
   - `pandora mcp http --auth-scopes <csv>`
   - for multi-principal deployments, prefer `--auth-tokens-file <json>` generated from `capabilities.data.principalTemplates`
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
    - `/bootstrap`
    - `/health`
    - `/ready`
    - `/capabilities`
    - `/metrics`
    - `/schema`
    - `/tools`
    - `/operations`
    - `/mcp`
- health model:
  - `GET /health`
    - unauthenticated shallow liveness
    - includes endpoint map and high-level request counters
  - `GET /ready`
    - unauthenticated structured readiness
    - returns `503` when auth/protocol/operation-store dependencies are not ready
  - `GET /metrics`
    - authenticated JSON metrics
    - includes request totals, in-flight counts, status buckets, route/method counts, auth failures, and operation read/write counters
- response tracing:
  - every gateway response includes `x-request-id`
  - operation responses also include `x-pandora-operation-id` when available
  - receipt responses include `x-pandora-receipt-hash` when available
- Scope model:
  - default gateway scopes are the conservative bootstrap set: `capabilities:read,contracts:read,help:read,schema:read,operations:read`
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

## Operation receipts

Receipts are the runtime-side trust artifact for terminal mutable work.

What generates a receipt:
- terminal operations with status:
  - `completed`
  - `failed`
  - `canceled`
  - `closed`

What a receipt gives an agent:
- `operationId` and `operationHash`
- canonical `command`, `tool`, and `action`
- terminal timestamps
- request/target/result/recovery/error payloads
- `checkpointDigest`
- `receiptHash` and `verification.receiptHash`

Default receipt storage:
- local CLI:
  - `~/.pandora/operations/<operation-id>.receipt.json`
- MCP/workspace-guarded runtime:
  - `./.pandora/operations/<operation-id>.receipt.json`

How to use receipts today:
1. use `operations get` / `operations list` to find the terminal operation id
2. fetch the receipt with `operations receipt --id <operation-id>` or read the on-disk receipt file directly
3. verify integrity with `operations verify-receipt --id <operation-id>` or `--file <path>`
4. treat the receipt as the post-execution audit companion to release verification and benchmark trust evidence

Remote receipt fetch:
- authenticated gateways expose:
  - `GET /operations/<operation-id>/receipt`
  - `GET /operations/<operation-id>/receipt/verify`
- both require `operations:read`

Webhook delivery semantics:
- each outbound delivery receives a stable `deliveryId`
- delivery reports distinguish:
  - `delivered`
  - `failed_retry_exhausted`
  - `failed_permanent`
- retries use bounded exponential backoff
- retries are attempted only for timeouts, transport failures, `429`, and `5xx`
- permanent `4xx` failures stop immediately
- signed deliveries include:
  - `x-pandora-signature`
  - `x-pandora-signature-sha256`
- delivery tracing headers include:
  - `x-pandora-delivery-id`
  - `x-pandora-generated-at`
  - `x-pandora-event`
  - `x-pandora-attempt`
  - `x-pandora-correlation-id` when available

Verification model:
- receipt integrity is based on a stable-body `sha256` digest
- compare:
  - `receiptHash`
  - `verification.receiptHash`
  - `checkpointDigest`
- a mismatch means the stored receipt body or checkpoint binding was modified after issuance

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
- `mirror.sync`:
  - `{ ok: true, command: "mirror.sync", data: { schemaVersion, stateSchemaVersion, generatedAt, strategyHash, mode, executeLive, parameters, stateFile, killSwitchFile, iterationsRequested, iterationsCompleted, stoppedReason, state, actionCount, actions[], snapshots[], webhookReports[], diagnostics[] } }`
- `mirror.sync.start|stop|status`:
  - `{ ok: true, command: "mirror.sync.*", data: { schemaVersion, operationId, strategyHash, found?, pidFile, pid, alive, status, wasAlive?, signalSent?, forceKilled?, exitObserved?, metadata } }`
- `mirror.status`:
  - `{ ok: true, command: "mirror.status", data: { schemaVersion, generatedAt, stateFile, strategyHash, selector, trustManifest, live, runtime, state } }`
- `mirror.close`:
  - `{ ok: true, command: "mirror.close", data: { schemaVersion, generatedAt, mode, target, steps[], summary, diagnostics[] } }`
- `autopilot`:
  - `{ ok: true, command: "autopilot", data: { schemaVersion, generatedAt, strategyHash, mode, executeLive, stateFile, killSwitchFile, parameters, state, actionCount, actions[], snapshots[], webhookReports[] } }`
- `operations.get` / `operations.cancel` / `operations.close`:
  - `{ ok: true, command: "operations.*", data: { operationId, operationHash, tool, action, command, summary, status, createdAt, updatedAt, cancelable, closable, checkpoints[], metadata, result, recovery, error } }`

Mirror runtime notes:
- `mirror go` and `mirror.sync.*` stay in paper mode unless `--execute-live` or `--execute` is supplied.
- `mirror.sync` action entries expose separate `rebalance` and `hedge` legs. The cross-venue path is not atomic and there is no atomic settlement field.
- `mirror.go --auto-sync` still returns that same separate-leg sync payload; it does not convert the cross-venue path into an atomic execution contract.
- `mirror.sync` enforces a close-window guard via `--min-time-to-close-sec`.
  - default requested floor: `1800`
  - effective floor: `max(--min-time-to-close-sec, ceil(--interval-ms / 1000) * 2)`
  - startup refusal code when expiry is already too near: `MIRROR_EXPIRY_TOO_CLOSE`
- `--strict-close-time-delta` promotes `CLOSE_TIME_DELTA` from diagnostic-only to blocking; otherwise the Pandora close window remains the hard gate.
- `mirror.sync.snapshots[].metrics.reserveSource`, `mirror.sync.snapshots[].actionPlan.reserveSource`, and the attached reserve context expose reserve provenance.
  - `onchain:outcome-token-balances` means runtime refreshed Pandora reserves directly from on-chain outcome token balances before sizing
  - `verify-payload` means sizing used the verify payload reserve snapshot
- `mirror.sync.snapshots[].metrics.reserveReadAt`, `reserveReadError`, `rebalanceSizingMode`, `rebalanceSizingBasis`, and `rebalanceTargetUsdc` expose whether the rebalance path used atomic target sizing or a fallback/incremental mode.
- `mirror.sync.snapshots[].strictGate.checks[]` carries execution gates such as `POLYMARKET_SOURCE_FRESH`, `CLOSE_TIME_DELTA`, and `MIN_TIME_TO_EXPIRY`.
- Paper mode may reuse cached `polymarket:cache` source snapshots; live mode blocks cached source data through `POLYMARKET_SOURCE_FRESH`.
- Live Polygon preflight uses `--polymarket-rpc-url` first, then `POLYMARKET_RPC_URL`, then `--rpc-url`; comma-separated RPC fallbacks are tried in order.
- `mirror.sync.start|status` metadata is the daemon-health surface.
  - key fields are `status`, top-level `alive`, `metadata.pidAlive`, `checkedAt`, `pidFile`, and `logFile`
  - stop payloads also add `signalSent`, `forceKilled`, and `exitObserved`
- `mirror.status.runtime` carries `health`, `daemon`, `lastAction`, `lastError`, `pendingAction`, and recent `alerts`.
- `runtime.health.status` is the operator rollup and can be `running`, `idle`, `blocked`, `degraded`, `stale`, or `error`.
  - `blocked` covers fail-closed runtime cases such as `PENDING_ACTION_LOCK*` and `LAST_ACTION_REQUIRES_REVIEW`
  - `stale` means daemon metadata still reports alive while the heartbeat exceeded threshold
- `mirror status --with-live` is the live diagnostic surface for a mirror resolved from persisted state or direct selectors.
  - `live.verifyDiagnostics` carries verify-time feed and matching warnings
  - `live.polymarketPosition.mergeReadiness` and `live.polymarketPosition.diagnostics` carry merge-advisory, balance, and open-order visibility warnings instead of hard-failing when that view is partial
  - `--drift-trigger-bps`, `--hedge-trigger-usdc`, `--indexer-url`, `--timeout-ms`, and Polymarket host/mock overrides shape that live diagnostic projection path
  - `live.sourceMarket`, `live.pandoraMarket`, `live.netPnlApproxUsdc`, `live.pnlApprox`, and `live.netDeltaApprox` provide the operator snapshot around those diagnostics
  - `live.netPnlApproxUsdc` is cumulative LP fees approx minus cumulative hedge cost approx; `live.pnlApprox` adds marked Polymarket inventory; `live.pnlScenarios` projects current token payouts under each outcome
  - these values are operator diagnostics, not realized closeout proceeds, a complete audit ledger, or tax-ready accounting

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
- `lp simulate-remove`:
  - `{ ok: true, command: "lp", data: { action: "simulate-remove", mode: "preview", marketAddress, wallet, lpTokens, sharesToBurnRaw, preview, diagnostics[] } }`

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
