---
title: Pandora knowledge base log
type: log
status: active
updated: 2026-04-27
source_paths:
  - README.md
  - SKILL.md
  - package.json
  - docs/skills/capabilities.md
  - docs/skills/agent-interfaces.md
tags:
  - pandora
  - knowledge-base
  - log
---

# Pandora Knowledge Base Log

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

## [2026-04-27] migration | Polymarket CLOB V2

Reviewed source files:

- `README.md`
- `package.json`
- `cli/lib/polymarket_trade_adapter.cjs`
- `cli/lib/polymarket_ops_service.cjs`
- `cli/lib/bridge_command_service.cjs`
- `docs/skills/mirror-operations.md`
- `docs/skills/command-reference.md`

Knowledge-base actions:

- refreshed the CLI surface map with the Polymarket V2 shape
- recorded that the Polymarket live path now centers on the V2 CLOB client, Polygon pUSD collateral, and V2 readiness checks

Decision:

- Kept detailed command behavior in the raw docs and used the wiki only for the durable architecture map.
