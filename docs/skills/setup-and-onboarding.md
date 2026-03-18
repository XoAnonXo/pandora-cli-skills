# Setup And Onboarding

Use this guide when Pandora is freshly installed or when you want the CLI to walk you through first-run configuration. The onboarding flow is goal-first: `pandora setup --plan --goal ...` is the machine-readable planning surface, `pandora doctor --goal ...` is the non-writing readiness check, and `pandora setup --interactive --goal ...` is the guided review-before-write path. `pandora setup` without `--interactive`, plus `init-env` and `doctor`, remains the manual path.

## Entry Points
- `npx pandora setup --interactive`
- `npx pandora setup --interactive --goal deploy`
- `npx pandora setup --interactive --goal paper-mirror`
- `npx pandora setup --interactive --goal live-mirror`
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
4. Hosting initialization.
   - Collect deployment-host details only when the user chose a daemon or gateway target.
   - Capture the provider name, API base URL, and optional control-plane token for DigitalOcean or another host.
   - Do not force a specific provider model; DigitalOcean is one supported path, not the only one.
5. Additional configuration.
   - Collect sportsbook or Odds API-style provider details only when the selected goal needs sports workflows.
   - Capture mirror resolution defaults only if the user wants env-driven source reuse.
6. Validation.
   - Run doctor after each meaningful step.
   - Show a redacted summary before writing anything to disk, then wait for explicit confirmation. That review gate is the contract boundary between planning and writes.
   - End with exact next commands for the selected goal.
7. MCP handoff.
   - Use `setup --plan --goal <goal>` to inspect the same journey as structured JSON without a TTY.
   - Pair that with `doctor --goal <goal>` while an MCP client or agent fills the selected fields.

## Canonical Env Names
- `PANDORA_PRIVATE_KEY` is the preferred Pandora signer env var.
- `PRIVATE_KEY` remains a legacy alias for compatibility.
- `POLYMARKET_PRIVATE_KEY` is the Polymarket signer env var for live hedge execution.
- `POLYMARKET_FUNDER` should point at the Polymarket proxy wallet, not the EOA.
- `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, and `POLYMARKET_API_PASSPHRASE` are required only for live CLOB execution.
- `PANDORA_DAEMON_PROVIDER`, `PANDORA_DAEMON_API_BASE_URL`, and `PANDORA_DAEMON_API_TOKEN` are optional deployment-host settings for daemon or gateway rollout.
- `SPORTSBOOK_PROVIDER_MODE`, `SPORTSBOOK_PRIMARY_BASE_URL`, and `SPORTSBOOK_BACKUP_BASE_URL` drive sports provider onboarding.
- `PANDORA_RESOLUTION_SOURCES` is the env fallback for mirror resolution defaults when the user does not pass `--sources`.

## Manual Escape Hatches
- Skip any step that is not relevant to the selected goal.
- Use `init-env` when you only want a starter file from the example template.
- Use `doctor` when you only want a readiness check.
- Stay in read-only mode if you do not want to provide signer material yet.
- Prefer manual control when you need a custom config path or already manage secrets elsewhere.
- For MCP-style planning, start with `setup --plan --goal <goal>`, validate with `doctor --goal <goal>`, then hand off to `setup --interactive --goal ...` only when a human is ready to approve the redacted review step.

## Example Runs
```bash
npx pandora setup --interactive
npx pandora setup --interactive --goal live-mirror
npx pandora setup --interactive --goal paper-mirror
npx pandora setup --plan --goal paper-mirror
npx pandora doctor --goal deploy
```

## Notes
- Guided onboarding should never copy discovery URLs into mirror resolution sources automatically.
- Mirror deploy and mirror go still require two independent public resolution URLs when live source inputs are needed.
- If the terminal does not provide a TTY, fall back to the manual `init-env` plus `doctor` path.
