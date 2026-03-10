# Pandora CLI Command Reference

This is the human-oriented scoped command and flag reference. For machine-authoritative command contracts, prefer:

- `pandora --output json bootstrap`
- `pandora --output json capabilities`
- `pandora --output json schema`
- `pandora <family> ... --help` for the freshest family-specific usage surface

Use the smaller workflow docs before falling back to this file:
- [`agent-quickstart.md`](./agent-quickstart.md)
- [`trading-workflows.md`](./trading-workflows.md)
- [`portfolio-closeout.md`](./portfolio-closeout.md)
- [`policy-profiles.md`](./policy-profiles.md)
- [`mirror-operations.md`](./mirror-operations.md)

## Global conventions
- Global output mode: `--output table|json` (default `table`)
- Most commands support `--output table|json`
- JSON-only commands:
  - `pandora --output json bootstrap`
  - `pandora --output json capabilities`
  - `pandora --output json schema`
- Dedicated stdio server mode:
  - `pandora mcp`
- Legacy passthrough wrappers:
  - `launch`
  - `clone-bet`
- Agent schema command: `pandora --output json schema`
- Agent capability digest: `pandora --output json capabilities`
- MCP server mode: `pandora mcp`
- Fork runtime flags for transaction families:
  - `--fork`
  - `--fork-rpc-url <url>`
  - `--fork-chain-id <id>`
- JSON errors can include additive recovery hints:
  - `error.recovery = { action, command, retryable }`

## Credential and policy guidance
- For non-signing bootstrap, start with `pandora --output json bootstrap`, then `schema`, `policy list`, `profile list`, or `pandora mcp`. None of those require signer material.
- The command signatures below show the live parser surface, so signer-bearing flows still list `--private-key <hex>` where supported.
- That does **not** mean raw command-line keys are the preferred operating model.
- Prefer, in order:
  - read-only discovery via `capabilities`, `schema`, `policy`, and `profile`
  - policy-scoped MCP gateway access for agents
  - named signer profiles via `--profile-id` or `--profile-file` on direct Pandora execution commands that support them
  - env / `.env` injection, ideally supplied by a secret manager or other runtime bootstrap you control
  - raw `--private-key` only for manual fallback or debugging
- Policy packs and named signer profiles are shipped in alpha via `policy list|get|lint` and `profile list|get|explain|recommend|validate`.
- Recommendation and explain routing today is canonical-tool-first:
  - use `bootstrap` first for the cold-start summary and safest defaults
  - keep planning on canonical tool names by default
  - use `policy explain`, `policy recommend`, and `profile recommend` when you need exact context-aware remediation or ranking for a specific command/mode/chain/category path
  - use compatibility aliases only for legacy/debug workflows or migration diffing
  - use `policy get` for pack inspection, `profile get` for raw profile state, and `profile explain` for exact go/no-go decisions
- Direct Pandora signer-bearing commands such as `trade`, `sell`, `lp add`, `lp remove`, `resolve`, `claim`, `mirror deploy`, `mirror go`, `mirror sync once|run|start`, and `sports create run` now accept `--profile-id` / `--profile-file`.
- Mirror deploy/go/sync flows and sports live execution paths now also accept profile selectors in current builds.
- Polymarket and some automation families still commonly resolve signer material from env / `.env` / explicit flags. Use `pandora --output json capabilities` / `schema` to inspect current `policyScopes`, `requiresSecrets`, and per-command profile support.

## High-value command routing reference

This section is intentionally condensed for retrieval. For the exhaustive live contract:

- use `pandora --output json bootstrap` for the canonical first call
- use `pandora --output json capabilities` for compact discovery
- use `pandora --output json schema` for exact machine-readable inputs/outputs
- use `pandora <family> ... --help` for the freshest family-specific usage surface
- remember that listed `--private-key` flags describe compatibility surface, not preferred secret-handling guidance
- compatibility aliases are listed below so humans can recognize them; they are not the preferred routing surface for new agents

```text
pandora [--output table|json] --version
pandora [--output table|json] help
pandora [--output json] bootstrap [--include-compatibility]  # use --include-compatibility only for legacy/debug alias inspection
pandora [--output table|json] init-env [--force] [--dotenv-path <path>] [--example <path>]
pandora [--output table|json] doctor [--dotenv-path <path>] [--skip-dotenv] [--check-usdc-code] [--check-polymarket] [--rpc-timeout-ms <ms>]
pandora [--output table|json] setup [--force] [--dotenv-path <path>] [--example <path>] [--check-usdc-code] [--check-polymarket] [--rpc-timeout-ms <ms>]
pandora [--output json] capabilities
pandora [--output table|json] markets list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>|--type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--min-tvl <usdc>] [--hedgeable] [--expand] [--with-odds]
pandora [--output table|json] markets get [--id <id> ...] [--stdin]
pandora [--output table|json] markets mine [--wallet <address>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--indexer-url <url>] [--timeout-ms <ms>]
pandora [--output table|json] sports schedule|scores|books list|events list|events live|odds snapshot|odds bulk|consensus|create plan|create run|sync once|sync run|sync start|sync stop|sync status|resolve plan [flags]
pandora [--output table|json] lifecycle start --config <path>|status --id <id>|resolve --id <id> --confirm
pandora [--output table|json] odds record --competition <id> --interval <sec> [--max-samples <n>] [--event-id <id>] [--venues pandora_amm,polymarket] [--indexer-url <url>] [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>]
pandora [--output table|json] odds history --event-id <id> --output csv|json [--limit <n>]
pandora [--output table|json] polls list [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--status <int>] [--category <int>] [--question-contains <text>] [--where-json <json>]
pandora [--output table|json] polls get --id <id>
pandora [--output table|json] events list [--type all|liquidity|oracle-fee|claim] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-direction asc|desc] [--chain-id <id>] [--wallet <address>] [--market-address <address>] [--poll-address <address>] [--tx-hash <hash>]
pandora [--output table|json] events get --id <id> [--type all|liquidity|oracle-fee|claim]
pandora [--output table|json] positions list [--wallet <address>] [--market-address <address>] [--chain-id <id>] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--where-json <json>]
pandora [--output table|json] portfolio --wallet <address> [--chain-id <id>|--all-chains] [--limit <n>] [--include-events|--no-events] [--with-lp] [--rpc-url <url>]
pandora [--output table|json] watch [--wallet <address>] [--market-address <address>] [--side yes|no] [--amount-usdc <amount>] [--once|--iterations <n>] [--interval-ms <ms>] [--chain-id <id>] [--include-events|--no-events] [--yes-pct <0-100>] [--alert-yes-below <0-100>] [--alert-yes-above <0-100>] [--alert-net-liquidity-below <amount>] [--alert-net-liquidity-above <amount>] [--fail-on-alert] [--track-brier] [--brier-source <name>] [--brier-file <path>] [--group-by source|market|competition]
pandora [--output table|json] scan [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by <field>] [--order-direction asc|desc] [--chain-id <id>] [--creator <address>] [--poll-address <address>] [--market-type <type>|--type <type>] [--where-json <json>] [--active|--resolved|--expiring-soon] [--expiring-hours <n>] [--min-tvl <usdc>] [--hedgeable] [--expand] [--with-odds]
pandora [--output table|json] markets scan [scan flags]  # backward-compatible alias of scan; legacy/debug only
pandora [--output table|json] quote [--indexer-url <url>] [--timeout-ms <ms>] --market-address <address> --side yes|no [--mode buy|sell] --amount-usdc <amount>|--shares <amount>|--amounts <csv>|--target-pct <0-100> [--yes-pct <0-100>] [--slippage-bps <0-10000>]  # --target-pct is buy-only, AMM-only, and mutually exclusive with explicit buy amounts
pandora [--output table|json] trade [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --amount-usdc <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-shares-out-raw <uint>] [--max-amount-usdc <amount>] [--min-probability-pct <0-100>] [--max-probability-pct <0-100>] [--allow-unquoted-execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--usdc <address>]  # buy-side auto-detects AMM vs pari-mutuel
pandora [--output table|json] sell [--indexer-url <url>] [--timeout-ms <ms>] [--dotenv-path <path>] [--skip-dotenv] --market-address <address> --side yes|no --shares <amount>|--amount <amount> --dry-run|--execute [--yes-pct <0-100>] [--slippage-bps <0-10000>] [--min-amount-out-raw <uint>] [--allow-unquoted-execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--usdc <address>]  # sell is AMM-only; pari-mutuel markets do not expose sell()
pandora [--output table|json] claim [--dotenv-path <path>] [--skip-dotenv] --market-address <address>|--all [--wallet <address>] --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--indexer-url <url>] [--timeout-ms <ms>]
pandora [--output table|json] history --wallet <address> [--chain-id <id>] [--market-address <address>] [--side yes|no|both] [--status all|open|won|lost|closed] [--limit <n>] [--after <cursor>] [--before <cursor>] [--order-by timestamp|pnl|entry-price|mark-price] [--order-direction asc|desc] [--include-seed]
pandora [--output table|json] export --wallet <address> --format csv|json [--chain-id <id>] [--year <yyyy>] [--from <unix>] [--to <unix>] [--out <path>]
pandora arb scan [--source pandora|polymarket] [--markets <csv>] --output ndjson|json [--min-net-spread-pct <n>|--min-spread-pct <n>] [--min-tvl <usdc>] [--fee-pct-per-leg <n>] [--slippage-pct-per-leg <n>] [--amount-usdc <n>] [--combinatorial] [--max-bundle-size <n>] [--similarity-threshold <0-1>] [--min-token-score <0-1>] [--max-close-diff-hours <n>] [--question-contains <text>] [--iterations <n>] [--interval-ms <ms>] [--indexer-url <url>] [--timeout-ms <ms>]
pandora [--output table|json] arbitrage [--chain-id <id>] [--venues pandora,polymarket] [--limit <n>] [--min-spread-pct <n>] [--min-liquidity-usdc <n>] [--max-close-diff-hours <n>] [--similarity-threshold <0-1>] [--min-token-score <0-1>] [--cross-venue-only|--allow-same-venue] [--with-rules] [--include-similarity] [--question-contains <text>] [--polymarket-host <url>] [--polymarket-mock-url <url>]  # compatibility wrapper; legacy/debug only
pandora [--output table|json] autopilot run|once --market-address <address> --side yes|no --amount-usdc <amount> [--trigger-yes-below <0-100>] [--trigger-yes-above <0-100>] [--paper|--execute-live] [--interval-ms <ms>] [--cooldown-ms <ms>] [--max-amount-usdc <amount>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--state-file <path>] [--kill-switch-file <path>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]
pandora [--output table|json] dashboard [--with-live|--no-live] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
pandora [--output table|json] fund-check --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--target-pct <0-100>] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
pandora [--output table|json] mirror browse|plan|deploy|verify|lp-explain|hedge-calc|calc|simulate|go|sync|dashboard|status|health|panic|drift|hedge-check|pnl|audit|replay|trace|logs|close ...
pandora [--output table|json] policy list|get|lint [flags]
pandora [--output table|json] profile list|get|explain|recommend|validate [flags]
pandora [--output table|json] explain <error-code>|--code <code> [--message <text>] [--details-json <json>] [--stdin]
pandora [--output table|json] simulate mc|particle-filter|agents ...
pandora [--output table|json] model calibrate|correlation|diagnose|score brier ...
pandora [--output table|json] polymarket check|approve|preflight|balance|deposit|withdraw|trade ...  # use fund-check for the high-level planner; use polymarket check + balance for lower-level details
pandora [--output table|json] webhook test [--webhook-url <url>] [--webhook-template <json>] [--webhook-secret <secret>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>] [--webhook-timeout-ms <ms>] [--webhook-retries <n>]
pandora [--output table|json] leaderboard [--metric profit|volume|win-rate] [--chain-id <id>] [--limit <n>] [--min-trades <n>]
pandora [--output table|json] analyze --market-address <address> [--provider <name>] [--model <id>] [--max-cost-usd <n>] [--temperature <n>] [--timeout-ms <ms>]
pandora [--output table|json] suggest --wallet <address> --risk low|medium|high --budget <amount> [--count <n>] [--include-venues pandora,polymarket]
pandora [--output table|json] resolve [--dotenv-path <path>] [--skip-dotenv] --poll-address <address> --answer yes|no|invalid --reason <text> --dry-run|--execute [--watch] [--watch-interval-ms <ms>] [--watch-timeout-ms <ms>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>]
pandora [--output table|json] lp add|remove|positions [--market-address <address>] [--wallet <address>] [--amount-usdc <n>] [--lp-tokens <n>|--all|--all-markets] [--dry-run|--execute] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--usdc <address>] [--deadline-seconds <n>] [--indexer-url <url>] [--timeout-ms <ms>]
pandora [--output table|json] lp simulate-remove --market-address <address> [--wallet <address>] [--lp-tokens <n>|--all] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>]
pandora [--output table|json] risk show|panic [--risk-file <path>] [--clear] [--reason <text>] [--actor <id>]
pandora [--output table|json] operations get|list|receipt|verify-receipt|cancel|close [flags]  # terminal mutable operations also emit durable receipt artifacts beside the operation store
pandora stream prices|events [--indexer-url <url>] [--indexer-ws-url <url>] [--timeout-ms <ms>] [--interval-ms <ms>] [--market-address <address>] [--chain-id <id>] [--limit <n>]
pandora [--output json] schema
pandora mcp
pandora launch [--dotenv-path <path>] [--skip-dotenv] [script args...]
pandora clone-bet [--dotenv-path <path>] [--skip-dotenv] [script args...]
```

## Policy and profile decision surfaces

- `pandora --output json bootstrap`
  - canonical first call
  - machine-usable recommendation fields live here today:
    - `defaults.policyId` / `defaults.profileId`
    - `policyProfiles.policyPacks.recommendedReadOnlyPolicyId` / `recommendedMutablePolicyId`
    - `policyProfiles.signerProfiles.recommendedReadOnlyProfileId` / `recommendedMutableProfileId`
    - `nextSteps[]`
- `pandora --output json policy get --id <policy-id>`
  - inspect one shipped or local policy pack
- `pandora --output json policy explain --id <policy-id> --command <tool> [--mode <mode>] [--chain-id <id>] [--category <id|name>] [--profile-id <id>]`
  - exact policy decision surface for one already-selected canonical tool/context
- `pandora --output json policy recommend --command <tool> [--mode <mode>] [--chain-id <id>] [--category <id|name>] [--profile-id <id>]`
  - context-aware policy ranking after you already know the canonical tool and execution path
- `pandora --output json profile get --id <profile-id> [--command <tool>] [--mode <mode>] [--chain-id <id>] [--category <id|name>] [--policy-id <id>]`
  - raw profile state plus optional compatibility annotation
- `pandora --output json profile explain --id <profile-id> [--command <tool>] [--mode <mode>] [--chain-id <id>] [--category <id|name>] [--policy-id <id>]`
  - exact profile decision surface
  - prefer canonical command names from `bootstrap`, `capabilities`, or `schema` when filling `--command`
  - consume `explanation.requestedContext.exact` and `explanation.requestedContext.missingFlags` before trusting the answer
  - consume `explanation.remediation[]` as the machine-usable action list
  - treat `explanation.blockers` as the human-readable summary, not the primary automation field
- `pandora --output json profile recommend [--command <tool>] [--mode <mode>] [--chain-id <id>] [--category <id|name>] [--policy-id <id>] [--store-file <path>] [--no-builtins|--builtin-only]`
  - context-aware profile ranking after you already know the canonical tool and execution path

## Operation receipts

- terminal mutable operations automatically write a receipt JSON artifact beside the durable operation state store
- default paths:
  - local CLI:
    - `~/.pandora/operations/<operation-id>.receipt.json`
  - MCP/workspace-guarded runtime:
    - `./.pandora/operations/<operation-id>.receipt.json`
- receipt purpose:
  - post-execution audit
  - tamper-evident hash verification
  - checkpoint binding for terminal operation state
- local verification:
  - `pandora --output json operations verify-receipt --id <operation-id>`
  - `pandora --output json operations verify-receipt --file <path-to-receipt.json>`
- remote gateway verification:
  - `GET /operations/<operation-id>/receipt`
  - `GET /operations/<operation-id>/receipt/verify`
  - both require `operations:read`

## Mirror subcommands

```text
browse --min-yes-pct <n> --max-yes-pct <n> --min-volume-24h <n> [--closes-after <date>|--end-date-after <date|72h>] [--closes-before <date>|--end-date-before <date|72h>] [--question-contains <text>|--keyword <text>] [--slug <text>] [--category sports|crypto|politics|entertainment] [--exclude-sports] [--sort-by volume24h|liquidity|endDate] [--limit <n>] [--chain-id <id>] [--polymarket-tag-id <id>] [--polymarket-tag-ids <csv>] [--sport-tag-id <id>] [--sport-tag-ids <csv>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
plan   --source polymarket --polymarket-market-id <id>|--polymarket-slug <slug> [--chain-id <id>] [--target-slippage-bps <n>] [--turnover-target <n>] [--depth-slippage-bps <n>] [--safety-multiplier <n>] [--min-liquidity-usdc <n>] [--max-liquidity-usdc <n>] [--with-rules] [--include-similarity] [--min-close-lead-seconds <n>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
deploy --plan-file <path>|--polymarket-market-id <id>|--polymarket-slug <slug> --dry-run|--execute [--liquidity-usdc <n>] [--fee-tier <500-50000>] [--max-imbalance <n>] [--arbiter <address>] [--category <id|name>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--oracle <address>] [--factory <address>] [--usdc <address>] [--distribution-yes <parts>] [--distribution-no <parts>] [--sources <url...>] [--validation-ticket <ticket>] [--target-timestamp <unix|iso>] [--manifest-file <path>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--min-close-lead-seconds <n>]
verify --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--trust-deploy] [--manifest-file <path>] [--include-similarity] [--with-rules] [--allow-rule-mismatch] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
lp-explain --liquidity-usdc <n> [--source-yes-pct <0-100>] [--distribution-yes <parts>] [--distribution-no <parts>]
hedge-calc [--reserve-yes-usdc <n> --reserve-no-usdc <n>] [--excess-yes-usdc <n>] [--excess-no-usdc <n>] [--polymarket-yes-pct <0-100>] [--hedge-ratio <n>] [--hedge-cost-bps <n>] [--volume-scenarios <csv>] [--pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug>] [--trust-deploy] [--manifest-file <path>]
calc   --target-pct <0-100> --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--trust-deploy] [--manifest-file <path>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
simulate --liquidity-usdc <n> [--source-yes-pct <0-100>] [--target-yes-pct <0-100>] [--distribution-yes <parts>] [--distribution-no <parts>] [--fee-tier <500-50000>] [--volume-scenarios <csv>] [--hedge-ratio <n>] [--hedge-cost-bps <n>] [--polymarket-yes-pct <0-100>]
go     --polymarket-market-id <id>|--polymarket-slug <slug> [--liquidity-usdc <n>] [--fee-tier <500-50000>] [--max-imbalance <n>] [--arbiter <address>] [--category <id|name>] [--paper|--dry-run|--execute-live|--execute] [--auto-sync] [--sync-once] [--sync-interval-ms <ms>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--hedge-ratio <n>] [--no-hedge] [--rebalance-mode atomic|incremental] [--price-source on-chain|indexer] [--rebalance-route public|auto|flashbots-private|flashbots-bundle] [--rebalance-route-fallback fail|public] [--flashbots-relay-url <url>] [--flashbots-auth-key <key>] [--flashbots-target-block-offset <n>] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--depth-slippage-bps <n>] [--min-time-to-close-sec <n>] [--strict-close-time-delta] [--chain-id <id>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--oracle <address>] [--factory <address>] [--distribution-yes <parts>] [--distribution-no <parts>] [--distribution-yes-pct <pct>] [--distribution-no-pct <pct>] [--sources <url...>] [--validation-ticket <ticket>] [--target-timestamp <unix|iso>] [--manifest-file <path>] [--trust-deploy] [--skip-gate] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--with-rules] [--include-similarity] [--min-close-lead-seconds <n>] [--dotenv-path <path>]
sync once|run|start|stop|status ...
sync run|once|start --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--paper|--dry-run|--execute-live|--execute] [--private-key <hex>|--profile-id <id>|--profile-file <path>] [--funder <address>] [--usdc <address>] [--trust-deploy] [--manifest-file <path>] [--skip-gate] [--strict-close-time-delta] [--daemon] [--stream|--no-stream] [--interval-ms <ms>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--hedge-ratio <n>] [--rebalance-mode atomic|incremental] [--price-source on-chain|indexer] [--rebalance-route public|auto|flashbots-private|flashbots-bundle] [--rebalance-route-fallback fail|public] [--flashbots-relay-url <url>] [--flashbots-auth-key <key>] [--flashbots-target-block-offset <n>] [--no-hedge] [--max-rebalance-usdc <n>] [--max-hedge-usdc <n>] [--max-open-exposure-usdc <amount>] [--max-trades-per-day <n>] [--cooldown-ms <ms>] [--depth-slippage-bps <n>] [--min-time-to-close-sec <n>] [--iterations <n>] [--state-file <path>] [--kill-switch-file <path>] [--chain-id <id>] [--rpc-url <url>] [--polymarket-rpc-url <url>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>] [--webhook-url <url>] [--telegram-bot-token <token>] [--telegram-chat-id <id>] [--discord-webhook-url <url>]
dashboard [--with-live] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
status --state-file <path>|--strategy-hash <hash> [--with-live] [--pandora-market-address <address>|--market-address <address>] [--polymarket-market-id <id>|--polymarket-slug <slug>] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
pnl    --state-file <path>|--strategy-hash <hash> [--pandora-market-address <address>|--market-address <address>] [--polymarket-market-id <id>|--polymarket-slug <slug>] [--reconciled] [--include-legacy-approx] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
audit  --state-file <path>|--strategy-hash <hash> [--reconciled] [--with-live] [--pandora-market-address <address>|--market-address <address>] [--polymarket-market-id <id>|--polymarket-slug <slug>] [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
drift  --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
hedge-check --state-file <path>|--strategy-hash <hash>|(--pandora-market-address <address>|--market-address <address>) (--polymarket-market-id <id>|--polymarket-slug <slug>) [--trust-deploy] [--manifest-file <path>] [--drift-trigger-bps <n>] [--hedge-trigger-usdc <n>] [--indexer-url <url>] [--timeout-ms <ms>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-gamma-mock-url <url>] [--polymarket-mock-url <url>]
trace  --pandora-market-address <address>|--market-address <address> --rpc-url <url> [--blocks <csv>|--from-block <n> --to-block <n> [--step <n>]] [--limit <n>]
close  --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug>|--all --dry-run|--execute [--wallet <address>] [--chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--indexer-url <url>] [--timeout-ms <ms>]
```

## Batch 1 routing notes

- `dashboard` is a standalone top-level command.
  - it summarizes discovered mirror markets side-by-side.
  - live enrichment is on by default; use `--no-live` when you only want state and daemon context.
- `mirror dashboard` is the mirror-family version of that active-mirror summary surface.
- `mirror drift` is a standalone command.
  - use it when you need the dedicated drift/readiness surface without the full dashboard payload.
- `mirror hedge-check` is a standalone command.
  - use it when you need the current hedge target, gap, trigger state, and Polymarket inventory context.
- `mirror calc` is a standalone command.
  - use it when you need exact Pandora notional to reach a target percentage plus the derived hedge inventory.
  - use `mirror hedge-calc` only for offline sizing from explicit reserves or a resolved pair.
- `quote --target-pct` is supported for buy quotes on AMM markets.
  - it is mutually exclusive with explicit buy amounts; `--yes-pct` still only overrides odds.
- `markets mine` is a standalone command for wallet or signer-owned exposure discovery.
  - use `markets list --creator <address>` or `scan --creator <address>` only when you mean creator-scoped market discovery.
- `fund-check` is a standalone command.
- `explain` is the canonical error-remediation surface for agents and operators. Prefer it over parsing raw error strings yourself.
  - use it when you need exact mirror-driven shortfalls and suggested next commands.
  - use `polymarket check` for lower-level readiness, `polymarket balance` for Polygon USDC.e collateral, and `polymarket positions` for CTF YES/NO inventory and open orders.

Mirror runtime notes:
- `mirror go` and `mirror sync` stay in paper/simulated mode unless you explicitly pass `--execute-live` or `--execute`.
- Live `mirror sync` requires both `--max-open-exposure-usdc` and `--max-trades-per-day`.
- `mirror sync` runs Pandora rebalance and Polymarket hedge as separate legs; cross-venue settlement is not atomic.
- `mirror go --auto-sync` inherits the same separate-leg sync semantics and forwards `--strict-close-time-delta` to the sync daemon when requested.
- `--rebalance-route` and the `flashbots-*` flags affect only the Ethereum Pandora rebalance leg.
  - they do not make the Polygon hedge leg private
  - they do not make ETH plus Polygon settlement atomic
- `--rebalance-route public` preserves ordinary public submission for the Pandora leg.
- `--rebalance-route auto` means the runtime may choose a private single-tx path or a Flashbots bundle for the Pandora leg when that route is supported.
- `--rebalance-route flashbots-private` requests private single-tx routing for the Pandora leg.
- `--rebalance-route flashbots-bundle` requests Flashbots bundle routing for approval plus trade style Pandora paths.
- `--rebalance-route-fallback fail|public` controls whether unsupported private-routing conditions fail closed or degrade to public Pandora submission.
- `mirror sync` surfaces reserve provenance via `snapshots[].metrics.reserveSource`, `snapshots[].actionPlan.reserveSource`, and executed action payloads.
  - `onchain:outcome-token-balances` means runtime refreshed Pandora reserves from on-chain outcome token balances before sizing.
  - `verify-payload` means sizing used the verify payload reserve snapshot.
- `mirror sync` also surfaces `rebalanceSizingMode`, `rebalanceSizingBasis`, and `rebalanceTargetUsdc` so atomic-vs-incremental sizing truth is explicit in payloads.
- `mirror go` and `mirror sync` accept `--rebalance-mode atomic|incremental` and `--price-source on-chain|indexer`.
  - use `atomic + on-chain` for the intended live path
  - use `incremental` or `indexer` only when you intentionally want fallback/debug behavior
- `--min-time-to-close-sec` defaults to `1800`, and the runtime raises the effective floor to `max(--min-time-to-close-sec, ceil(--interval-ms / 1000) * 2)`.
- Startup refusal for a too-small close window returns `MIRROR_EXPIRY_TOO_CLOSE`.
- `--strict-close-time-delta` promotes `CLOSE_TIME_DELTA` from diagnostic-only to blocking; otherwise the Pandora close window remains the hard gate.
- Paper mode can reuse cached or stale Polymarket snapshots. Live mode blocks cached and stale sources through the `POLYMARKET_SOURCE_FRESH` gate.
- short-interval sports sync also expects websocket-backed Polymarket prices; if only stale polled prices are available, live mode blocks instead of trading on outdated source prices.
- `--polymarket-rpc-url` is the preferred Polygon preflight/hedge RPC override and accepts comma-separated fallbacks. Precedence is `--polymarket-rpc-url`, then `POLYMARKET_RPC_URL`, then `--rpc-url`.
- `mirror sync status` returns daemon-health metadata such as `status`, `alive`, `checkedAt`, `pidFile`, `logFile`, and `metadata.pidAlive`.
- `mirror status` always includes `runtime.health`, `runtime.daemon`, `runtime.lastAction`, `runtime.lastError`, `runtime.pendingAction`, and recent `runtime.alerts` when strategy metadata can be resolved.
- `runtime.health.status` is the operator rollup and can be `running`, `idle`, `blocked`, `degraded`, `stale`, or `error`.
  - start with `runtime.health.code`, `runtime.health.message`, `runtime.health.heartbeatAgeMs`, `runtime.pendingAction`, `runtime.lastAction`, and `runtime.lastError`
  - blocked states such as `PENDING_ACTION_LOCK*` or `LAST_ACTION_REQUIRES_REVIEW` are fail-closed; reconcile before restarting live execution
- `dashboard` / `mirror dashboard` are the multi-market operator summary surfaces.
- `mirror status --with-live` adds `crossVenue`, `hedgeStatus`, `actionability`, `actionableDiagnostics`, `pnlScenarios`, `verifyDiagnostics`, `polymarketPosition.diagnostics`, `sourceMarket`, `pandoraMarket`, `netPnlApproxUsdc`, `pnlApprox`, and `netDeltaApprox`, and degrades partial live visibility into diagnostics instead of hard failures.
- `mirror drift` is the dedicated live drift/readiness surface.
- `mirror hedge-check` is the dedicated live hedge-gap/readiness surface.
- `mirror calc` is the exact target-percentage sizing surface for Pandora plus derived hedge inventory.
- `mirror trace` is the standalone canonical historical reserve tracing surface.
  - use it when you need block-by-block Pandora reserve snapshots instead of current live state
  - deep history requires an archive-capable RPC; pruned nodes may fail historical reads even if latest-state reads work
  - traces are capped at 1000 snapshots; narrow the range, increase `--step`, or use `--limit` when a large postmortem sample would exceed that bound
- `mirror pnl` is the canonical mirror accounting-summary surface.
  - current builds always expose the legacy approximate/operator scenario fields
  - add `--reconciled` when you want normalized realized/unrealized, LP fee, hedge-cost, gas, funding, and reserve-trace attribution in the same payload
  - the canonical accounting surface stays on `mirror pnl`; it does not move to a separate long-lived `mirror accounting` command
- `mirror audit` is the canonical mirror ledger/audit surface.
  - current builds prefer the append-only operational audit log and can attach live context with `--with-live`
  - add `--reconciled` when you want normalized cross-venue ledger rows, provenance, and export-ready rows beside the operational ledger
  - the canonical ledger surface stays on `mirror audit`; it does not move to a separate long-lived `mirror accounting` command
- `live.netPnlApproxUsdc` is cumulative LP fees approx minus cumulative hedge cost approx. `live.pnlApprox` adds marked Polymarket inventory on top, and `live.pnlScenarios` projects current token payouts under each outcome.
- The legacy approximate fields remain operator diagnostics, not realized accounting, a full trade ledger, or a substitute for `history`, `export`, `operations` receipts, or post-close reconciliation.
- The reconciled attachment is the ledger-grade layer:
  - `mirror pnl --reconciled` separates realized P&L, unrealized marks, LP fees, impermanent loss, gas, and funding effects
  - `mirror audit --reconciled` exposes deterministic venue/funding/gas/IL provenance in the canonical ledger alongside export-ready rows
- `mirror close` runs `stop-daemons`, `withdraw-lp`, then `claim-winnings`. Polymarket hedge settlement remains manual in this command version.

## Polymarket subcommands

```text
check [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]
approve --dry-run|--execute [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]
preflight [--condition-id <id>|--slug <slug>|--token-id <id>] [--token yes|no] [--amount-usdc <n>] [--side buy|sell] [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]
balance [--wallet <address>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]
positions [--wallet <address>|--funder <address>] [--condition-id <id>|--market-id <id>|--slug <slug>|--token-id <id>] [--source auto|api|on-chain] [--rpc-url <url>] [--polymarket-host <url>] [--polymarket-gamma-url <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>]
deposit --amount-usdc <n> --dry-run|--execute [--to <address>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]
withdraw --amount-usdc <n> --dry-run|--execute [--to <address>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]
trade --condition-id <id>|--slug <slug>|--token-id <id> --token yes|no --amount-usdc <n> --dry-run|--execute [--side buy|sell] [--polymarket-host <url>] [--polymarket-mock-url <url>] [--timeout-ms <ms>] [--fork] [--fork-rpc-url <url>] [--fork-chain-id <id>] [--rpc-url <url>] [--private-key <hex>] [--funder <address>]
```

- `POLYMARKET_FUNDER` / `--funder` must identify the Polymarket proxy wallet (Gnosis Safe), not the signer EOA.
- `balance` is the quick proxy/signer funding surface for live mirror hedges.
  - it answers the collateral question: how much Polygon USDC.e is available on the signer and proxy wallet
  - it is not the canonical YES/NO share inventory surface
- `positions` is the canonical Polymarket CTF inventory surface.
  - use it when you need YES/NO balances, token ids, condition or market ids, open-order counts/notional, marked value, and diagnostics for a wallet or proxy
  - operators should expect inventory fields such as `yesBalance`, `noBalance`, `yesTokenId`, `noTokenId`, `conditionId|marketId`, value fields such as `estimatedValueUsd`, `prices.yes`, `prices.no`, and open-order fields such as `openOrdersCount` and `openOrdersNotionalUsd`
  - `--source auto` is the default operator mode: prefer API/CLOB enrichment for metadata, prices, and open orders, then fall back to raw on-chain CTF balance reads when enrichment is unavailable
  - `--source api` prefers enriched API/CLOB inventory and is the best choice when operators need open-order and value fields from Polymarket services
  - `--source on-chain` forces Polygon RPC / CTF balance reads and is the trust-minimized fallback when API enrichment is unavailable or intentionally bypassed
  - when the command falls back to raw on-chain inventory, expect the share balances and token identifiers to remain usable while price/open-order enrichment can degrade to diagnostics or null fields until API/CLOB data is available
- `deposit` moves Polygon USDC.e from signer to proxy by default. `withdraw` can preview moving collateral back from proxy to signer (or to `--to`), but execute mode only works when the signer controls the source wallet; proxy-originated withdrawals usually require manual execution from the proxy wallet.
- `deposit` / `withdraw` are funding transfers, not CLOB order placement.
- `polymarket check|approve|preflight|balance|positions|deposit|withdraw|trade --rpc-url` accepts comma-separated Polygon RPC fallbacks and tries them in order.
- Explicit `--rpc-url` still wins over `POLYMARKET_RPC_URL`, which still wins over `RPC_URL`.

## Resolve notes

- `resolve --watch` repeatedly runs dry-run prechecks until the market becomes executable.
- Combine `--watch --execute` to submit automatically once finalization opens.
- The dry-run precheck is the surface to read `currentEpoch`, `finalizationEpoch`, `epochsUntilFinalization`, and `claimable` instead of guessing from a revert.
- For mirror exits, the preferred order is `mirror close --dry-run`, then `resolve --dry-run --watch` or `resolve --execute --watch`, then `claim --dry-run|--execute`.

## Simulate and model subcommands

```text
simulate mc [--trials <n>] [--horizon <n>] [--start-yes-pct <0-100>] [--entry-yes-pct <0-100>] [--position yes|no] [--stake-usdc <n>] [--drift-bps <n>] [--vol-bps <n>] [--confidence <50-100>] [--var-level <50-100>] [--seed <n>] [--antithetic] [--stratified]
simulate particle-filter (--observations-json <json>|--input <path>|--stdin) [--particles <n>] [--process-noise <n>] [--observation-noise <n>] [--drift-bps <n>] [--initial-yes-pct <0-100>] [--initial-spread <n>] [--resample-threshold <0-1>] [--resample-method systematic|multinomial] [--credible-interval <50-100>] [--seed <n>]
simulate agents [--n-informed <n>] [--n-noise <n>] [--n-mm <n>] [--n-steps <n>] [--seed <int>]
model calibrate (--prices <csv>|--returns <csv>) [--dt <n>] [--jump-threshold-sigma <n>] [--min-jump-count <n>] [--model-id <id>] [--save-model <path>]
model correlation --series <id:v1,v2,...> --series <id:v1,v2,...> [--copula t|gaussian|clayton|gumbel] [--compare <csv>] [--tail-alpha <n>] [--df <n>] [--joint-threshold-z <n>] [--scenario-shocks <csv>] [--model-id <id>] [--save-model <path>]
model diagnose [--calibration-rmse <n>] [--drift-bps <n>] [--spread-bps <n>] [--depth-coverage <0..1>] [--informed-flow-ratio <0..1>] [--noise-ratio <0..1>] [--anomaly-rate <0..1>] [--manipulation-alerts <n>] [--tail-dependence <0..1>]
model score brier [--source <name>] [--market-address <address>] [--competition <id>] [--event-id <id>] [--model-id <id>] [--group-by source|market|competition|model|none] [--window-days <n>] [--bucket-count <n>] [--forecast-file <path>] [--include-records] [--include-unresolved] [--limit <n>]
```

## Sports command matrix

Use `pandora --output json schema` for the exact live contract and `pandora sports ... --help` for family routing. `capabilities` is the compact digest, not the full contract surface.

Execution note:
- `sports create run` is the mutating path. On CLI it uses `--dry-run|--execute`; on MCP execute-mode calls it also requires `agentPreflight` from `agent.market.validate`.
- `sports create run --market-type parimutuel` is planning-only today. Dry-run emits the pari-mutuel template, but live execute currently supports AMM only.

### Sports exact paths

```text
pandora [--output table|json] sports books list ...
pandora [--output table|json] sports schedule ...
pandora [--output table|json] sports scores ...
pandora [--output table|json] sports events list ...
pandora [--output table|json] sports events live ...
pandora [--output table|json] sports odds snapshot ...
pandora [--output table|json] sports odds bulk ...
pandora [--output table|json] sports consensus ...
pandora [--output table|json] sports create plan ...
pandora [--output table|json] sports create run ...
pandora [--output table|json] sports sync once|run|start|stop|status ...
pandora [--output table|json] sports resolve plan ...
```

| Command | Purpose | Primary flags |
| --- | --- | --- |
| `sports books list` | Show sportsbook provider health and active book preference list. | `--provider`, `--book-priority`, `--timeout-ms` |
| `sports schedule` | List normalized sports fixtures in kickoff order for operator readouts. Soccer remains `soccer_winner`; supported US-sports feeds now normalize to `moneyline`. | `--competition`, `--date`, `--kickoff-after`, `--kickoff-before`, `--limit` |
| `sports scores` | Return current live score and status rows for one event or the active slate. | `--event-id` or `--game`, `--competition`, `--date`, `--kickoff-after`, `--kickoff-before`, `--limit`, `--timeout-ms` |
| `sports events list` | List normalized sports events. | `--competition`, `--kickoff-after`, `--kickoff-before`, `--limit` |
| `sports events live` | List only live/in-play events. | `--competition`, `--limit`, `--provider` |
| `sports odds snapshot` | Fetch event odds snapshot plus consensus context. | `--event-id`, `--trim-percent`, `--min-tier1-books`, `--min-total-books` |
| `sports odds bulk` | Fetch all odds for a competition and refresh local cache. | `--competition`, `--provider`, `--timeout-ms`, `--limit` |
| `sports consensus` | Compute trimmed-median consensus from live or offline checks. | `--event-id` or `--checks-json`, `--trim-percent`, `--book-priority` |
| `sports create plan` | Build conservative creation plan and safety gates. | `--event-id`, `--selection`, `--market-type`, `--category`, `--creation-window-open-min`, `--creation-window-close-min`, `--book-priority`, `--model-file/--model-stdin` |
| `sports create run` | Dry-run or execute creation path. Pari-mutuel stays planning-only; live execute currently supports AMM only. | `--event-id`, `--dry-run/--execute`, `--market-type`, `--liquidity-usdc`, `--chain-id`, `--rpc-url`, `--category`, `agentPreflight` (MCP execute). For exact fields, inspect `schema` or the specific command descriptor. |

- Sports provider auth:
  - `SPORTSBOOK_PRIMARY_API_KEY_MODE` / `SPORTSBOOK_BACKUP_API_KEY_MODE` support `header` (default) or `query`.
  - Query mode injects the key into `apiKey` by default; override the parameter name with `SPORTSBOOK_PRIMARY_API_KEY_QUERY_PARAM` / `SPORTSBOOK_BACKUP_API_KEY_QUERY_PARAM`.

## Pari-mutuel operator notes

- Creation:
  - `pandora launch --market-type parimutuel` is the current generic scripted creator for standalone pari-mutuel markets.
  - `pandora clone-bet` is pari-mutuel-only and immediately places an initial buy after creation.
  - `sports create plan` can build pari-mutuel templates, but `sports create run --execute` remains AMM-only.
- Curve controls:
  - `--curve-flattener` controls how sharply the pool pricing curve approaches the implied final probability.
  - `--curve-offset` controls how far the initial pool starts from the neutral 50/50 baseline.
- Trading:
  - `trade` supports buy-side execution on both AMM and pari-mutuel markets by auto-detecting the market interface.
  - `sell` is AMM-only. Pari-mutuel markets do not expose a sell path.
  - `quote --target-pct` is AMM-only; pari-mutuel quote output is pool/share based, not reserve-rebalance targeting.
- Quote interpretation:
  - pari-mutuel quote payloads include `poolYes`, `poolNo`, `totalPool`, `sharePct`, `payoutIfWin`, `profitIfWin`, and `breakevenProbability`.
  - those fields describe your pool ownership and conditional payout if the selected side wins.
- Portfolio and valuation:
  - portfolio normalizes pari-mutuel raw balances and micro-unit balances before computing `markValueUsdc`.
  - pari-mutuel mark value is derived from pool share against `totalPool`, not from AMM probability times token count.
| `sports sync once|run|start|stop|status` | Evaluate and operate sports sync runtime state. | `--event-id` (required for `once|run|start`), `--risk-profile`, `--state-file`, `--paper/--execute-live` |
| `sports resolve plan` | Build manual-final resolution recommendation. | `--event-id` or `--checks-json/--checks-file`, `--poll-address`, `--settle-delay-ms`, `--consecutive-checks-required` |

## Sports policy defaults

### Consensus policy
- Odds are normalized to implied probability from decimal/American/fractional inputs.
- Consensus method is `trimmed-median` (v1), with default `--trim-percent 20`.
- Conservative coverage inputs default to `--min-tier1-books 3` and `--min-total-books 6`.

### Timing policy
- Creation planning defaults:
  - `--creation-window-open-min 1440` (24h before kickoff)
  - `--creation-window-close-min 90` (90m before kickoff)
- Core timing module defaults (spec-level fallbacks):
  - creation open lead `7d`
  - creation close lead `15m`
  - assumed event duration `3h`
  - resolve open delay `30m`
  - resolve target delay `2h`
  - resolve close delay `48h`
- Resolve plan safety defaults:
  - `--settle-delay-ms 600000` (10m)
  - `--consecutive-checks-required 2`

### Sync risk defaults
- Conservative (`--risk-profile conservative`):
  - `maxDataAgeMs=120000`
  - `minCoverageRatio=0.70`
  - `maxCoverageDropRatio=0.25`
  - `maxSpreadJumpBps=150`
  - `maxConsecutiveFailures=3`
  - `maxConsecutiveGateFailures=2`
- Balanced:
  - `maxDataAgeMs=150000`
  - `minCoverageRatio=0.60`
  - `maxCoverageDropRatio=0.30`
  - `maxSpreadJumpBps=200`
  - `maxConsecutiveFailures=4`
  - `maxConsecutiveGateFailures=3`
- Aggressive:
  - `maxDataAgeMs=180000`
  - `minCoverageRatio=0.50`
  - `maxCoverageDropRatio=0.40`
  - `maxSpreadJumpBps=250`
  - `maxConsecutiveFailures=5`
  - `maxConsecutiveGateFailures=4`

## Safe examples

### Read-only
```bash
pandora markets list --active --with-odds --limit 20
pandora markets get --id <market-id>
pandora scan --limit 25
pandora polls list --status 1 --category 1
pandora quote --market-address <0x...> --side yes --amount-usdc 50
pandora portfolio --wallet <0x...> --chain-id 1
pandora arb scan --source polymarket --output json --iterations 1 --min-net-spread-pct 2
pandora operations list --status planned,queued,running --limit 20
```

## Durable operations

Use the `operations` family to inspect and control persisted mutable-operation records created by the agent/runtime layer.

```text
operations get --id <operation-id>
operations list [--status <csv>] [--tool <name>] [--limit <n>]
operations cancel --id <operation-id> [--reason <text>]
operations close --id <operation-id> [--reason <text>]
```

Notes:
- `operations.get` returns one record plus lifecycle timestamps and checkpoints.
- `operations.list` is the compact queue/dashboard view for persisted records.
- `operations.cancel` is for cancelable in-flight records.
- `operations.close` is for terminal records after follow-up is complete.
- Current persisted records are local-state objects. Use `pandora --output json capabilities` / `schema` for the machine-facing contract.
- For remote operators, use `operations:read` for `operations.get|list`.
- Use `operations:write` only for `operations.cancel|close`.
- Over MCP, `operations.cancel|close` also require `intent.execute=true`.

### Mirror
```bash
pandora mirror browse --polymarket-tag-id 82 --min-yes-pct 20 --max-yes-pct 80 --min-volume-24h 100000 --limit 10
pandora mirror plan --source polymarket --polymarket-market-id <id> --with-rules --include-similarity
pandora mirror deploy --polymarket-slug <slug> --liquidity-usdc 10 --category Sports --sources <url1> <url2> --dry-run
pandora mirror go --polymarket-slug <slug> --liquidity-usdc 10 --category Sports --paper
pandora mirror sync once --pandora-market-address <0x...> --polymarket-market-id <id> --paper --hedge-ratio 1.0
pandora mirror sync status --strategy-hash <hash>
pandora dashboard
pandora mirror dashboard --with-live
pandora mirror status --strategy-hash <hash> --with-live
pandora mirror drift --market-address <pandora_market> --polymarket-market-id <poly_market_id>
pandora mirror hedge-check --market-address <pandora_market> --polymarket-market-id <poly_market_id>
pandora mirror pnl --strategy-hash <hash>
pandora mirror pnl --market-address <pandora_market> --polymarket-market-id <poly_market_id>
pandora mirror audit --strategy-hash <hash> --with-live
pandora mirror audit --market-address <pandora_market> --polymarket-market-id <poly_market_id>
pandora mirror trace --market-address <pandora_market> --rpc-url <archive_rpc_url> --from-block <start> --to-block <end> --step 25
pandora mirror close --pandora-market-address <0x...> --polymarket-market-id <id> --dry-run
```

### Resolve and Polymarket
```bash
pandora polymarket balance --funder 0x...
pandora polymarket positions --funder 0x... --condition-id <condition_id> --source auto
pandora polymarket positions --wallet <trader_wallet> --token-id <ctf_token_id> --source on-chain --rpc-url <polygon_rpc_url>
pandora polymarket deposit --amount-usdc 250 --dry-run --funder 0x...
pandora resolve --poll-address 0x... --answer yes --reason "Official final result" --dry-run --watch
pandora resolve --poll-address 0x... --answer yes --reason "Official final result" --execute --watch
```

### Legacy script wrappers
See [`legacy-launchers.md`](./legacy-launchers.md) for `launch` and `clone-bet` examples and their script-layer timing behavior.
