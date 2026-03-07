# Pandora CLI Capabilities

This document maps the CLI to operator use cases. Use it to decide which command family to reach for before opening the full command reference.

For machine-first discovery, start with:
- `pandora --output json capabilities`
- `pandora --output json schema`
- `pandora mcp`

Use `pandora mcp http` only when you intentionally want to host the remote streamable HTTP gateway for external agents.

## Core capability map

| Use case | Canonical commands | Notes |
| --- | --- | --- |
| Market discovery | `scan`, `markets list|get`, `polls list|get`, `positions list`, `events list|get` | `scan` is the enriched discovery path; `markets scan` is an alias. |
| Sports data and consensus | `sports books list`, `sports events list|live`, `sports odds snapshot|bulk`, `sports consensus` | Focused on sportsbook inputs and operator-safe market prep. |
| Market creation planning | `sports create plan`, `mirror plan`, `mirror browse` | `mirror plan` computes the sports-aware suggested `targetTimestamp`. |
| Market deployment and verification | `mirror deploy`, `mirror verify`, `mirror go`, `resolve` | Mirror execute paths require payload validation and valid resolution sources. |
| Trading and exits | `quote`, `trade`, `sell`, `claim` | `trade` is buy-side; `sell` is explicit sell-side. |
| LP operations | `lp add|remove|positions`, `mirror lp-explain`, `mirror hedge-calc`, `mirror simulate` | LP explain/simulate are read-only modeling tools. |
| Mirror sync and hedge operations | `mirror sync once|run|start|stop|status`, `mirror close`, `polymarket check|approve|preflight|trade` | `mirror close` is the deterministic closeout path. |
| Monitoring and automation | `watch`, `stream prices|events`, `autopilot run|once`, `risk show|panic`, `lifecycle start|status|resolve` | `stream` is NDJSON-only. |
| Durable operation tracking | `operations get|list|cancel|close` | Use for inspecting and controlling persisted mutable-operation records. |
| Analytics and export | `portfolio`, `history`, `export`, `leaderboard`, `analyze`, `suggest` | `portfolio` and `history` are operator analytics, not full accounting ledgers. |
| Cross-venue analysis | `arb scan`, `arbitrage` | `arb scan` is the canonical scanner; `arbitrage` is the one-shot wrapper. |
| Quant/model tooling | `simulate mc|particle-filter|agents`, `model calibrate|correlation|diagnose|score brier` | Separate from trading/runtime execution. |
| Agent-native integration | `capabilities`, `schema`, `mcp`, `agent market autocomplete`, `agent market validate` | Open `agent-interfaces.md` for exact envelope and MCP details. |
| Legacy script launchers | `launch`, `clone-bet` | Legacy wrappers, documented separately because their timing model differs from mirror. |

## Canonical paths and aliases

### Discovery
- `pandora scan`
  - canonical enriched discovery path
- `pandora markets scan`
  - backward-compatible alias of `scan`
- `pandora markets list|get`
  - raw browse/get indexer surfaces

### Trading
- `pandora quote`
  - canonical read-only quote path for buy and sell estimates
- `pandora trade`
  - buy-side execution only
- `pandora sell`
  - explicit sell-side execution path
- `pandora claim`
  - canonical winning-token redemption path

### Arbitrage and mirror
- `pandora arb scan`
  - canonical arbitrage scanner
- `pandora arbitrage`
  - bounded compatibility wrapper
- `pandora mirror ...`
  - canonical market mirroring and hedge workflow

## PollCategory mapping
Use numeric ids where a read-only filter explicitly documents `<int>`. Use ids or canonical names where deploy-style flows document `<id|name>`.

| Name | Id |
| --- | --- |
| Politics | `0` |
| Sports | `1` |
| Finance | `2` |
| Crypto | `3` |
| Culture | `4` |
| Technology | `5` |
| Science | `6` |
| Entertainment | `7` |
| Health | `8` |
| Environment | `9` |
| Other | `10` |

Notes:
- `mirror deploy|go` accept `--category <id|name>`.
- Sports mirror examples should use `Sports` or `1`.
- Read-only examples in the reference use numeric ids to match the documented filter surface.

## Safety invariants that matter across command families
- Resolution sources must be public URLs.
- Mirror deploy/go require at least two independent resolution sources from different hosts.
- Polymarket / Gamma / CLOB URLs are source-market discovery inputs, not resolution sources.
- Validation is exact-payload. If `question`, `rules`, `sources`, or `targetTimestamp` change, the old validation ticket is stale.
- `mirror plan|deploy|go` use a sports-aware suggested `targetTimestamp`; do not backfill a generic `+1h` rule.
- `launch` / `clone-bet` still carry script-layer `--target-timestamp-offset-hours`; that behavior does not define mirror timing.

## Capability routing by task
- Need the full CLI surface with flags:
  - open [`command-reference.md`](./command-reference.md)
- Need safe mirror operational guidance:
  - open [`mirror-operations.md`](./mirror-operations.md)
- Need JSON contracts, schema, or MCP tool behavior:
  - open [`agent-interfaces.md`](./agent-interfaces.md)
- Need legacy launcher semantics:
  - open [`legacy-launchers.md`](./legacy-launchers.md)
