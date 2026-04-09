---
title: Pandora evidence lanes
type: workflow
status: active
updated: 2026-04-09
source_paths:
  - docs/benchmarks/README.md
  - docs/benchmarks/scenario-catalog.md
  - docs/benchmarks/scorecard.md
  - docs/proving-ground/README.md
  - docs/proving-ground/autoresearch/overnight-research-module.md
  - proving-ground/README.md
  - package.json
tags:
  - pandora
  - workflow
  - benchmarks
  - proving-ground
---

# Evidence Lanes

Pandora now uses two different evidence lanes for two different jobs.

```mermaid
flowchart LR
  Release["Release-proof lane<br/>small and fixed"] --> Shared["Shared runtime brain"]
  Research["Proving-ground lane<br/>large and exploratory"] --> Shared
  Shared --> Replay["Replay and audit"]
  Replay --> Decision["ship / study / discard"]
```

## Release-proof lane

This is the small exam that proves the outside contract is still honest.

- stored and published under `core`
- also reachable through the public alias `surface-core`
- meant to stay small, fixed, and easy to audit
- used by release gating

## Proving-ground lane

This is the larger sandbox for long-running mirror, hedge, replay, and strategy work.

- lives under `proving-ground/`
- explained in `docs/proving-ground/README.md`
- writes generated local run output under `proving-ground/reports/`
- writes one report plus one handoff per run in the current wired loop
- can rehearse one real hedge-daemon path inside the full validation gate
- is useful for research, not as a direct release gate

Inside that research lane, the repo now exposes two shapes:

- a Pandora-specific relay loop for improving CLI sections `(baton system)`
- a more reusable overnight engine driven by a repo map and a goal `(overnight adapter + objective)`

```mermaid
flowchart TD
  Research["Proving-ground research lane"] --> Baton["CLI baton lane"]
  Research --> Overnight["Reusable overnight engine"]
  Baton --> Evidence["handoffs, receipts, lane proofs"]
  Overnight --> Evidence
```

## Why the split matters

One lane proves the public shell still matches the promise.
The other lane helps the team learn how the trading brain behaves under pressure over time.

Keeping them separate avoids a common mistake:

- making the release gate too large and noisy
- pretending exploratory simulations are the same thing as shipped proof

## Related pages

- [Overnight autoresearch](./overnight-autoresearch.md)
- [Release and quality loop](./release-and-quality-loop.md)
- [Overview](../overview.md)
- [Current repo snapshot](../sources/current-repo-snapshot.md)
