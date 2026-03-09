# Recipes

Use `recipe` when an agent wants a reusable Pandora workflow instead of stitching commands together ad hoc.

## Canonical commands

- `pandora --output json recipe list`
- `pandora --output json recipe get --id <recipe-id>`
- `pandora --output json recipe validate --id <recipe-id> [--set key=value] [--policy-id <id>] [--profile-id <id>]`
- `pandora --output json recipe run --id <recipe-id> [--set key=value] [--policy-id <id>] [--profile-id <id>]`

## Built-in first-party recipes

- `mirror.sync.paper-safe`
  - Starts mirror sync in paper mode for one market address.
- `claim.all.finalized`
  - Produces a safe dry-run claim sweep across all finalized markets.
- `mirror.close.all`
  - Produces a dry-run mirror closeout plan across all tracked mirrors.
- `sports.sync.paper-safe`
  - Starts sports sync in paper mode for one event id.

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
