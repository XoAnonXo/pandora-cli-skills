# Pandora CLI & Skills

Production CLI for Pandora prediction markets with mirror tooling, sports consensus, on-chain trading, analytics, and agent-native interfaces.

## Install

```bash
npm i -g pandora-cli-skills
pandora --help
```

Or without installing:

```bash
npx pandora-cli-skills@latest --help
```

Node.js `>=18` required.

## Documentation map
- [`SKILL.md`](./SKILL.md)
  - root overview and routing index
- [`docs/skills/capabilities.md`](./docs/skills/capabilities.md)
  - capability map, canonical paths, and PollCategory mapping
- [`docs/skills/command-reference.md`](./docs/skills/command-reference.md)
  - human-oriented command and flag reference; use capabilities/schema for machine authority
- [`docs/skills/mirror-operations.md`](./docs/skills/mirror-operations.md)
  - mirror deploy/go safety, timing, validation, sync, and closeout guidance
- [`docs/skills/agent-interfaces.md`](./docs/skills/agent-interfaces.md)
  - schema, MCP, JSON envelopes, recovery hints, fork runtime, and error codes
- [`docs/skills/legacy-launchers.md`](./docs/skills/legacy-launchers.md)
  - `launch` / `clone-bet` legacy script wrappers

## Quickstart

```bash
# compact capability digest for agents
pandora --output json capabilities

# schema for typed consumers
pandora --output json schema

# MCP server mode
pandora mcp

# read-only discovery
pandora --output json scan --limit 10

# buy-side dry-run
pandora --output json trade --dry-run \
  --market-address 0x... --side yes --amount-usdc 10

# sell-side dry-run
pandora --output json sell --dry-run \
  --market-address 0x... --side no --shares 25

# inspect persisted mutable-operation records
pandora --output json operations list --status planned,queued,running --limit 20
```

## Mirror safety summary
- `mirror plan|deploy|go` use a sports-aware suggested `targetTimestamp`; they do not assume a generic `+1h` buffer.
- Use `--target-timestamp <unix|iso>` only when you intentionally need to override the suggested close time.
- Fresh `mirror deploy` / `mirror go` runs require at least two independent public resolution URLs from different hosts in `--sources`.
- Polymarket, Gamma, and CLOB URLs are discovery inputs only and are not valid `--sources`.
- Validation is exact-payload: validate the final `question`, `rules`, `sources`, and `targetTimestamp` before execute mode.
- CLI mirror execute reruns use `--validation-ticket`; MCP execute/live reruns use `agentPreflight`.

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
