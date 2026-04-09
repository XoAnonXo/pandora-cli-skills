---
title: Pandora knowledge base log
type: log
status: active
updated: 2026-04-09
source_paths:
  - README.md
  - SKILL.md
  - package.json
  - docs/skills/capabilities.md
  - docs/skills/agent-interfaces.md
  - docs/skills/setup-and-onboarding.md
  - docs/skills/mirror-operations.md
  - docs/proving-ground/README.md
  - docs/proving-ground/autoresearch/overnight-research-module.md
tags:
  - pandora
  - knowledge-base
  - log
---

# Pandora Knowledge Base Log

## [2026-04-09] refresh | overnight autoresearch map added

Reviewed source files:

- `package.json`
- `docs/proving-ground/README.md`
- `docs/proving-ground/autoresearch/overnight-research-module.md`
- `docs/proving-ground/autoresearch/oracle-review-packet.md`
- `proving-ground/README.md`
- `scripts/run_proving_ground_autoresearch.cjs`
- `scripts/run_overnight_engine.cjs`
- `scripts/run_cli_baton_autoresearch.cjs`
- `scripts/run_cli_section_autoresearch.cjs`

Updated wiki pages:

- `knowledge-base/overview.md`
- `knowledge-base/workflows/evidence-lanes.md`
- `knowledge-base/sources/current-repo-snapshot.md`
- `knowledge-base/index.md`

Created wiki pages:

- `knowledge-base/workflows/overnight-autoresearch.md`

Decisions:

- Treated the repo changes as meaningful because the proving-ground lane now has a clearer reusable overnight engine shape, not just a Pandora-only sandbox.
- Added one focused workflow page instead of overloading the broader evidence-lanes page with too much detail.
- Updated the repo snapshot counts because the source tree shape changed enough that the old counts were stale.

## [2026-04-05] setup | initial wiki created

Reviewed source files:

- `README.md`
- `README_FOR_SHARING.md`
- `SKILL.md`
- `package.json`
- `docs/skills/capabilities.md`
- `docs/skills/agent-interfaces.md`

Created wiki pages:

- `knowledge-base/index.md`
- `knowledge-base/overview.md`
- `knowledge-base/maps/repo-map.md`
- `knowledge-base/surfaces/cli.md`
- `knowledge-base/surfaces/agent-and-mcp.md`
- `knowledge-base/surfaces/sdk.md`
- `knowledge-base/workflows/release-and-quality-loop.md`
- `knowledge-base/sources/current-repo-snapshot.md`

Decisions:

- Kept the repo files as the truth layer instead of moving docs into a new system.
- Added a separate wiki layer so summaries can evolve without rewriting raw source docs.
- Added a root `AGENTS.md` so future agents maintain the wiki consistently.

## [2026-04-05] cleanup | stale docs and generated research output

Reviewed stale areas:

- benchmark docs that still framed `surface-core` as future-only
- proving-ground docs that still treated `reports/` as not implemented
- root docs that described `npm run build` too broadly
- knowledge-base pages that predated the proving-ground lane

Cleanup actions:

- corrected benchmark docs to reflect current `core` storage plus `surface-core` alias behavior
- updated proving-ground docs to treat `reports/` as generated local evidence
- refreshed root docs and skill routing to include the proving-ground lane
- added `proving-ground/reports/` to `.gitignore`
- refreshed the knowledge base to match the repo's current evidence model

## [2026-04-08] refresh | mirror modes, setup goals, and proving-ground loop

Reviewed source files:

- `README.md`
- `package.json`
- `docs/skills/setup-and-onboarding.md`
- `docs/skills/mirror-operations.md`
- `docs/proving-ground/README.md`
- `docs/benchmarks/README.md`

Wiki updates:

- refreshed the overview and CLI surface to explain the clearer split between Pandora mirroring, Polymarket hedge mode, and the hybrid loop
- updated the repo snapshot with current file counts and the new package version context
- refreshed the evidence and release workflow pages to reflect the proving-ground handoff/report loop and the deeper end-to-end checks listed in `package.json`
- added `knowledge-base/workflows/mirror-modes-and-onboarding.md` as the durable map for goal-first setup
- updated `knowledge-base/index.md` navigation to link the new workflow page

Reason for update:

- there were meaningful repo changes after the last log entry, especially around mirror operations, onboarding goals, and proving-ground behavior
