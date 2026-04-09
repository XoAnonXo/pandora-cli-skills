---
title: Pandora current repo snapshot
type: source
status: active
updated: 2026-04-09
source_paths:
  - README.md
  - package.json
  - docs/skills/capabilities.md
  - docs/skills/agent-interfaces.md
  - docs/skills/setup-and-onboarding.md
  - docs/skills/mirror-operations.md
  - docs/proving-ground/README.md
  - docs/proving-ground/autoresearch/overnight-research-module.md
  - proving-ground/README.md
tags:
  - pandora
  - snapshot
  - source-map
---

# Current Repo Snapshot

This page is the quick inventory of the repo after the overnight autoresearch split that shipped in `v1.1.131`.

## High-level counts

| Area | File count | Meaning |
| --- | ---: | --- |
| `docs/` | 33 | guides, trust docs, benchmark docs, and proving-ground explainers |
| `tests/` | 161 | confidence and regression coverage |
| `scripts/` | 45 | packaging, checks, release, and compatibility launcher doors |
| `cli/` | 233 | main command/runtime implementation |
| `sdk/` | 59 | builder-facing integration surfaces |
| `website/` | 29 | public site layer |
| `proving-ground/` | 54 | research lane source files, including the overnight engine and baton system |

## Top-level structure that matters

- `README.md`: main front door
- `SKILL.md`: Pandora-specific agent operating guide
- `docs/skills/`: user and agent workflow docs
- `docs/trust/`: release, security, and support posture
- `docs/proving-ground/`: plain-English guide to the research lane
- `docs/proving-ground/autoresearch/`: design packets for the overnight improvement system
- `sdk/`: TypeScript, Python, and generated contract bundle
- `cli/`: packaged runtime and command surface
- `tests/`: validation layer
- `scripts/`: repo automation plus thin launcher wrappers into deeper proving-ground code
- `proving-ground/`: sandbox scenarios, helpers, overnight engines, and local generated evidence

## Notable shifts since the first wiki pass

- The repo now describes two different mirror jobs more clearly:
  - Pandora Mirroring Mode (`mirror sync --no-hedge`)
  - Polymarket Hedge Mode (`mirror hedge`)
- Setup is now goal-first, so onboarding asks what the user is trying to do before it asks for secrets (`setup --interactive --goal ...`).
- The proving-ground lane is now documented as a real research loop with report and handoff output, plus a hedge-daemon rehearsal in the full gate.
- The proving-ground lane now also documents a reusable overnight improvement engine beside the Pandora-specific baton loop.
- The package version moved to `1.1.131`.

## Initial understanding

- The repo is documentation-heavy on purpose.
- The project is trying to serve humans, agents, and app builders from one shared contract.
- Trust, verification, and packaging are part of the product story, not an afterthought.
- The repo now clearly separates small release-proof evidence from larger research evidence.
- Mirror operations now have a stronger operator story around sell-side retry health and setup goals.
- The proving-ground lane now has its own product shape for safe overnight repo improvement, not just market simulation.

## Good source anchors for future refreshes

- `README.md`
- `package.json`
- `docs/skills/capabilities.md`
- `docs/skills/agent-interfaces.md`
- `docs/proving-ground/README.md`
- `docs/proving-ground/autoresearch/overnight-research-module.md`
- `proving-ground/README.md`
- `docs/trust/release-verification.md`
- `docs/skills/setup-and-onboarding.md`
- `docs/skills/mirror-operations.md`

## Related pages

- [Overview](../overview.md)
- [Repo map](../maps/repo-map.md)
- [Overnight autoresearch](../workflows/overnight-autoresearch.md)
- [Log](../log.md)
