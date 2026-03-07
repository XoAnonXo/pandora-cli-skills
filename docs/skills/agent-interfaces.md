# Agent Interfaces, JSON Contracts, and MCP

Use this guide for `schema`, `mcp`, JSON output contracts, recovery hints, and machine-facing runtime details.

## Agent-native entrypoints
- `pandora --output json capabilities`
  - compact runtime discovery digest: canonical tool routing, risk/idempotency metadata, output modes, transport status
- `pandora --output json schema`
  - emits machine-readable envelope schema and full command descriptors
- `pandora mcp`
  - runs MCP over stdio for direct tool execution
- `pandora mcp http [--host <host>] [--port <port>] [--public-base-url <url>] [--auth-token <token>|--auth-token-file <path>] [--auth-scopes <csv>]`
  - runs the shipped remote streamable HTTP MCP gateway; inactive until started
  - if `--auth-token` / `--auth-token-file` are omitted, the gateway generates a bearer token and stores it at `~/.pandora/mcp-http/auth-token`
- `pandora operations get|list|cancel|close`
  - inspect and control persisted mutable-operation records
- `pandora --output json agent market autocomplete ...`
- `pandora --output json agent market validate ...`

## MCP server mode
- Transport:
  - MCP stdio JSON-RPC
- Remote beta transport:
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
