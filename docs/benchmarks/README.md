# Pandora Agent Benchmark Pack

Pandora maintains a reproducible repository benchmark harness built around the real public surfaces:
- CLI JSON
- stdio MCP
- remote streamable HTTP MCP
- seeded operation state under isolated benchmark storage

The fixtures, scenario manifests, contract lock, and generated SDK artifacts are intended to be deterministic. Raw latency remains machine-sensitive, so release gating uses pass/fail latency targets instead of claiming identical wall-clock timing across environments.

The published npm package ships:
- this benchmark documentation
- the latest benchmark report at `benchmarks/latest/core-report.json`

The full harness remains a repository/release-maintainer surface:
- scenario manifests
- contract lock files
- benchmark runner/check scripts

## Release gates

In the repository release flow, `npm run benchmark:check` is a release gate. It requires:
- `summary.failedCount === 0`
- `summary.failedParityGroupCount === 0`
- `summary.weightedScore >= 95`
- `summary.overallPass === true`
- `contractLockMatchesExpected === true`

If any of those conditions regress, the release check fails.

## Repository commands
- run the benchmark suite:
  - `npm run benchmark:run`
- fail on benchmark regression:
  - `npm run benchmark:check`
- refresh the committed contract lock and latest report after intentional contract/doc/sdk changes:
  - `node scripts/run_agent_benchmarks.cjs --suite core --write-lock --out benchmarks/latest/core-report.json`

## Output

The runner emits a machine-readable JSON report with:
- suite summary and dimension summaries
- per-scenario pass/fail and invariant checks
- per-scenario latency targets and weighted score
- runtime state capture before and after mutation-sensitive scenarios
- contract lock metadata, generated artifact hashes, and lock-match status
- transport parity groups with expected/actual/missing transport membership

In the repository checkout, the committed lock lives at:
- `benchmarks/locks/core.lock.json`

The latest generated report lives at:
- `benchmarks/latest/core-report.json`

## Current suite

The core suite currently contains 19 scenarios across:
- bootstrap and capabilities parity
- schema parity
- MCP authorization and execute-intent denial quality
- workspace path safety
- operation state and lifecycle transitions
- SDK tool-list bootstrap parity

See [`scenario-catalog.md`](./scenario-catalog.md) for the canonical scenario list.
