# Setup And Onboarding

Use this guide when Pandora is freshly installed or when you want the CLI to walk you through first-run configuration. The onboarding flow is goal-first: `pandora setup --plan --goal ...` is the machine-readable planning surface, `pandora doctor --goal ...` is the non-writing readiness check, and `pandora setup --interactive --goal ...` is the guided review-before-write path. `pandora setup` without `--interactive`, plus `init-env` and `doctor`, remains the manual path.

`paper-mirror` and `live-mirror` are the deploy/go onboarding goals. `paper-hedge-daemon` and `live-hedge-daemon` are the packaged LP daemon goals for the new `mirror hedge` surface. Keep that split explicit: `mirror hedge` is the long-running bundle-oriented daemon path, while `mirror sync` remains the lower-level local/manual loop and troubleshooting surface.

## Entry Points
- `npx pandora setup --interactive`
- `npx pandora setup --interactive --goal deploy`
- `npx pandora setup --interactive --goal paper-mirror`
- `npx pandora setup --interactive --goal live-mirror`
- `npx pandora setup --interactive --goal paper-hedge-daemon`
- `npx pandora setup --interactive --goal live-hedge-daemon`
- `npx pandora setup --interactive --goal hosted-gateway`
- `npx pandora setup --plan --goal <goal>`
- `npx pandora setup`
- `npx pandora init-env`
- `npx pandora doctor --goal <goal>`

## Goal Matrix
| Goal | Use when | Primary setup focus |
| --- | --- | --- |
| `explore` | You only want read-only discovery | No secrets, bootstrap, docs, and validation only |
| `deploy` | You want to deploy a Pandora market | Pandora signer, chain/RPC, and deployment readiness |
| `paper-mirror` | You want mirror planning without live hedge execution | Pandora signer, Polymarket discovery, and source defaults |
| `live-mirror` | You want live hedge execution | Pandora signer, Polymarket signer/funder/API keys, and provider readiness |
| `paper-hedge-daemon` | You already have a mirror pair and want the packaged LP daemon in paper mode | Internal wallet whitelist, Polymarket connectivity, hedge policy defaults, and bundle-oriented host setup |
| `live-hedge-daemon` | You already have a mirror pair and want the packaged LP daemon live | Internal wallet whitelist, Pandora signer, Polymarket signer/funder/API keys, hedge policy defaults, and bundle-oriented host setup |
| `hosted-gateway` | You want a remote daemon or control-plane host | Host selection, deployment credentials, and runtime connectivity |

## Guided Flow
1. Select the goal first.
   - Ask for `explore`, `deploy`, `paper-mirror`, `live-mirror`, or `hosted-gateway` before collecting secrets.
   - Use the goal to hide irrelevant prompts and to decide whether the wizard should stay read-only or continue toward writes.
2. Private key management.
   - Generate or import the Pandora signing key.
   - Generate or import the Polymarket signing key when live hedging is selected.
   - Keep both steps optional so users can skip them and stay in read-only mode.
   - Major branch choices should use arrow-key menus in a real TTY, with numeric fallback only for limited terminals.
3. Polymarket initialization.
   - Initialize the Polymarket wallet only when the selected goal needs it.
   - Collect the Polymarket host, Polygon RPC URL, funder wallet, and API credentials for live hedging.
   - For `paper-hedge-daemon` and `live-hedge-daemon`, treat this as runtime hedge readiness for an existing LP mirror pair, not deploy-time mirror planning.
4. Hedge daemon policy.
   - For `paper-hedge-daemon` and `live-hedge-daemon`, collect `PANDORA_INTERNAL_WALLETS_FILE` before host setup.
   - Capture the minimum hedge notional plus partial/sell hedge policies so the bundle matches the operator's intended guardrails.
   - Keep Cloudflare Workers out of scope for this runtime: the bundle assumes a long-lived Node process on a droplet or VPS.
5. Hosting initialization.
   - Collect deployment-host details only when the user chose a daemon or gateway target.
   - Capture the provider name, API base URL, and optional control-plane token for DigitalOcean or another host.
   - Bundle artifacts support DigitalOcean droplets and generic VPS targets in v1.
   - Cloudflare Workers are not supported in v1 because the hedge daemon expects a long-running stateful runtime with local process/file lifecycle.
6. Additional configuration.
   - Collect sportsbook or Odds API-style provider details only when the selected goal needs sports workflows.
   - Capture mirror resolution defaults only for `paper-mirror` and `live-mirror`, where env-driven source reuse matters for deploy/go planning.
   - Do not ask `paper-hedge-daemon` or `live-hedge-daemon` for deploy-time source defaults by default; those goals assume an existing mirror pair.
7. Validation.
   - Run doctor after each meaningful step.
   - Show a redacted summary before writing anything to disk, then wait for explicit confirmation. That review gate is the contract boundary between planning and writes.
   - End with exact next commands for the selected goal.
8. MCP handoff.
   - Use `setup --plan --goal <goal>` to inspect the same journey as structured JSON without a TTY.
   - Pair that with `doctor --goal <goal>` while an MCP client or agent fills the selected fields.
   - For daemon targets, prefer `paper-hedge-daemon` or `live-hedge-daemon` in planning surfaces so agents do not confuse packaged `mirror hedge` runtime setup with `mirror sync` loop setup.

## Canonical Env Names
- `PANDORA_PRIVATE_KEY` is the preferred Pandora signer env var.
- `PRIVATE_KEY` remains a legacy alias for compatibility.
- `POLYMARKET_PRIVATE_KEY` is the Polymarket signer env var for live hedge execution.
- `POLYMARKET_FUNDER` should point at the Polymarket proxy wallet, not the EOA.
- `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, and `POLYMARKET_API_PASSPHRASE` are required only for live CLOB execution.
- `PANDORA_INTERNAL_WALLETS_FILE` is the canonical newline-delimited whitelist used by `mirror hedge` to ignore internal bot volume.
- `PANDORA_HEDGE_MIN_USDC`, `PANDORA_HEDGE_PARTIAL_POLICY`, and `PANDORA_HEDGE_SELL_POLICY` control the packaged LP hedge daemon guardrails.
- `PANDORA_DAEMON_PROVIDER`, `PANDORA_DAEMON_API_BASE_URL`, and `PANDORA_DAEMON_API_TOKEN` are optional deployment-host settings for daemon or gateway rollout.
- `PANDORA_DAEMON_*` is the bundle-adjacent host hint surface for `mirror hedge` daemon rollout to DigitalOcean droplets or a generic VPS.
- `SPORTSBOOK_PROVIDER_MODE`, `SPORTSBOOK_PRIMARY_BASE_URL`, and `SPORTSBOOK_BACKUP_BASE_URL` drive sports provider onboarding.
- `PANDORA_RESOLUTION_SOURCES` is the env fallback for mirror resolution defaults when the user does not pass `--sources`.

## Manual Escape Hatches
- Skip any step that is not relevant to the selected goal.
- Use `init-env` when you only want a starter file from the example template.
- Use `doctor` when you only want a readiness check.
- Stay in read-only mode if you do not want to provide signer material yet.
- Prefer manual control when you need a custom config path or already manage secrets elsewhere.
- For MCP-style planning, start with `setup --plan --goal <goal>`, validate with `doctor --goal <goal>`, then hand off to `setup --interactive --goal ...` only when a human is ready to approve the redacted review step.
- Prefer `paper-hedge-daemon` or `live-hedge-daemon` for packaged `mirror hedge` runtime planning, and keep `paper-mirror` or `live-mirror` for deploy/go planning.

## Example Runs
```bash
npx pandora setup --interactive
npx pandora setup --interactive --goal live-mirror
npx pandora setup --interactive --goal paper-mirror
npx pandora setup --interactive --goal live-hedge-daemon
npx pandora setup --plan --goal paper-hedge-daemon
npx pandora setup --plan --goal paper-mirror
npx pandora doctor --goal deploy
```

## Notes
- Guided onboarding should never copy discovery URLs into mirror resolution sources automatically.
- Mirror deploy and mirror go still require two independent public resolution URLs when live source inputs are needed.
- `mirror hedge` is the packaged LP daemon family. `mirror sync` remains the lower-level local/manual loop and troubleshooting surface.
- DigitalOcean droplets and generic VPS targets are supported for bundle-based daemon rollout today. Cloudflare Workers are not supported in v1.
- If the terminal does not provide a TTY, fall back to the manual `init-env` plus `doctor` path.
