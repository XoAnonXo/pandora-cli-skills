# Pandora CLI & Skills — Shareable Package

Sanitized, shareable copy of the Pandora CLI docs and package metadata.

## Included
- `SKILL.md`
- `README.md`
- `README_FOR_SHARING.md`
- `docs/skills/*.md`
- `package.json`
- `package-lock.json`
- `.gitignore`
- `scripts/.env.example`
- `scripts/create_market_launcher.ts`
- `scripts/create_polymarket_clone_and_bet.ts`
- `references/creation-script.md`
- `references/contracts.md`
- `references/checklist.md`

## Intentionally omitted
- `.env`
- `wallet.json`
- local runtime secrets
- `node_modules`

## Setup
Prerequisite: Node.js `>=18`.

```bash
npm install
npm run init-env
npm run doctor
npm run build
node cli/pandora.cjs help
```

Operation tracking:
- use `pandora --output json operations list --status planned,queued,running --limit 20` to inspect persisted mutable-operation records

Fill `scripts/.env` with:
- `CHAIN_ID`
- `PRIVATE_KEY`
- `RPC_URL`
- `ORACLE`
- `FACTORY`
- `USDC`

Optional live Polymarket hedge env:
- `POLYMARKET_PRIVATE_KEY`
- `POLYMARKET_FUNDER`
- `POLYMARKET_API_KEY`
- `POLYMARKET_API_SECRET`
- `POLYMARKET_API_PASSPHRASE`
- `POLYMARKET_HOST`

## Documentation map
- [`SKILL.md`](./SKILL.md)
  - root overview and doc router
- [`docs/skills/capabilities.md`](./docs/skills/capabilities.md)
  - capability map and PollCategory guidance
- [`docs/skills/command-reference.md`](./docs/skills/command-reference.md)
  - human-oriented command and flag reference; use capabilities/schema for machine authority
- [`docs/skills/mirror-operations.md`](./docs/skills/mirror-operations.md)
  - mirror safety, validation, sync, and closeout workflow
- [`docs/skills/agent-interfaces.md`](./docs/skills/agent-interfaces.md)
  - schema, MCP, JSON envelopes, recovery hints, and runtime contracts
- [`docs/skills/legacy-launchers.md`](./docs/skills/legacy-launchers.md)
  - legacy `launch` / `clone-bet` notes

## Mirror operator guidance
- `mirror plan|deploy|go` use a sports-aware suggested `targetTimestamp`; they do not rely on a generic `+1h` rule.
- Use `--target-timestamp <unix|iso>` only for explicit close-time overrides.
- Fresh `mirror deploy` / `mirror go` runs require at least two independent public resolution URLs from different hosts in `--sources`.
- Polymarket, Gamma, and CLOB URLs are discovery inputs only and are not valid `--sources`.
- Validation is exact-payload:
  - validate the final `question`, `rules`, `sources`, and `targetTimestamp`
  - rerun CLI execute with `--validation-ticket <ticket>`
  - rerun MCP execute/live with `agentPreflight = { validationTicket, validationDecision: "PASS", validationSummary }`
- `sports create run` does not expose a CLI `--validation-ticket`; agent-controlled execute uses `agentPreflight` / `PANDORA_AGENT_PREFLIGHT`.

## PollCategory mapping
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

For sports mirror deploy/go flows, use `--category Sports` or `--category 1`.
