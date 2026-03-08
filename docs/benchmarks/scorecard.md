# Scorecard Format

Benchmark reports are JSON-first.

## Top-level fields
- `schemaVersion`
- `generatedAt`
- `suite`
- `runtime`
- `summary`
- `dimensions`
- `contractLock`
- `expectedContractLockPath`
- `contractLockMatchesExpected`
- `contractLockMismatches`
- `parity`
- `scenarios[]`

## Summary fields
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

## Dimension fields
- `scenarioCount`
- `passedCount`
- `failedCount`
- `latencyPassRate`
- `weightedScore`

## Contract lock fields
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

## Parity fields
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

## Scenario fields
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
