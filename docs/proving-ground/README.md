# Proving Ground

The proving ground is the large-scale research lane for Pandora.
It is separate from the release-proof benchmark suite on purpose.
The job here is not just to prove that the shell still works.
The job is to stress the trading brain until we understand hedge behavior, replay truth, and calibration drift.

## What It Is

The proving ground is a stateful sandbox for:
- outside trade injection
- hedge-loop execution
- restart and failure injection
- replay comparison
- long-run strategy research
- simulator calibration against shadow or live traces

## What It Is Not

The proving ground is not the release gate.
It should not replace the small fixed proof suite.
It should not normalize failures into passes.
It should not use benchmark-only behavior that does not exist in runtime.

## Shared Core

The proving ground and the release-proof suite must share:
- runtime kernel
- adapter interfaces
- audit schema
- replay logic
- lock formats

Only the environment changes:
- clocks can be frozen or accelerated
- venues can be simulated
- faults can be injected
- trade streams can be generated

## Evidence Model

The proving ground should produce the same kinds of receipts every time:
- raw event timeline
- derived replay payload
- risk metrics
- handoff summary
- promote / keep-for-evidence / discard decision

Generated run output lives under `proving-ground/reports/`.
That folder is local evidence, not source-of-truth content.
It should stay disposable and out of git.

The first loop is now wired in the repo:
- it can call the research model `(MiniMax-M2.7-highspeed)`
- it can run quick and full Pandora validation gates
- it writes one report and one handoff per run
- it only mutates code when the tree is clean and the edit is small and reversible `(structured change-set + rollback)`
- the full gate now includes one real hedge-daemon rehearsal through the CLI `(deploy dry-run + start daemon + inject outside trade + verify hedge timing)`

## Calibration

The proving ground is only useful if it stays honest.
That means it needs:
- a fixed holdout set
- scenario family seeds
- world locks
- replay-gold traces
- shadow/live comparison bands

If the sandbox and the live system drift apart, the proving ground stops being evidence and becomes fiction.
