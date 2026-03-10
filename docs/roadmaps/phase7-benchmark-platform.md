# Phase 7 Benchmark Platform

## Goal
Build a reproducible, public-facing benchmark pack for Pandora agent readiness.

## Shipped core suite
- `cli-capabilities-bootstrap`
- `mcp-stdio-capabilities`
- `mcp-http-capabilities`
- `mcp-http-scope-denial`
- `mcp-stdio-execute-intent-denial`
- `mcp-http-execute-intent-denial`
- `mcp-stdio-workspace-denial`
- `mcp-http-workspace-denial`
- `cli-schema-bootstrap`
- `mcp-stdio-schema-bootstrap`
- `mcp-http-schema-bootstrap`
- `cli-operations-empty-list`
- `cli-operations-get-seeded`
- `mcp-stdio-operations-get-seeded`
- `mcp-http-operations-get-seeded`
- `mcp-stdio-list-tools-bootstrap`
- `mcp-http-list-tools-bootstrap`
- `cli-operations-cancel-seeded`
- `cli-operations-close-seeded`

## Design choices
- benchmark scenarios are versioned JSON manifests under `benchmarks/scenarios/`
- transports are the real public surfaces: CLI JSON, stdio MCP, and remote streamable HTTP MCP
- results are machine-readable JSON reports suitable for publication
- the release gate is `npm run benchmark:check`
- a committed contract lock under `benchmarks/locks/` is required for release gating
- parity groups assert normalized cross-transport equivalence instead of only isolated single-scenario success
- generated SDK artifacts participate in the contract lock
- tool-list parity is checked separately from capabilities/schema parity
- denial scenarios record operation ids before/after to prove no hidden side effects

## Release gate

Phase 7 is considered green when:
- `npm run benchmark:check` passes
- the committed lock matches live contract/generated artifacts
- the latest core report shows `overallPass: true`
- no parity group is missing an expected transport

## Notes on determinism

The benchmark pack is deterministic in fixtures, manifests, seeded operation state, and contract hashing. It is not expected to produce identical wall-clock timings on every machine, so latency is enforced through target thresholds instead of exact timing equality.

## Next expansion targets
- mirror validation-ticket rerun flow with mocked Polymarket/indexer fixtures
- policy/profile incompatibility and remediation flows
- failure-injection scenarios for operation resume and webhook delivery
- long-running lifecycle transitions (`status`, `cancel`, `close`) with seeded checkpoints
