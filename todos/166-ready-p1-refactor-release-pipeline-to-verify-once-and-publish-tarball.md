---
status: complete
priority: p1
issue_id: "166"
tags: [release, npm, workflow, smoke, trust, performance]
dependencies: []
---

# Refactor Release Pipeline To Verify Once And Publish Tarball

## Problem Statement

Local release publication currently takes far too long because `npm publish` re-runs overlapping verification gates multiple times and the smoke harness recursively re-enters package lifecycle hooks. The result is a slow, failure-prone release path that turns packaging into a 30-45 minute operator task instead of a predictable publish step.

## Findings

- `prepublishOnly` in `package.json` runs `npm test`, SBOM generation, release trust, and clean-tree validation.
- `test` calls `build`, and `build` already runs docs, anthropic-skill, release trust, release drift, SDK contract parity, standalone SDK checks, and benchmark freshness.
- `prepack` repeats many of those same checks again before `prepare:publish-manifest`.
- `benchmark:check` currently runs through `build`, `test`, and `prepack`, so it is executed three times in one publish path.
- `tests/smoke/consumer-json-smoke.cjs` calls `npm pack` directly, which re-enters `prepack` during `test:smoke`.
- Measured behavior during the last release showed `npm pack` alone taking about 135 seconds on this machine, so recursive packing materially amplifies wall time.
- `scripts/check_release_trust.cjs` currently asserts the old release topology, including heavy validation in `prepack`, so the trust checker must be updated alongside the script graph.
- The existing GitHub release workflow in `.github/workflows/release.yml` already separates validation and packaging conceptually, but local publish scripts still duplicate work aggressively.

## Proposed Solutions

### Option 1: Verify once, keep `prepack` packaging-only, publish the built tarball

**Approach:** Move all heavy validation into one explicit release verification surface, slim `prepack` down to publish-manifest preparation/restoration only, make smoke use `npm pack --ignore-scripts`, and publish the resulting tarball rather than publishing the repository root.

**Pros:**
- Removes most redundant validation work
- Preserves all release gates
- Aligns local publish behavior with the GitHub release workflow mental model
- Makes failures easier to reason about

**Cons:**
- Requires coordinated changes across scripts, smoke harnesses, trust assertions, and workflow/docs

**Effort:** 4-6 hours

**Risk:** Medium

---

### Option 2: Keep the current topology and only tune timeouts / hardware assumptions

**Approach:** Raise smoke timeouts, keep recursive packaging behavior, and accept the current multi-pass release graph.

**Pros:**
- Lowest implementation risk
- Minimal code churn

**Cons:**
- Leaves the core duplication intact
- Publish remains much slower than necessary
- Failures remain harder to triage

**Effort:** 1-2 hours

**Risk:** Low

## Recommended Action

Implement Option 1. The release path should validate once, pack once, and publish the tarball. Specifically:
- introduce a single release verification command that owns repo validation, tests, smoke, and benchmark freshness
- reduce `prepack` to manifest preparation only
- update smoke to pack with `--ignore-scripts` after explicit manifest prep
- update trust checks to validate the new topology rather than enforce the old duplication
- align release workflow/docs with tarball-first publishing

## Technical Details

**Primary files:**
- `package.json`
- `scripts/check_release_trust.cjs`
- `tests/smoke/consumer-json-smoke.cjs`
- `tests/smoke/pack-install-smoke.cjs`
- `.github/workflows/release.yml`
- `.github/workflows/ci.yml`
- `docs/trust/release-verification.md`
- `docs/trust/release-bundle-playbook.md`
- `docs/trust/final-readiness-signoff.md`

## Resources

- Release workflow: `.github/workflows/release.yml`
- CI workflow: `.github/workflows/ci.yml`
- Trust checker: `scripts/check_release_trust.cjs`
- Smoke harnesses:
  - `tests/smoke/pack-install-smoke.cjs`
  - `tests/smoke/consumer-json-smoke.cjs`
- Publish manifest helpers:
  - `scripts/prepare_publish_manifest.cjs`
  - `scripts/restore_publish_manifest.cjs`

## Acceptance Criteria

- [x] One local release verification command runs the required repo checks once without hidden recursive pack hooks
- [x] `prepack` only prepares the publish manifest and `postpack` restores it
- [x] Consumer smoke no longer re-enters `prepack` during `npm pack`
- [x] `scripts/check_release_trust.cjs` validates the new release topology and continues enforcing release invariants
- [x] The release workflow publishes the built tarball instead of relying on repository-root publish behavior
- [x] Release docs explain the new verify-once / pack-once / publish-tarball model
- [x] Focused verification proves the new release path still passes smoke, trust, and clean-tree gates

## Work Log

### 2026-03-18 - Initial Triage

**By:** Codex

**Actions:**
- Traced the local `npm publish` execution path across `prepublishOnly`, `test`, `build`, and `prepack`
- Confirmed heavy duplication of trust, drift, SDK, docs, and benchmark checks
- Measured `npm pack` duration on this machine at roughly 135 seconds
- Identified `tests/smoke/consumer-json-smoke.cjs` as the recursive `prepack` multiplier
- Confirmed the trust checker currently enforces the old script topology

**Learnings:**
- The dominant problem is duplicated verification, not npm upload time
- Packaging and publish-manifest swapping should remain in lifecycle hooks, but heavyweight validation should move out of `prepack`

### 2026-03-18 - Implementation And Verification

**By:** Codex with delegated worker slices

**Actions:**
- Split the work across delegated slices for smoke harnesses, release/trust script topology, and workflow/doc contract alignment
- Kept `prepack` packaging-only and moved release verification responsibility into the explicit release script graph
- Updated `tests/smoke/consumer-json-smoke.cjs` to prepare the publish manifest explicitly and pack with `npm pack --ignore-scripts`
- Refreshed `scripts/check_release_trust.cjs` so it enforces the new verify-once / pack-once / publish-tarball topology
- Updated release workflow and trust docs to describe and assert tarball-first publishing
- Refreshed benchmark publication artifacts so packaged smoke and benchmark checks validate against the current package version

**Validation:**
- `node scripts/check_release_trust.cjs`
- `node tests/smoke/pack-install-smoke.cjs`
- `node tests/smoke/consumer-json-smoke.cjs`
- `node scripts/run_agent_benchmarks.cjs --suite core --write-lock --out benchmarks/latest/core-report.json`
- `node scripts/update_benchmark_history.cjs`
- `node scripts/check_agent_benchmarks.cjs`
- `npm run release:verify` reached unrelated existing branch failures after the refactor-specific release gates passed

**Learnings:**
- The recursive cost center was the consumer smoke harness re-entering lifecycle hooks during `npm pack`
- Benchmark publication artifacts must stay aligned with `package.json` version or packaged-consumer validation produces misleading release failures
- Focused release validation is now easier to reason about because packaging, trust assertions, and smoke each fail in a single place
- The consolidated `release:verify` surface now fails later and more honestly: after repo/trust/standalone packaging gates pass, remaining failures are exposed as unrelated benchmark/doc/runtime test drift rather than recursive publish-hook noise
