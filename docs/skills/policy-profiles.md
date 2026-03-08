# Policy And Profiles

Use this file when exposing Pandora to agents with scoped permissions and named signer backends.

## Current status
- policy packs are shipped in alpha
- signer profiles are shipped in alpha
- there is not yet a universal `--profile` selector across all mutating commands
- direct Pandora signer-bearing commands now accept `--profile-id` / `--profile-file`:
  - `trade`
  - `sell`
  - `lp add`
  - `lp remove`
  - `resolve`
  - `claim`
  - `mirror deploy`
  - `mirror go`
  - `mirror sync once|run|start`
  - `sports create run`
- mirror, polymarket, sports live execution, and some automation families still commonly resolve signing material from env, `.env`, or explicit flags
- signer backend implementation status now uses a separate axis from runtime readiness:
  - implementation status: `implemented` or `placeholder`
  - runtime status: `ready`, `degraded`, `placeholder`, or `unknown`
- implemented signer backends today: `read-only`, `local-env`, `local-keystore`, `external-signer`
- in the default runtime view, `market_observer_ro` is the only built-in profile reporting `ready`, and it is read-only
- `pandora --output json capabilities --runtime-local-readiness` actively probes local signer/network prerequisites and can promote `prod_trader_a`, `dev_keystore_operator`, and `desk_signer_service` to `ready` when their runtime requirements are satisfied
- in the current runtime, no built-in mutable profile is ready
- the current built-in mutable profile states are:
  - `prod_trader_a`: implemented `local-env` backend, backend rollup `degraded`, per-profile `resolutionStatus` `missing-secrets`
  - `dev_keystore_operator`: implemented `local-keystore` backend, backend rollup `degraded`, per-profile `resolutionStatus` `missing-keystore`
  - `desk_signer_service`: implemented `external-signer` backend, backend rollup `degraded`, per-profile `resolutionStatus` `missing-context`
- `degraded` does not mean one generic failure mode; it means the backend is implemented but this runtime is still missing signer material, keystore access, external-signer context, network context, or compatibility prerequisites

## Policy pack commands

Recommendation note:
- use `pandora --output json bootstrap` first for machine-usable default recommendations:
  - `defaults.policyId` / `defaults.profileId`
  - `policyProfiles.policyPacks.recommendedReadOnlyPolicyId` / `recommendedMutablePolicyId`
  - `policyProfiles.signerProfiles.recommendedReadOnlyProfileId` / `recommendedMutableProfileId`
  - `nextSteps[]`
- use exact-context commands when the target workflow is already known:
  - `pandora --output json policy explain --id <policy-id> --command <tool> --mode <mode> --chain-id <id> --category <id|name> [--profile-id <id>]`
  - `pandora --output json policy recommend --command <tool> --mode <mode> --chain-id <id> --category <id|name> [--profile-id <id>]`
  - `pandora --output json profile recommend --command <tool> --mode <mode> --chain-id <id> --category <id|name> [--policy-id <id>]`

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

### Explain one profile in execution context
```bash
pandora --output json profile explain --id prod_trader_a --command trade --mode execute --chain-id 1 --category Crypto --policy-id execute-with-validation
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
- `statusAxes`
- `backendStatuses`
- `implementedBackends`
- `placeholderBackends`
- `readyBuiltinIds`
- `degradedBuiltinIds`
- `placeholderBuiltinIds`
- `pendingBuiltinIds`

Interpretation:
- `readyBuiltinIds`: built-in profiles that passed active readiness checks in the current runtime
- `degradedBuiltinIds`: built-in profiles whose backend is implemented, but the current runtime still lacks signer material, keystore access, external-signer context, network context, or compatibility
- Use `pandora --output json capabilities --runtime-local-readiness` to ask the CLI to probe local signer/network prerequisites directly; in that mode, the built-in mutable samples can transition to `ready` when those prerequisites are satisfied
- `placeholderBuiltinIds`: built-in profiles whose signer backend is still metadata-only
- `pendingBuiltinIds`: compatibility shorthand for every built-in profile that is not currently `ready`
- in the current runtime, `degradedBuiltinIds` contains every built-in mutable sample: `prod_trader_a`, `dev_keystore_operator`, and `desk_signer_service`

Primary sources:
```bash
pandora --output json bootstrap
pandora --output json capabilities
pandora --output json schema
pandora --output json policy list
pandora --output json profile list
```

## Recommended operating pattern
1. use read-only bootstrap first
   - prefer `pandora --output json bootstrap`
2. choose the smallest policy scope set that matches the target tools
3. prefer scoped MCP gateway tokens over raw secrets
4. treat `degraded` built-in profiles as runtime-configuration work still to be done, and only treat `placeholder` profiles as planning metadata if the runtime explicitly reports them
5. provision signer material only on the runtime that actually executes live tools

When you need the exact reason a profile is or is not usable:
- use `profile list` for the compact inventory: `runtimeReady` and `resolutionStatus`
- use `profile get --id <profile-id> [--command <tool>] [--mode <mode>] [--chain-id <id>] [--category <id|name>] [--policy-id <id>]` for raw `resolution`, constraints, and backend notes
- use `profile explain --id <profile-id> [--command <tool>] [--mode <mode>] [--chain-id <id>] [--category <id|name>] [--policy-id <id>]` for the concise go/no-go summary:
  - prefer canonical command names from `bootstrap`, `capabilities`, or `schema` when filling `--command`
  - `explanation.requestedContext.exact`
  - `explanation.requestedContext.missingFlags`
  - `explanation.usable`
  - `explanation.readiness.status`
  - `explanation.compatibility.ok`
  - `explanation.remediation[]`
  - `explanation.blockers`
- use `capabilities.data.policyProfiles.signerProfiles.backendStatuses` for the compact backend-level rollup

## Remote gateway example

```bash
pandora mcp http --auth-scopes capabilities:read,contracts:read,help:read,schema:read,operations:read
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
- it does not yet mean every command family accepts `--profile`
- it does not replace signer provisioning by itself
- it does not make raw `--private-key` the preferred path
- it does not mean every built-in profile is runtime-ready just because it appears in `profile list`
- it does not mean every non-ready built-in profile is in the same state; distinguish `degraded` from the rarer `placeholder` case

## Related docs
- first-time agent bootstrap:
  - [`agent-quickstart.md`](./agent-quickstart.md)
- MCP and remote gateway behavior:
  - [`agent-interfaces.md`](./agent-interfaces.md)
- mirror validation and execute gates:
  - [`mirror-operations.md`](./mirror-operations.md)
