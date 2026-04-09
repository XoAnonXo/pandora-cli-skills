---
title: Pandora knowledge base index
type: index
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
  - index
---

# Pandora Knowledge Base Index

This is the front door to the wiki layer. The repo files are the truth. These pages are the compiled map.

## Start Here

- [Overview](./overview.md): the shortest plain-English explanation of what Pandora is and how the parts fit.
- [Current repo snapshot](./sources/current-repo-snapshot.md): what exists right now, where it lives, and how large each area is.
- [Repo map](./maps/repo-map.md): the top-level layout and ownership map.

## Surfaces

- [CLI surface](./surfaces/cli.md): the terminal door for operators, automation, and CI.
- [Agent and MCP surface](./surfaces/agent-and-mcp.md): the door for AI agents and remote tool access.
- [SDK surface](./surfaces/sdk.md): the door for products and custom integrations.

## Workflows

- [Evidence lanes](./workflows/evidence-lanes.md): how the small release-proof lane and the larger proving-ground lane fit together.
- [Mirror modes and onboarding](./workflows/mirror-modes-and-onboarding.md): how Pandora separates planning, mirroring, and hedge-daemon setup.
- [Overnight autoresearch](./workflows/overnight-autoresearch.md): how Pandora now runs isolated overnight improvement loops and why a human still decides promotion.
- [Release and quality loop](./workflows/release-and-quality-loop.md): how the repo checks trust, tests, and publish readiness.

## Operating Files

- [Log](./log.md): chronological record of wiki maintenance.

## Reading Order By Goal

If you want to understand the product fast:

1. [Overview](./overview.md)
2. [Repo map](./maps/repo-map.md)
3. [Evidence lanes](./workflows/evidence-lanes.md)
4. [Mirror modes and onboarding](./workflows/mirror-modes-and-onboarding.md)
5. [Overnight autoresearch](./workflows/overnight-autoresearch.md)
6. [CLI surface](./surfaces/cli.md)
7. [Agent and MCP surface](./surfaces/agent-and-mcp.md)
8. [SDK surface](./surfaces/sdk.md)

If you want to maintain the wiki:

1. `AGENTS.md`
2. [Current repo snapshot](./sources/current-repo-snapshot.md)
3. [Log](./log.md)

## Notes

- Raw repo docs are still the truth layer.
- This wiki exists to make answers compound instead of being rediscovered from scratch.
