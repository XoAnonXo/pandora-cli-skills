# Pandora CLI & Skills

Production CLI for Pandora prediction markets with mirror + hedge tooling and agent-native interfaces.

## Install

```bash
npm i -g pandora-cli-skills
pandora --help
```

Or run without installing:

```bash
npx pandora-cli-skills@latest --help
```

## Agent-Native Features

- `pandora --output json schema`
  - emits machine-readable envelope schema + command descriptors.
- `pandora mcp`
  - runs an MCP server over stdio (`tools/list`, `tools/call`) for direct agent tool execution.
- JSON errors include optional next-best-action recovery hints:
  - `error.recovery = { action, command, retryable }`.
- Attach-only fork runtime for on-chain command families:
  - `--fork`, `--fork-rpc-url`, `--fork-chain-id`.
- Event-driven streaming:
  - `pandora stream prices|events` emits NDJSON lines on stdout.

## Quickstart

```bash
# schema for typed consumers (Pydantic/Zod/etc.)
pandora --output json schema

# MCP server mode
pandora mcp

# Read-only market discovery
pandora --output json markets list --active --limit 10

# Dry-run trade with fork runtime
pandora --output json trade --dry-run \
  --market-address 0x... --side yes --amount-usdc 10 \
  --fork --fork-rpc-url http://127.0.0.1:8545

# NDJSON stream
pandora stream prices --indexer-url https://pandoraindexer.up.railway.app/ --interval-ms 1000
```

### Sports Quickstart

```bash
# list upcoming soccer events
pandora --output json sports events list --competition <id-or-slug> --limit 5

# compute trimmed-median consensus for one event
pandora --output json sports consensus --event-id <event-id> --trim-percent 20

# build conservative create + resolve plans
pandora --output json sports create plan --event-id <event-id> --selection home
pandora --output json sports resolve plan --event-id <event-id> --poll-address <0x...>
```

## Fork Mode Notes

- Runtime marker is included in payloads: `data.runtime.mode = "fork" | "live"`.
- Fork RPC precedence:
  1. `--fork-rpc-url`
  2. `FORK_RPC_URL` (when `--fork` is set)
  3. command default live RPC path
- `polymarket trade --execute` in fork mode is simulation-only unless `--polymarket-mock-url` is provided.

## Streaming Contract

`pandora stream prices|events` outputs NDJSON only (one JSON object per line), for example:

```json
{"type":"stream.tick","channel":"prices","seq":1,"ts":"2026-03-01T12:00:00.000Z","source":{"transport":"polling"},"data":{"id":"market-1","yesPct":58.12}}
```

## Command Surface

- `pandora markets list|get`
- `pandora sports books list`
- `pandora sports events list|live`
- `pandora sports odds snapshot|bulk`
- `pandora sports consensus`
- `pandora sports create plan|run`
- `pandora sports sync once|run|start|stop|status`
- `pandora sports resolve plan`
- `pandora lifecycle start|status|resolve`
- `pandora quote`
- `pandora trade`
- `pandora history`
- `pandora export`
- `pandora arbitrage`
- `pandora arb scan --output ndjson`
- `pandora odds record|history`
- `pandora autopilot run|once`
- `pandora mirror browse|plan|deploy|verify|lp-explain|hedge-calc|simulate|go|sync|status|close`
- `pandora polymarket check|approve|preflight|trade`
- `pandora resolve`
- `pandora lp add|remove|positions`
- `pandora risk show|panic`
- `pandora stream prices|events`
- `pandora schema`
- `pandora mcp`

## Docs

- Full command contract and workflows: [`SKILL.md`](./SKILL.md)
- Operator + package documentation: [`README_FOR_SHARING.md`](./README_FOR_SHARING.md)

Node.js `>=18` required.
