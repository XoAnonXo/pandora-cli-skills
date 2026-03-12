---
name: pandora-cli-skills
description: Guides Pandora CLI workflows for safe bootstrap, market discovery, pricing, mirror planning, portfolio closeout, profile readiness, and MCP setup. Use when users ask to bootstrap Pandora, inspect capabilities or schema, quote or trade Pandora markets, plan or verify mirror markets, inspect portfolios, check signer-profile readiness, or start Pandora MCP/SDK integrations. Do not use for generic crypto news, unrelated coding tasks, or general spreadsheet or document work.
compatibility: Requires Node.js 18+ and access to the Pandora CLI or this repository. Some workflows need network access or signer material; start read-only first.
metadata:
  version: 1.1.101
  author: Pandora CLI Contributors
---

# Pandora CLI Skill

Use this skill when the user needs Pandora-specific help, not just generic market commentary. Prefer outcome-first guidance: understand what the user wants to accomplish, start with read-only discovery, then move into quoting, planning, validation, or execution only when the selected workflow actually needs it.

## Quick start

Start with these defaults unless the user already supplied a narrower request:

1. Bootstrap the surface:
   - `pandora --output json bootstrap`
   - `pandora --output json capabilities`
   - `pandora --output json schema`
2. Inspect policy and signer readiness before mutable work:
   - `pandora --output json policy list`
   - `pandora --output json profile list`
3. Choose the smallest scoped reference for the task instead of reading everything.

## Use this skill for

- discovering Pandora markets, capabilities, schema, and command routing
- quoting or planning a trade before mutation
- planning, validating, verifying, or closing mirror markets
- checking profile readiness, policy scopes, or MCP bootstrap paths
- inspecting portfolios, claims, LP exits, and closeout flows
- explaining how Pandora MCP, HTTP gateway, or SDK surfaces should be used safely

## Common requests and first moves

### "Bootstrap Pandora for an agent"

First move:
- run `bootstrap`, then `capabilities`, then `schema`
- inspect `policy list` and `profile list` before asking for secrets
- use [`docs/skills/agent-quickstart.md`](./docs/skills/agent-quickstart.md)

### "Quote or trade a Pandora market"

First move:
- discover with `scan` or inspect the market directly
- quote before every mutation
- use [`docs/skills/trading-workflows.md`](./docs/skills/trading-workflows.md)

### "Plan or verify a mirror market from Polymarket"

First move:
- browse candidates, build a plan, keep the suggested `targetTimestamp`
- require two independent public resolution sources
- use [`docs/skills/mirror-operations.md`](./docs/skills/mirror-operations.md)

### "Check whether my profile is ready"

First move:
- inspect `profile list`
- use `profile explain` for the exact command, mode, and category before execution
- use [`docs/skills/policy-profiles.md`](./docs/skills/policy-profiles.md)

### "Inspect portfolio, claims, or closeout"

First move:
- inspect portfolio and history first
- use claim, LP removal, and mirror closeout flows in order
- use [`docs/skills/portfolio-closeout.md`](./docs/skills/portfolio-closeout.md)

### "Start Pandora MCP"

First move:
- prefer local `pandora mcp` when the agent runs on the same machine
- use `pandora mcp http` only when intentionally hosting a remote gateway
- use [`docs/skills/agent-interfaces.md`](./docs/skills/agent-interfaces.md)

## Examples

- User says: "Help me set up Pandora for a planning-only agent."
  - Start with `bootstrap`, `capabilities`, `schema`, `policy list`, and `profile list`, then route to [`docs/skills/agent-quickstart.md`](./docs/skills/agent-quickstart.md).
- User says: "Quote this market before I buy."
  - Inspect the market, run `quote`, avoid execution until the quote is acceptable, then route to [`docs/skills/trading-workflows.md`](./docs/skills/trading-workflows.md).
- User says: "Mirror this Polymarket market safely."
  - Build a mirror plan, preserve the suggested close timing, validate the exact final payload, then route to [`docs/skills/mirror-operations.md`](./docs/skills/mirror-operations.md).

## Critical safety rules

- Start read-only first. Do not ask for signer material until the selected tool path actually requires it.
- Quote before mutation. For mirror workflows, validate the exact final payload before execute mode.
- `mirror deploy|go` requires at least two independent public resolution URLs from different hosts in `--sources`.
- Polymarket, Gamma, and CLOB URLs are discovery inputs only. They are not valid resolution sources.
- Do not reuse validation material if `question`, `rules`, `sources`, or `targetTimestamp` changed.
- Treat mutable profiles as not ready until `profile explain` confirms the exact command, mode, and runtime context.
- Prefer policy-scoped MCP access and signer profiles over raw `--private-key` when the command family supports it.

## Anti-patterns and troubleshooting

- Do not use this skill for generic crypto research, general market commentary, or unrelated software tasks.
- If Pandora-specific requests are not triggering, expand the request with Pandora-specific outcomes such as "bootstrap Pandora", "quote a Pandora market", "plan a mirror market", or "check profile readiness".
- If MCP calls fail, verify whether the issue is Pandora connectivity or scope/readiness before rewriting the workflow.
- If a workflow feels too broad, route to the smallest task-specific document below instead of reading the full repo.

## Smallest useful references

- Capability map and canonical routing:
  - [`docs/skills/capabilities.md`](./docs/skills/capabilities.md)
- Fastest safe bootstrap for agents:
  - [`docs/skills/agent-quickstart.md`](./docs/skills/agent-quickstart.md)
- Exact flags and command families:
  - [`docs/skills/command-reference.md`](./docs/skills/command-reference.md)
- Trading, selling, claiming, and arbitrage:
  - [`docs/skills/trading-workflows.md`](./docs/skills/trading-workflows.md)
- Portfolio inspection, LP exits, and closeout:
  - [`docs/skills/portfolio-closeout.md`](./docs/skills/portfolio-closeout.md)
- Mirror planning, validation, sync, and closeout:
  - [`docs/skills/mirror-operations.md`](./docs/skills/mirror-operations.md)
- Agent, MCP, schema, JSON contracts, and recovery:
  - [`docs/skills/agent-interfaces.md`](./docs/skills/agent-interfaces.md)
- Policy packs, signer profiles, and gateway scopes:
  - [`docs/skills/policy-profiles.md`](./docs/skills/policy-profiles.md)
- Reusable validated workflows:
  - [`docs/skills/recipes.md`](./docs/skills/recipes.md)

## Additional references

- Full package and repo overview:
  - [`README.md`](./README.md)
- Sanitized shareable setup guide:
  - [`README_FOR_SHARING.md`](./README_FOR_SHARING.md)
- Anthropic skill install and evaluation docs:
  - [`docs/skills/install-anthropic-skill.md`](./docs/skills/install-anthropic-skill.md)
  - [`docs/skills/anthropic-skill-evals.md`](./docs/skills/anthropic-skill-evals.md)
- Benchmark methodology and score interpretation:
  - [`docs/benchmarks/README.md`](./docs/benchmarks/README.md)
  - [`docs/benchmarks/scenario-catalog.md`](./docs/benchmarks/scenario-catalog.md)
  - [`docs/benchmarks/scorecard.md`](./docs/benchmarks/scorecard.md)
- Release verification and trust posture:
  - [`docs/trust/release-verification.md`](./docs/trust/release-verification.md)
  - [`docs/trust/security-model.md`](./docs/trust/security-model.md)
  - [`docs/trust/support-matrix.md`](./docs/trust/support-matrix.md)
- Legacy launcher wrappers:
  - [`docs/skills/legacy-launchers.md`](./docs/skills/legacy-launchers.md)
