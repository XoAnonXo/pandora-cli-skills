# Scenario Catalog

This catalog mirrors the JSON manifests in `benchmarks/scenarios/core`.

Current suite facts:
- suite id: `core`
- scenario schema version: `1.0.0`
- expected scenario count: `19`
- minimum weighted score: `95`

Agents can discover this catalog from the benchmark explainability routes published by `pandora --output json capabilities`:
- `Benchmark methodology, scenarios, or scorecards`
- `Benchmark scenario catalog and parity coverage`
- `Benchmark weighted scoring and score interpretation`

Use this file when a report names a failing scenario or parity group and you need the exact transport, assertion, and request shape behind that failure. Use `scorecard.md` when the question is how that failure changes `weightedScore` or readiness interpretation.

## Reproducibility Notes

This catalog is manifest-backed from `benchmarks/scenarios/core` in the source tree.
The published release artifacts expose:

- `core-report.json`
- `core.lock.json`

They do **not** expose the full scenario manifest directory.

If you need to reproduce a failing release scenario externally:

1. check out the exact release tag
2. inspect the matching JSON manifest under `benchmarks/scenarios/core`
3. rerun `npm run benchmark:check`

Use the release asset report/lock for trust evidence and the tagged source tree for full scenario-level reproduction.

## Parity Groups

The current suite defines these parity groups:
- `capabilities-bootstrap`
- `schema-bootstrap`
- `operations-get-seeded`
- `execute-intent-denial`
- `workspace-path-denial`
- `tools-list-bootstrap`

## Core Scenarios

| ID | Transport | Assertion | Weight | Target ms | Parity group | Request details |
| --- | --- | --- | ---: | ---: | --- | --- |
| `cli-capabilities-bootstrap` | `cli-json` | `capabilities-bootstrap` | 12 | 5000 | `capabilities-bootstrap` | `pandora --output json capabilities` |
| `mcp-stdio-capabilities` | `mcp-stdio` | `capabilities-bootstrap` | 12 | 5000 | `capabilities-bootstrap` | MCP tool `capabilities` |
| `mcp-http-capabilities` | `mcp-http` | `capabilities-bootstrap` | 12 | 7000 | `capabilities-bootstrap` | MCP tool `capabilities`; auth scopes `capabilities:read,contracts:read,operations:read` |
| `mcp-http-scope-denial` | `mcp-http` | `scope-denial` | 20 | 7000 | none | MCP tool `operations.list`; auth scopes `capabilities:read` |
| `mcp-stdio-execute-intent-denial` | `mcp-stdio` | `execute-intent-denial` | 20 | 5000 | `execute-intent-denial` | MCP tool `risk.panic` without execute intent |
| `mcp-stdio-workspace-denial` | `mcp-stdio` | `workspace-path-denial` | 15 | 5000 | `workspace-path-denial` | MCP tool `mirror.deploy` with `/tmp/...` `plan-file` |
| `cli-operations-empty-list` | `cli-json` | `operations-empty-list` | 10 | 5000 | none | `pandora --output json operations list` |
| `cli-schema-bootstrap` | `cli-json` | `schema-bootstrap` | 10 | 5000 | `schema-bootstrap` | `pandora --output json schema` |
| `mcp-stdio-schema-bootstrap` | `mcp-stdio` | `schema-bootstrap` | 10 | 5000 | `schema-bootstrap` | MCP tool `schema` |
| `mcp-http-schema-bootstrap` | `mcp-http` | `schema-bootstrap` | 10 | 7000 | `schema-bootstrap` | MCP tool `schema`; auth scopes `capabilities:read,contracts:read,operations:read,schema:read` |
| `cli-operations-get-seeded` | `cli-json` | `operations-get-seeded` | 8 | 5000 | `operations-get-seeded` | `pandora --output json operations get --id benchmark-op-1` with seeded operation state |
| `mcp-stdio-operations-get-seeded` | `mcp-stdio` | `operations-get-seeded` | 8 | 5000 | `operations-get-seeded` | MCP tool `operations.get` for seeded `benchmark-op-1` |
| `mcp-http-operations-get-seeded` | `mcp-http` | `operations-get-seeded` | 8 | 7000 | `operations-get-seeded` | MCP tool `operations.get`; auth scopes `capabilities:read,contracts:read,operations:read` |
| `mcp-http-execute-intent-denial` | `mcp-http` | `execute-intent-denial` | 20 | 7000 | `execute-intent-denial` | MCP tool `risk.panic`; auth scopes `*` |
| `mcp-http-workspace-denial` | `mcp-http` | `workspace-path-denial` | 15 | 7000 | `workspace-path-denial` | MCP tool `mirror.deploy` with `/tmp/...` `plan-file`; auth scopes `*` |
| `mcp-stdio-list-tools-bootstrap` | `mcp-stdio` | `tools-list-bootstrap` | 10 | 5000 | `tools-list-bootstrap` | MCP `listTools` through the local TypeScript SDK client |
| `mcp-http-list-tools-bootstrap` | `mcp-http` | `tools-list-bootstrap` | 10 | 7000 | `tools-list-bootstrap` | MCP `listTools` through the remote TypeScript SDK client; auth scopes `*` |
| `cli-operations-cancel-seeded` | `cli-json` | `operations-cancel-seeded` | 8 | 5000 | none | `pandora --output json operations cancel --id benchmark-op-cancel --reason benchmark-cancel` |
| `cli-operations-close-seeded` | `cli-json` | `operations-close-seeded` | 8 | 5000 | none | `pandora --output json operations close --id benchmark-op-close --reason benchmark-close` |

The expected scenario id order above matches the runner's sorted manifest order and the committed `benchmarks/latest/core-report.json` publication format.

## Seeded-State Notes

Only these scenarios seed operation records before execution:
- `cli-operations-get-seeded`
- `mcp-stdio-operations-get-seeded`
- `mcp-http-operations-get-seeded`
- `cli-operations-cancel-seeded`
- `cli-operations-close-seeded`

Each seeded operation is written into the isolated benchmark `PANDORA_OPERATION_DIR` before the scenario runs.

## Transport Notes

The runner supports exactly three benchmark transports:
- `cli-json`
- `mcp-stdio`
- `mcp-http`

For `mcp-http`, the manifest may also declare `request.authScopes`. The current suite uses:
- scoped bootstrap tokens for `capabilities`, `schema`, and `operations.get`
- a deliberately under-scoped token for `mcp-http-scope-denial`
- wildcard `*` tokens for the remote execute-intent denial, workspace denial, and `listTools` parity scenarios
