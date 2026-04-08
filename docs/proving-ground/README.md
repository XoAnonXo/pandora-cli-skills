# Proving Ground

The proving ground is the large-scale research lane for Pandora.
It is separate from the release-proof benchmark suite on purpose.
The job here is not just to prove that the shell still works.
The job is to stress the trading brain until we understand hedge behavior, replay truth, and calibration drift.

The newer auto-improvement engine now lives under `docs/proving-ground/autoresearch/` and `proving-ground/autoresearch/`.

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

The CLI improvement lane is now baton-based:
- one isolated lane per CLI section `(lane worktree)`
- one worker gets one try `(single-attempt epoch)`
- every try writes a handoff `(handoff receipt)`
- the Council of Six reviews the proposal before code is touched `(review gate)`
- accepted lane commits replay into one integration branch before the final repo proof `(integration fan-in + promotion gate)`

## Reusable Overnight Engine

The repo now also has a more disciplined engine for cross-project reuse.

What we need to have is a machine that only changes code when it has a real reason `(objective-driven executor)`.

It works from two files:
- `overnight.yaml` = the map of safe mutable surfaces
- `objective.yaml` = the exact goal for this run

The operator surface is:

```bash
node scripts/run_overnight_engine.cjs init
node scripts/run_overnight_engine.cjs validate-adapter --adapter overnight.yaml --objective objective.yaml
node scripts/run_overnight_engine.cjs run --adapter overnight.yaml --objective objective.yaml
node scripts/run_overnight_engine.cjs inspect --batch-dir <batchDir>
node scripts/run_overnight_engine.cjs promote --batch-dir <batchDir>
node scripts/run_overnight_engine.cjs cleanup --batch-dir <batchDir>
```

This engine is intentionally conservative:
- it rejects production edits that do not include test work
- it blocks duplicate or reopened ideas through a batch ledger
- it uses one heterogeneous audit gate instead of the old same-family council
- it still leaves the final morning merge decision to a human

## Calibration

The proving ground is only useful if it stays honest.
That means it needs:
- a fixed holdout set
- scenario family seeds
- world locks
- replay-gold traces
- shadow/live comparison bands

If the sandbox and the live system drift apart, the proving ground stops being evidence and becomes fiction.
