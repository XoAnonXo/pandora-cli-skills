# Scorecard Format

Pandora uses two connected evaluation surfaces:

- `surface-core`: the public name for the small release-proof exam for CLI, MCP, and SDK contract truth
- `proving-ground`: the large sandbox for mirror, hedge, replay, and strategy research

The committed release-proof artifacts still publish under the `core` name today.
The scorecard below describes that release-proof artifact shape. The proving-ground uses the same evidence style, but its promotion rules are stricter on trading risk and replay truth.

## Release-Proof Surface

Release-proof reports are JSON-first and stay small enough to audit directly.

### Top-level fields
- `schemaVersion`
- `generatedAt`
- `suite`
- `requestedSuite` `(raw runner output only; omitted from the published report)`
- `runtime`
- `summary`
- `dimensions`
- `contractLock`
- `expectedContractLockPath`
- `contractLockMatchesExpected`
- `contractLockMismatches`
- `parity`
- `scenarios[]`

### Summary fields
- `scenarioCount`
- `passedCount`
- `failedCount`
- `successRate`
- `latencyPassRate`
- `weightedScoreBase`
- `weightedScore`
- `parityGroupCount`
- `failedParityGroupCount`
- `overallPass`

### Dimension fields
- `scenarioCount`
- `passedCount`
- `failedCount`
- `latencyPassRate`
- `weightedScore`

### Contract lock fields
- `commandDescriptorVersion`
- `generatedManifestVersion`
- `generatedManifestCommandDescriptorVersion`
- `generatedManifestPackageVersion`
- `generatedManifestRegistryDigest`
- `registryDigest`
- `documentationContentHash`
- `documentationRegistryHash`
- `schemaHash`
- `generatedArtifactHashes`

### Parity fields
- `groups[]`
- `failedGroups[]`

Each parity group includes:
- `groupId`
- `scenarioIds`
- `expectedTransports`
- `actualTransports`
- `missingTransports`
- `matches`
- `hashCount`
- `hashes`

### Scenario fields
- `id`
- `title`
- `transport`
- `dimensions`
- `passed`
- `durationMs`
- `checks[]`
- `score`
- `parityGroup`
- `parityExpectedTransports`
- `parityHash`
- `runtimeState`

Each `checks[]` entry contains:
- `id`
- `passed`
- `message`

Each `score` object contains:
- `latencyTargetMs`
- `latencyPass`
- `totalChecks`
- `passedChecks`
- `successScore`
- `latencyScore`
- `weighted`

`runtimeState` is present for scenarios that care about side effects, especially mutation-denial and operation lifecycle checks.

## What the Release Score Proves

The release-proof score proves that Pandora still keeps its outside promise:
- transport parity stays intact
- schema and capability surfaces stay stable
- denial paths still deny
- seeded lifecycle paths still behave as published
- the package and repo stay in lockstep

It does **not** prove that trading is economically good.
It does **not** prove that the hedge daemon is robust under long-running event streams.

## What The Proving-Ground Score Adds

The proving-ground uses the same evidence discipline, but it adds risk and replay truth:
- hedge latency
- hedge completion ratio
- exposure excursion
- exposure-time integral
- duplicate hedges
- orphan positions
- restart recovery time
- unexpected actions
- replay lineage match
- calibration drift

For the proving-ground, hard gates matter more than blended scores.
A weighted score can still exist, but it is only a dashboard signal.
The promotion decision comes from invariants, holdouts, and replay truth.
