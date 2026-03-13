# Recipes

Use `recipe` when an agent wants a reusable Pandora workflow instead of stitching commands together ad hoc.

## Canonical commands

- `pandora --output json recipe list`
- `pandora --output json recipe list --approval-status approved`
- `pandora --output json recipe list --source user`
- `pandora --output json recipe list --risk-level paper`
- `pandora --output json recipe get --id <recipe-id>`
- `pandora --output json recipe validate --id <recipe-id> [--set key=value] [--policy-id <id>] [--profile-id <id>]`
- `pandora --output json recipe run --id <recipe-id> [--set key=value] [--policy-id <id>] [--profile-id <id>]`

## Trust model

Recipes are now an agent-facing workflow catalog, not just a thin alias layer.

Each recipe exposes separate trust axes:

- `source`: `first-party` or `user`
- `approvalStatus`: `approved`, `unreviewed`, `experimental`, or `deprecated`
- `riskLevel`: `read-only`, `paper`, `dry-run`, or `live`

Keep these distinct from execution metadata:

- `safeByDefault`
- `mutating`
- `supportsRemote`
- `defaultPolicy`
- `defaultProfile`

Agent guidance:

- show `approved` recipes first in discovery
- show `user` recipes as discoverable, but not equally trusted
- call out `unreviewed` and `experimental` recipes during validation
- prefer `approved` recipes for execution
- do not treat non-approved `live` recipes as default run candidates

## Built-in approved recipes

- `mirror.sync.paper-safe`
  - Starts mirror sync in paper mode for one market address.
- `claim.all.finalized`
  - Produces a safe dry-run claim sweep across all finalized markets.
- `mirror.close.all`
  - Produces a dry-run mirror closeout plan across all tracked mirrors.
- `sports.sync.paper-safe`
  - Starts sports sync in paper mode for one event id.
- `resolve.poll.dryrun`, `resolve.poll.execute`
  - Preview or execute one poll resolution.
- `portfolio.snapshot`, `debug.market.inspect`
  - Approved read-only inspection recipes that are safe for remote/hosted agents.
- `mirror.plan.poly`, `poly.positions.check`, `arb.scan.poly`
  - Planning and scouting recipes for mirror, Polymarket inventory, and bounded arb discovery.
- `pari.deploy.preview`
  - Canonical dry-run preview for pari-mutuel market creation.

## Input model

CLI uses repeated `--set key=value` flags.

MCP and generated SDKs use:

```json
{
  "id": "mirror.sync.paper-safe",
  "inputs": {
    "market-address": "0xabc..."
  }
}
```

## Validation model

`recipe validate` does four things:

1. loads the built-in recipe or validates a recipe file
2. resolves required inputs
3. evaluates optional policy compatibility
4. evaluates optional signer-profile compatibility

Validation also surfaces trust warnings for user or non-approved recipes so an agent can distinguish "discoverable" from "recommended to run".

It does not execute the delegated command.

## Execution model

`recipe run` compiles the recipe into an ordinary Pandora command and executes that command in JSON mode.

The response includes:

- the selected recipe summary
- the compiled command argv
- validation output
- delegated command result
- `operationId` when the delegated command is operation-backed

Recipes do not create a second execution engine. They compile to normal Pandora commands and inherit the existing operation, policy, profile, and safety behavior of those commands.

External recipe files are validation-first:

- `recipe validate --file ...` can lint and inspect any well-formed recipe manifest
- `recipe run --file ...` only executes when the delegated command is a known read-only Pandora command
- external recipe files cannot be used as an end-run around policy/profile controls for live or mutating execution
- external and store-loaded user recipes normalize to `source=user` and `approvalStatus=unreviewed` unless a future review flow promotes them

Unreviewed live recipes are not default execution candidates. Validate them first and require explicit user intent before any live run.

## Example

```bash
pandora --output json recipe run \
  --id mirror.sync.paper-safe \
  --set market-address=0xabc...
```

## Policy/profile guidance

- Use `--policy-id` to override the recipe default policy.
- Use `--profile-id` to force profile compatibility checks before run.
- Remote recipe execution is intentionally narrower than local recipe execution.
- If a recipe delegates to a long-running or remote-blocked tool, `recipe run` now denies that execution over remote MCP/HTTP even when the recipe itself is marked safe-by-default.
- Recipes are currently conservative and safe-by-default; built-in recipes do not force live execution.
- `recipe list` is the main catalog surface for "what safe things can we do?" and "show me approved workflows."
