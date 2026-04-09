---
title: Pandora release and quality loop
type: workflow
status: active
updated: 2026-04-08
source_paths:
  - package.json
  - docs/trust/release-verification.md
  - docs/trust/security-model.md
  - docs/benchmarks/README.md
  - docs/proving-ground/README.md
tags:
  - pandora
  - workflow
  - release
  - quality
---

# Release And Quality Loop

This repo does not treat release as "zip it and hope". It treats release as a proof chain.

## Plain-English view

Before something ships, Pandora wants to prove four things:

- the code shape is valid
- the workflows still work
- the benchmark expectations still hold
- the trust bundle is present

```mermaid
flowchart LR
  Change["Code or doc change"] --> Typecheck["typecheck"]
  Typecheck --> RepoVerify["repo verification"]
  RepoVerify --> TestVerify["tests"]
  TestVerify --> Bench["benchmark check"]
  TestVerify --> Journeys["journeys + surface checks"]
  Journeys --> Bench["benchmark check"]
  Bench --> Finalize["release finalize"]
  Finalize --> Trust["SBOM + trust checks + drift checks"]
  Trust --> Publish["publish artifact"]
```

## Signals seen in `package.json`

- `build` runs type checks
- `verify:repo` runs repo verification
- `verify:tests` runs tests
- `e2e:surfaces`, `e2e:journeys`, and `e2e:agents` exist as deeper end-to-end trust probes
- `release:verify` combines repo checks, tests, and benchmark checks
- `release:finalize` rebuilds benchmark and software bill of materials outputs
- `proving-ground:autoresearch` exists beside the release gate as a research loop, not as the ship gate
- `release:publish` runs the full publish path with trust and drift checks

## Why this matters

This suggests Pandora is trying to be safe for external sharing, not just local hacking.

The trust documents under `docs/trust/` are not side notes. They are part of the release story.
The `proving-ground` is related, but separate. It is the larger research lane, not the release gate.

## Important source files

- `package.json`
- `docs/trust/release-verification.md`
- `docs/trust/security-model.md`
- `docs/trust/support-matrix.md`

## Related pages

- [Evidence lanes](./evidence-lanes.md)
- [Overview](../overview.md)
- [Repo map](../maps/repo-map.md)
- [Current repo snapshot](../sources/current-repo-snapshot.md)
