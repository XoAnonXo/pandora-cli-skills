---
name: pandora-cli-skills
summary: Index and operator guide for Pandora CLI capabilities, mirror operations, and agent-native interfaces.
version: 1.1.68
---

# Pandora CLI & Skills

Production CLI for Pandora prediction markets with mirror tooling, sports consensus, on-chain trading, analytics, and agent-native interfaces.

## Use this file as the doc router
Start here, then open the smallest scoped doc that matches the task:

- [`docs/skills/capabilities.md`](./docs/skills/capabilities.md)
  - command families, canonical paths, use-case routing, and PollCategory mapping
- [`docs/skills/command-reference.md`](./docs/skills/command-reference.md)
  - human-oriented command and flag reference, sports matrix, mirror subcommands, and quant/model detail; use capabilities/schema for machine authority
- [`docs/skills/mirror-operations.md`](./docs/skills/mirror-operations.md)
  - mirror timing, validation, independent-source rules, deploy/go workflow, sync, and closeout guidance
- [`docs/skills/agent-interfaces.md`](./docs/skills/agent-interfaces.md)
  - schema, MCP, JSON envelopes, recovery hints, fork runtime, streams, and error codes
- [`docs/skills/legacy-launchers.md`](./docs/skills/legacy-launchers.md)
  - `launch` / `clone-bet` legacy script wrappers and how they differ from mirror flows

## Critical safety rules
- `mirror plan|deploy|go` do **not** assume a generic `+1h` close buffer. They use a sports-aware suggested `targetTimestamp`; use `--target-timestamp <unix|iso>` only when intentionally overriding that suggestion.
- `mirror deploy|go` require at least **2 independent public resolution URLs from different hosts** in `--sources`.
- Polymarket / Gamma / CLOB URLs are discovery inputs only and are **not** valid `--sources`.
- Validation is payload-exact. Run `pandora --output json agent market validate ...` on the final `question`, `rules`, `sources`, and `targetTimestamp` before agent-controlled execute mode.
- CLI mirror execute reruns use `--validation-ticket <ticket>`. MCP execute/live reruns use `agentPreflight = { validationTicket, validationDecision: "PASS", validationSummary }`.
- `sports create run` does not expose a CLI `--validation-ticket`; agent-controlled execute uses `agentPreflight` / `PANDORA_AGENT_PREFLIGHT`.
- `launch` / `clone-bet` still expose `--target-timestamp-offset-hours`; that legacy script flag is **not** the mirror timing model.

## Capability routing
- Machine-first discovery:
  - run `pandora --output json capabilities` for the compact runtime digest
  - run `pandora --output json schema` for the full contract surface
  - run `pandora mcp http ...` only when intentionally hosting the remote HTTP MCP gateway for external agents
- Discovery, scanning, and market lookup:
  - open [`docs/skills/capabilities.md`](./docs/skills/capabilities.md)
- Exact flags for a command family:
  - open [`docs/skills/command-reference.md`](./docs/skills/command-reference.md)
- Mirror deployment, verification, sync, or closeout:
  - open [`docs/skills/mirror-operations.md`](./docs/skills/mirror-operations.md)
- Agent, MCP, schema, JSON output, or recovery contracts:
  - open [`docs/skills/agent-interfaces.md`](./docs/skills/agent-interfaces.md)
- Manual market launcher scripts:
  - open [`docs/skills/legacy-launchers.md`](./docs/skills/legacy-launchers.md)

## Canonical command paths
- Discovery:
  - `pandora scan` is the canonical enriched discovery path.
  - `pandora markets scan` remains a backward-compatible alias.
  - `pandora markets list|get` are the raw indexer browse surfaces.
- Trading:
  - `pandora quote` is the canonical read-only pricing path.
  - `pandora trade` is buy-side execution.
  - `pandora sell` is the explicit sell-side execution path.
  - `pandora claim` is the canonical redeem path.
- Arbitrage:
  - `pandora arb scan` is the canonical arbitrage scan path.
  - `pandora arbitrage` remains the bounded one-shot wrapper.
- Mirror:
  - `pandora mirror browse|plan|deploy|verify|lp-explain|hedge-calc|simulate|go|sync|status|close`
- Agent-native:
    - `pandora --output json capabilities`
    - `pandora --output json schema`
    - `pandora mcp`
    - `pandora mcp http ...` only for remote gateway hosting, not routine discovery
    - `pandora operations get|list|cancel|close`

## PollCategory enum
Use this mapping anywhere a deploy-style flow explicitly exposes `--category`:

- `Politics=0`
- `Sports=1`
- `Finance=2`
- `Crypto=3`
- `Culture=4`
- `Technology=5`
- `Science=6`
- `Entertainment=7`
- `Health=8`
- `Environment=9`
- `Other=10`

Notes:
- Mirror `deploy|go` accept `--category <id|name>`.
- Read-only poll filters are documented with numeric category ids.
- For sports mirror flows, use `Sports` or `1`.

## Minimal setup
```bash
npm install
npm run init-env
npm run doctor
npm run build
```

Node.js `>=18` required.

## Primary references
- Full package/operator overview: [`README.md`](./README.md)
- Sanitized shareable setup guide: [`README_FOR_SHARING.md`](./README_FOR_SHARING.md)
- Contract addresses and protocol reference: [`references/contracts.md`](./references/contracts.md)
