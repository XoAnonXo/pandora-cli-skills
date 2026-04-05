---
title: Pandora current repo snapshot
type: source
status: active
updated: 2026-04-05
source_paths:
  - README.md
  - package.json
  - docs/skills/capabilities.md
  - docs/skills/agent-interfaces.md
tags:
  - pandora
  - snapshot
  - source-map
---

# Current Repo Snapshot

This page is the quick inventory of the repo after the stale-data cleanup on 2026-04-05.

## High-level counts

| Area | File count | Meaning |
| --- | ---: | --- |
| `docs/` | 31 | guides, trust docs, benchmark docs, roadmaps |
| `tests/` | 149 | confidence and regression coverage |
| `scripts/` | 42 | packaging, checks, release, generation helpers |
| `cli/` | 232 | main command/runtime implementation |
| `sdk/` | 59 | builder-facing integration surfaces |
| `website/` | 16 | public site layer |
| `proving-ground/` | 9 | research lane source files, excluding generated local reports |

## Top-level structure that matters

- `README.md`: main front door
- `SKILL.md`: Pandora-specific agent operating guide
- `docs/skills/`: user and agent workflow docs
- `docs/trust/`: release, security, and support posture
- `docs/proving-ground/`: plain-English guide to the research lane
- `sdk/`: TypeScript, Python, and generated contract bundle
- `cli/`: packaged runtime and command surface
- `tests/`: validation layer
- `scripts/`: repo automation
- `proving-ground/`: sandbox scenarios, helpers, and local generated evidence

## Initial understanding

- The repo is documentation-heavy on purpose.
- The project is trying to serve humans, agents, and app builders from one shared contract.
- Trust, verification, and packaging are part of the product story, not an afterthought.
- The repo now clearly separates small release-proof evidence from larger research evidence.

## Good source anchors for future refreshes

- `README.md`
- `package.json`
- `docs/skills/capabilities.md`
- `docs/skills/agent-interfaces.md`
- `docs/proving-ground/README.md`
- `proving-ground/README.md`
- `docs/trust/release-verification.md`

## Related pages

- [Overview](../overview.md)
- [Repo map](../maps/repo-map.md)
- [Log](../log.md)
