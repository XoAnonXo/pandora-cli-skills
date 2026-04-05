# Pandora Benchmark Pack

This repository stores one committed release-proof suite today under `core`.
The runner also accepts `surface-core` as a public alias for that same lane.
That lane is the small, fixed release-proof exam for Pandora's outside promise.
It is the thing we use to prove that the transport and contract surface still behaves the way the repo says it should.

Pandora also has a separate research lane:
- `core`: the committed storage and publication name for the release-proof suite
- `surface-core`: the public alias for that same release-proof lane
- `proving-ground`: a separate sandbox for long-running mirror, hedge, replay, and strategy research

The current suite currently contains 19 scenarios.

Two different benchmark surfaces exist:
- Packaged reference surface:
  - `docs/benchmarks/**`
  - `benchmarks/latest/core-report.json`
  - `benchmarks/latest/core-bundle.json`
  - `benchmarks/latest/core-history.json`
  - `docs/benchmarks/history.json`
- Repository maintainer surface:
  - `benchmarks/scenarios/**`
  - `benchmarks/locks/**`
  - `benchmarks/lib/**`
  - `scripts/run_agent_benchmarks.cjs`
  - `scripts/check_agent_benchmarks.cjs`

The npm package ships the reference surface only. The scenario manifests, lock file, runner library, and check scripts remain source-tree maintainer tooling.
Tagged GitHub releases publish the latest report and lock as trust assets, but not the full benchmark harness.
Tagged GitHub releases also publish:
- `core-bundle.json`
- `core-history.json`
- `benchmark-publication-bundle.tar.gz`
- `benchmark-publication-manifest.json`

Benchmark evidence is only one layer of the A+ trust story:
- release verification proves where the package came from
- benchmark evidence proves what contract/runtime surfaces passed the shipped readiness suite
- operation receipts prove what a specific installed runtime actually did during terminal mutable work

For the amended architecture:
- release-proof evidence stays small, fixed, and auditable
- proving-ground evidence stays separate, large, and exploratory
- replay is the bridge between both, because it turns real or shadowed actions into evidence that can be compared across runs

## How Agents Should Reach These Docs

The benchmark explainability surface is part of the documented agent router exposed by `pandora --output json capabilities`:
- `documentation.router.taskRoutes` includes:
  - `Benchmark methodology, scenarios, or scorecards`
  - `Benchmark scenario catalog and parity coverage`
  - `Benchmark weighted scoring and score interpretation`
  - `Release verification, support matrix, or security posture`
- `documentation.skills` also lists the shipped benchmark docs directly:
  - `docs/benchmarks/README.md`
  - `docs/benchmarks/scenario-catalog.md`
  - `docs/benchmarks/scorecard.md`
  - `docs/proving-ground/README.md`
  - `docs/trust/support-matrix.md`

When a benchmark report is not self-explanatory:
- use this README for suite shape, lock semantics, and release-gate behavior
- use `scenario-catalog.md` to map a failing scenario id or parity group to the exact manifest-backed check
- use `scorecard.md` to explain score penalties, parity failures, and readiness interpretation
- use `history.json` to compare the current shipped score against prior recorded release entries

## Benchmark History Surface

Pandora now ships a minimal benchmark history artifact at:
- `docs/benchmarks/history.json`
- `benchmarks/latest/core-history.json`

Pandora also ships a machine-readable latest-publication bundle at:
- `benchmarks/latest/core-bundle.json`

What it is:
- a stable release-to-release index derived from:
  - `benchmarks/latest/core-report.json`
  - `benchmarks/locks/core.lock.json`
  - `package.json`
- one entry per package version
- a lightweight trend summary comparing the latest entry to the immediately previous recorded entry

What it is not:
- not the full benchmark evidence bundle
- not a replacement for `core-report.json`
- not a long-term hosted leaderboard

How it is maintained:
- `npm run benchmark:history`
- `release:prep` and `prepack` both refresh it after writing the latest report and lock

The benchmark publication bundle and manifest are generated from the same source of truth:
- `core-report.json`
- `core.lock.json`
- `core-bundle.json`
- `core-history.json`
- `docs/benchmarks/history.json`

## What The Runner Actually Does

`npm run benchmark:run` maps to:

```bash
node scripts/run_agent_benchmarks.cjs
```

With no extra flags, it:
- runs the `core` suite
- prints a fresh JSON report to stdout
- does not update `benchmarks/locks/core.lock.json`
- does not update `benchmarks/latest/core-report.json`

Optional runner flags:
- `--suite <name>`: select the suite; `core` is the committed storage name and `surface-core` currently aliases to the same release-proof suite
- `--out <path>`: write the generated report JSON to a file
- `--write-lock`: write the generated `contractLock` into the suite lock file
- `--lock-path <path>`: override the default lock path when `--write-lock` is used

Implementation note:
- the repo stores release-proof manifests, locks, and published JSONs under `core`
- the runner can also accept `surface-core` when the caller wants the public lane name
- the proving-ground does not replace this runner; it lives beside it and reuses the same runtime kernel and replay logic

The default suite expectation is hard-coded in the runner:
- expected scenario count: `19`
- minimum weighted score: `95`

## What `benchmark:check` Enforces

`npm run benchmark:check` maps to:

```bash
node scripts/check_agent_benchmarks.cjs
```

It reruns the suite and exits non-zero if any of the following are true:
- `summary.failedCount > 0`
- `summary.scenarioCount` does not match the number of JSON manifests under `benchmarks/scenarios/core`
- `summary.scenarioCount` does not match the suite expectation (`19` for `core`)
- `summary.weightedScore < 95` unless `--min-score` overrides that threshold
- `contractLockMatchesExpected !== true`
- `parity.failedGroups.length > 0`
- `benchmarks/latest/core-report.json` is missing
- the committed `benchmarks/latest/core-report.json` is stale after the runner's freshness normalization

For the release-proof lane, the check script is the gate.
For proving-ground work, the gate is different:
- no hidden normalization
- no benchmark-only success
- no promotion without replay and calibration evidence

The freshness comparison is not a raw file diff. The check script normalizes away volatile fields such as `generatedAt` before comparing the committed report to a newly generated one.

## External Reproducibility

If you want to reproduce the benchmark evidence from a published release, use a checkout of the exact release tag rather than the installed npm package alone.

Recommended flow:

```bash
git clone https://github.com/XoAnonXo/pandora-cli-skills.git
cd pandora-cli-skills
git checkout vX.Y.Z
npm ci
npm run benchmark:check
npm run benchmark:history
```

What this proves:

- the tagged source tree still reproduces a passing benchmark run
- the committed `benchmarks/latest/core-report.json` is fresh relative to the runner
- the committed `benchmarks/latest/core-bundle.json` and `benchmarks/latest/core-history.json` are fresh relative to the runner
- the committed `benchmarks/locks/core.lock.json` still matches the live contract/artifact digest set
- the docs-facing `docs/benchmarks/history.json` still matches the generated benchmark history surface

If you want to refresh the benchmark evidence locally for inspection, run:

```bash
node scripts/run_agent_benchmarks.cjs --suite core --write-lock --out benchmarks/latest/core-report.json
```

Then compare:

- refreshed `benchmarks/latest/core-report.json`
- refreshed `benchmarks/latest/core-bundle.json`
- refreshed `benchmarks/latest/core-history.json`
- refreshed `benchmarks/locks/core.lock.json`
- refreshed `docs/benchmarks/history.json`
- downloaded release assets `core-report.json` and `core.lock.json`
- downloaded release assets `core-bundle.json`, `core-history.json`, and `benchmark-publication-manifest.json`

Do not treat the packaged npm install as a full benchmark-reproduction environment. It ships the latest report as reference evidence, not the repository benchmark harness.

## Lock Semantics

The committed lock lives at:
- `benchmarks/locks/core.lock.json`

The lock document schema is:
- `schemaVersion`
- `suite`
- `contractLock`

The runner currently writes and compares these `contractLock` fields:
- `commandDescriptorVersion`
- `generatedManifestVersion`
- `generatedManifestCommandDescriptorVersion`
- `generatedManifestPackageVersion`
- `generatedManifestRegistryDigest`
- `registryDigest`
- `documentationContentHash`
- `documentationRegistryHash`
- `schemaHash`
- `capabilitiesLocalHash`
- `capabilitiesRemoteTemplateHash`
- `generatedArtifactHashes`

`generatedArtifactHashes` is keyed exactly as:
- `generatedContractRegistry`
- `generatedCommandDescriptors`
- `generatedMcpToolDefinitions`
- `generatedManifest`
- `tsContractRegistry`
- `tsCommandDescriptors`
- `tsMcpToolDefinitions`
- `tsManifest`
- `pyContractRegistry`
- `pyCommandDescriptors`
- `pyMcpToolDefinitions`
- `pyManifest`

Those keys reflect the current runner implementation, including the fact that the shared root JSON bundle is hashed for the `generated*`, `ts*ContractRegistry`, `ts*CommandDescriptors`, `ts*McpToolDefinitions`, `py*ContractRegistry`, `py*CommandDescriptors`, and `py*McpToolDefinitions` entries, while the TypeScript and Python package-local manifests are hashed separately.

## Report Shape

The committed latest benchmark report lives at:
- `benchmarks/latest/core-report.json`

The generated report includes:
- top-level `schemaVersion`, `generatedAt`, `suite`, and `runtime.packageVersion`
- `summary`
- `dimensions`
- `contractLock`
- `expectedContractLockPath`
- `contractLockMatchesExpected`
- `contractLockMismatches`
- `parity`
- `scenarios`

`summary.overallPass` is derived inside the runner from:
- every scenario passing
- every scenario meeting its latency target
- zero failed parity groups
- `contractLockMatchesExpected === true`

The release-grade committed report must therefore satisfy:
- `summary.overallPass === true`
- `contractLockMatchesExpected === true`

`summary.weightedScore` is also parity-sensitive:
- the runner computes `weightedScoreBase` from per-scenario scores and weights
- if any parity group fails, `weightedScore` is forced to `0`

## Release And Packaging Paths

These root-package scripts currently include benchmark checks:
- `build`
  - runs `benchmark:check`
- `prepack`
  - runs `benchmark:check`
  - runs `prepare:publish-manifest`
  - reruns the benchmark suite with `--write-lock --out benchmarks/latest/core-report.json`
  - reruns `scripts/check_agent_benchmarks.cjs`
- `release:prep`
  - runs `benchmark:check`
- `test`
  - runs `benchmark:check` after build, unit, CLI, agent-workflow, and smoke gates

The exact manual refresh command used by the repo is:

```bash
node scripts/run_agent_benchmarks.cjs --suite core --write-lock --out benchmarks/latest/core-report.json
```

That command writes the lock and latest report. It does not, by itself, verify freshness against the committed report; `benchmark:check` performs that verification.

Current release workflow linkage:

- `release:prep` runs `check:sdk-contracts`, `check:sdk-standalone`, smoke tests, writes a fresh benchmark report/lock, then runs `benchmark:check`
- `.github/workflows/release.yml` uploads:
  - `core-report.json`
  - `core.lock.json`
  - `checksums.sha256`

That means the published benchmark evidence is release-attached and checksum-covered, but external reproduction still requires a tagged source checkout.

## Current Scope

The `core` suite currently covers:
- CLI JSON bootstrap for `capabilities` and `schema`
- stdio MCP bootstrap for `capabilities`, `schema`, and `listTools`
- remote HTTP MCP bootstrap for `capabilities`, `schema`, and `listTools`
- remote hidden-tool scope denial
- stdio and remote execute-intent denial
- stdio and remote workspace path denial
- empty operations list bootstrap
- seeded operations `get` parity across CLI, stdio MCP, and remote MCP
- CLI-only seeded operations `cancel` and `close`

See [scenario-catalog.md](./scenario-catalog.md) for the canonical manifest-backed scenario list.
