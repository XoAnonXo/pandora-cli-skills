# Policy And Profiles

Use this file when exposing Pandora to agents with scoped permissions and named signer backends.

## Current status
- policy packs are shipped in alpha
- signer profiles are shipped in alpha
- there is not yet a universal `--profile` selector across all mutating commands
- current live execution still commonly resolves signing material from env, `.env`, or explicit flags
- implemented signer backends today: `read-only`, `local-env`
- planning/placeholder sample backends: `external-signer`, `local-keystore`
- current built-in ready profile: `market_observer_ro`
- current built-in pending profiles: `prod_trader_a`, `dev_keystore_operator`, `desk_signer_service`

## Policy pack commands

### List available packs
```bash
pandora --output json policy list
```

### Inspect one pack
```bash
pandora --output json policy get --id research-only
```

### Lint a candidate custom pack
```bash
pandora --output json policy lint --file /path/to/policy.json
```

## Signer profile commands

### List profiles
```bash
pandora --output json profile list
```

### Inspect one profile
```bash
pandora --output json profile get --id market_observer_ro
```

### Validate a candidate custom profile
```bash
pandora --output json profile validate --file /path/to/profile.json
```

## What agents should inspect

Before using live tools, inspect:
- `policyScopes`
- `requiresSecrets`
- profile readiness and backend notes
- `implementedBackends`
- `placeholderBackends`
- `readyBuiltinIds`
- `pendingBuiltinIds`

Primary sources:
```bash
pandora --output json capabilities
pandora --output json schema
pandora --output json policy list
pandora --output json profile list
```

## Recommended operating pattern
1. use read-only bootstrap first
2. choose the smallest policy scope set that matches the target tools
3. prefer scoped MCP gateway tokens over raw secrets
4. treat pending built-in profiles as planning metadata, not execution credentials
5. provision signer material only on the runtime that actually executes live tools

## Remote gateway example

```bash
pandora mcp http --auth-scopes capabilities:read,contracts:read,help:read,schema:read,policy:read,profile:read,operations:read
```

This example is the conservative remote bootstrap for:
- `capabilities`
- `schema`
- `policy.*`
- `profile.*`
- `operations.get`
- `operations.list`

If you need live tools:
- add only the exact tool scopes required
- add `operations:write` only when the runtime needs `operations.cancel` or `operations.close`
- over MCP, `operations.cancel` and `operations.close` also require `intent.execute=true` because they are mutating calls
- add `secrets:use` only when the runtime actually has signer material

## Built-in bootstrap pattern
- read-only research path:
  - policy pack: `research-only`
  - signer profile pattern: `market_observer_ro`

Use this for:
- discovery
- schema inspection
- policy/profile inspection
- then, for any additional read-only tools, inspect `capabilities` / `schema` and grant only the extra scopes the selected tools actually declare

## What policy/profile does not mean yet
- it does not yet mean every command accepts `--profile`
- it does not replace signer provisioning by itself
- it does not make raw `--private-key` the preferred path
- it does not mean every built-in profile is runtime-ready just because it appears in `profile list`

## Related docs
- first-time agent bootstrap:
  - [`agent-quickstart.md`](./agent-quickstart.md)
- MCP and remote gateway behavior:
  - [`agent-interfaces.md`](./agent-interfaces.md)
- mirror validation and execute gates:
  - [`mirror-operations.md`](./mirror-operations.md)
