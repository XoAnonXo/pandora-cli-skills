# Mirror Operations Guide

Use this guide for `mirror browse|plan|deploy|verify|go|sync|status|close`.

## Non-negotiable operator rules
- `mirror plan|deploy|go` do **not** use a generic `+1h` assumption.
- `mirror plan` computes a sports-aware suggested `targetTimestamp`.
- Keep that suggested timestamp unless you have a better close-time estimate.
- Use `--target-timestamp <unix|iso>` only when you intentionally need to override the plan’s suggested close time.
- `mirror deploy|go` require at least **two independent public resolution URLs from different hosts** in `--sources`.
- Polymarket, Gamma, and CLOB URLs are discovery inputs only and are **not** valid `--sources`.
- Fresh execute mode is validation-gated. The exact final `question`, `rules`, `sources`, and `targetTimestamp` must be validated before live deployment.

## Validation contract

### CLI rerun flow
1. Run `mirror deploy --dry-run` or `mirror go --paper|--dry-run`.
2. Take the exact final payload and validate it:
   ```bash
   pandora --output json agent market validate \
     --question "<final question>" \
     --rules "<final rules>" \
     --target-timestamp <unix-seconds> \
     --sources <url1> <url2>
   ```
3. Rerun execute with `--validation-ticket <ticket>`.

### MCP rerun flow
- Use:
  - `agentPreflight = { validationTicket, validationDecision: "PASS", validationSummary }`

### Sports create flow
- `sports create run` does not expose a CLI `--validation-ticket` flag.
- Agent-controlled execute uses `agentPreflight` / `PANDORA_AGENT_PREFLIGHT`.

## PollCategory guidance

| Name | Id |
| --- | --- |
| Politics | `0` |
| Sports | `1` |
| Finance | `2` |
| Crypto | `3` |
| Culture | `4` |
| Technology | `5` |
| Science | `6` |
| Entertainment | `7` |
| Health | `8` |
| Environment | `9` |
| Other | `10` |

Use `--category Sports` or `--category 1` for sports mirror deploy/go flows.

## Recommended mirror workflow

### 1. Browse source candidates
```bash
pandora mirror browse \
  --polymarket-tag-id 82 \
  --min-yes-pct 20 --max-yes-pct 80 \
  --min-volume-24h 100000 \
  --limit 10
```

### 2. Build a plan
```bash
pandora mirror plan \
  --source polymarket \
  --polymarket-slug <slug> \
  --with-rules \
  --include-similarity
```

### 3. Prepare final operator inputs
- choose at least two independent public resolution URLs from different hosts
- keep the plan’s suggested `targetTimestamp`, or set `--target-timestamp <unix|iso>` explicitly when you have a justified override
- pick the correct PollCategory (`Sports` / `1` for sports)
- for any eventual live signing step, prefer env / `.env` values or another runtime bootstrap you control over raw `--private-key`
- if you are exposing mirror flows through `pandora mcp http`, inspect the tool `policyScopes` first and grant only the exact scopes needed for the run
- inspect `policy list|get` and `profile list|get` before live automation; current builds ship those catalogs in alpha, but mutating commands still commonly resolve secrets from env/direct flags during rollout

### 4. Dry-run deploy or go
```bash
pandora mirror deploy \
  --polymarket-slug <slug> \
  --liquidity-usdc 10 \
  --category Sports \
  --sources <url1> <url2> \
  --dry-run
```

Or:

```bash
pandora mirror go \
  --polymarket-slug <slug> \
  --liquidity-usdc 10 \
  --category Sports \
  --paper
```

### 5. Validate the exact final payload
- run `agent market validate` on the exact final values
- rerun CLI execute with `--validation-ticket <ticket>`

### 6. Verify
```bash
pandora mirror verify \
  --market-address <pandora-market> \
  --polymarket-slug <slug> \
  --include-similarity \
  --with-rules
```

### 7. Sync and inspect
```bash
pandora mirror sync run --market-address <pandora-market> --polymarket-slug <slug> --paper
pandora mirror status --strategy-hash <hash> --with-live
```

### 8. Close out deterministically
```bash
pandora mirror close --pandora-market-address <0x...> --polymarket-market-id <id> --dry-run
```

## Sync and daemon notes
- `mirror sync run|once|start` use the same mirror payload assumptions built during deploy/go.
- `mirror sync stop|status` can target `--strategy-hash <hash>` or an explicit `--pid-file <path>`.
- `mirror close` is the deterministic closeout path for stop -> withdraw LP -> claim style cleanup.

## Compatibility aliases
- mode aliases:
  - `--paper` = `--dry-run`
  - `--execute-live` = `--execute`
- market address aliases:
  - `--pandora-market-address` or `--market-address`
- env aliases:
  - `--env-file` = `--dotenv-path`
  - `--no-env-file` = `--skip-dotenv`

## What not to do
- Do not treat Polymarket URLs as resolution sources.
- Do not reuse a validation ticket after changing `question`, `rules`, `sources`, or `targetTimestamp`.
- Do not import the legacy `--target-timestamp-offset-hours` assumption from `launch` / `clone-bet` into mirror flows.
- Do not normalize recurring mirror automation around raw command-line private keys when scoped gateway tokens and env-based secret injection are available.
