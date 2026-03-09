---
name: pandora-skill
description: Guides Pandora workflows for safe bootstrap, market discovery, quoting, mirror planning, profile readiness, portfolio closeout, and MCP setup. Use when users ask to bootstrap Pandora, inspect capabilities or schema, quote or trade Pandora markets, plan or verify mirror markets, inspect portfolios, check signer-profile readiness, or choose between local MCP and hosted HTTP gateway setups. Do not use for generic crypto news, unrelated coding work, or general spreadsheet or document tasks.
compatibility: Requires access to Pandora CLI docs, and some workflows assume a local Pandora runtime with Node.js 18+ or a connected MCP server. Start read-only first.
metadata:
  version: 1.1.74
  author: Pandora CLI Contributors
---

# Pandora Skill

Use this skill when the request is specifically about Pandora. Treat it as a workflow and safety layer on top of the Pandora CLI, MCP server, and SDK surfaces.

## Default posture

- start read-only first
- prefer `bootstrap`, `capabilities`, and `schema` before broader exploration
- inspect `policy list` and `profile list` before any mutable path
- only add secrets or signer material on the runtime that will actually execute

## Common requests

### Bootstrap Pandora for an agent

First move:
- `pandora --output json bootstrap`
- `pandora --output json capabilities`
- `pandora --output json schema`

Reference:
- [`references/skills/agent-quickstart.md`](./references/skills/agent-quickstart.md)
- [`references/skills/agent-interfaces.md`](./references/skills/agent-interfaces.md)

### Quote or trade a Pandora market

First move:
- discover the market
- quote before every mutation
- only discuss `trade` after the quote is acceptable

Reference:
- [`references/skills/trading-workflows.md`](./references/skills/trading-workflows.md)
- [`references/skills/command-reference.md`](./references/skills/command-reference.md)

### Plan or verify a mirror market

First move:
- browse candidates
- build a plan
- keep the suggested timing unless there is a justified override
- validate the exact final payload before execution

Reference:
- [`references/skills/mirror-operations.md`](./references/skills/mirror-operations.md)
- [`references/skills/command-reference.md`](./references/skills/command-reference.md)

### Check whether a signer profile is ready

First move:
- inspect `profile list`
- use `profile explain` for the exact tool/mode/category context

Reference:
- [`references/skills/policy-profiles.md`](./references/skills/policy-profiles.md)

### Inspect portfolio, claims, LP exits, or closeout

First move:
- inspect the portfolio and history first
- keep closeout sequencing deterministic

Reference:
- [`references/skills/portfolio-closeout.md`](./references/skills/portfolio-closeout.md)

### Choose local MCP versus hosted HTTP gateway

First move:
- prefer local `pandora mcp` when the agent runs on the same machine
- use `pandora mcp http` only when intentionally hosting a remote gateway
- start hosted gateways with read-only scopes first

Reference:
- [`references/skills/agent-quickstart.md`](./references/skills/agent-quickstart.md)
- [`references/skills/agent-interfaces.md`](./references/skills/agent-interfaces.md)

## Critical safety rules

- Do not ask for a private key as the first step.
- Quote before mutation.
- `mirror deploy|go` requires at least two independent public resolution URLs from different hosts.
- Polymarket, Gamma, and CLOB URLs are discovery inputs only. They are not valid resolution sources.
- Do not reuse validation material if `question`, `rules`, `sources`, or `targetTimestamp` changed.
- Treat mutable profiles as not ready until `profile explain` confirms the exact runtime context.
- Prefer policy-scoped access and profile selectors over raw signer flags when the command family supports them.

## Quick examples

- "Bootstrap Pandora safely for an agent and tell me what to call first."
  - Start with `bootstrap`, `capabilities`, `schema`, then route to agent quickstart.
- "Help me quote a Pandora market before I buy."
  - Route to quote-first trading guidance and avoid immediate execution.
- "Plan a mirror market from Polymarket without going live yet."
  - Stay in browse/plan/dry-run mode and surface validation and source rules.

## Troubleshooting

- If the request is generic crypto commentary or generic software help, do not force Pandora routing.
- If the skill seems too broad, route to the smallest reference below instead of reading everything.
- If Pandora commands fail after the skill triggers, verify runtime connectivity, scopes, or profile readiness before changing the workflow.

## Reference map

- Capability map and canonical routing:
  - [`references/skills/capabilities.md`](./references/skills/capabilities.md)
- Agent bootstrap and transport choices:
  - [`references/skills/agent-quickstart.md`](./references/skills/agent-quickstart.md)
  - [`references/skills/agent-interfaces.md`](./references/skills/agent-interfaces.md)
- Exact flags and command families:
  - [`references/skills/command-reference.md`](./references/skills/command-reference.md)
- Trading, claiming, and arbitrage:
  - [`references/skills/trading-workflows.md`](./references/skills/trading-workflows.md)
- Portfolio inspection, LP exits, and closeout:
  - [`references/skills/portfolio-closeout.md`](./references/skills/portfolio-closeout.md)
- Mirror planning, validation, sync, and closeout:
  - [`references/skills/mirror-operations.md`](./references/skills/mirror-operations.md)
- Policies, profiles, and gateway scopes:
  - [`references/skills/policy-profiles.md`](./references/skills/policy-profiles.md)
- Reusable validated workflows:
  - [`references/skills/recipes.md`](./references/skills/recipes.md)
- Trust posture and support constraints:
  - [`references/trust/release-verification.md`](./references/trust/release-verification.md)
  - [`references/trust/security-model.md`](./references/trust/security-model.md)
  - [`references/trust/support-matrix.md`](./references/trust/support-matrix.md)
