---
title: Pandora CLI surface
type: surface
status: active
updated: 2026-04-27
source_paths:
  - README.md
  - package.json
  - docs/skills/capabilities.md
  - docs/skills/mirror-operations.md
  - docs/skills/command-reference.md
tags:
  - pandora
  - cli
  - surface
---

# CLI Surface

The command line is the human and automation door. It is the fastest way to inspect the system, run checks, and execute workflows from a terminal or CI job.

## Core idea

Pandora keeps pushing users toward a safer order:

1. discover first
2. check readiness
3. quote or plan
4. execute only when the path is clear

That means the `CLI` is not just a bag of commands. It is also the guardrail path.

```mermaid
flowchart LR
  Start["Start read-only"] --> Discover["bootstrap / capabilities / schema"]
  Discover --> Ready["policy list / profile list"]
  Ready --> Plan["quote / plan / explain"]
  Plan --> Execute["trade / sell / mirror / release flows"]
```

## Main jobs this surface handles

- inspect what Pandora can do
- understand command contracts
- check policy and signer readiness
- run market, mirror, portfolio, and release workflows
- support automation and CI

## Polymarket V2 Migration Shape

Pandora now treats Polymarket live hedging as a V2 CLOB flow. In plain English, that means the Polymarket side moved from the old Polygon USDC.e setup to pUSD collateral, new exchange contracts, and a newer CLOB client (Polymarket CLOB V2 SDK).

```mermaid
flowchart LR
  Operator["Operator wallet"] --> Check["polymarket check / balance"]
  Check --> PUSD["Polygon pUSD collateral"]
  PUSD --> Approvals["V2 exchange approvals"]
  Approvals --> CLOB["CLOB V2 order"]
  CLOB --> Mirror["mirror sync / hedge execution"]
```

What we need to have is one safe trading path (V2 CLOB client), one collateral truth (Polygon pUSD), and one readiness gate before live hedges (balance plus approvals).

## Important source files

- `README.md`
- `docs/skills/capabilities.md`
- `docs/skills/command-reference.md`
- `docs/skills/trading-workflows.md`
- `docs/skills/mirror-operations.md`

## Simple explanation

If someone says, "I need to run Pandora myself" (terminal workflow), this is the door they use.

## Related pages

- [Overview](../overview.md)
- [Agent and MCP surface](./agent-and-mcp.md)
- [Release and quality loop](../workflows/release-and-quality-loop.md)
