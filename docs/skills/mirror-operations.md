# Mirror Operations Guide

Use this guide for `mirror browse|plan|deploy|verify|hedge-calc|calc|go|hedge|sync|dashboard|status|health|panic|drift|hedge-check|pnl|audit|replay|trace|logs|close`, plus the related top-level `dashboard`, `fund-check`, and `explain` commands.

For first-run setup and optional guided onboarding, see [`setup-and-onboarding.md`](./setup-and-onboarding.md) before you attempt `mirror plan|deploy|go`.

## `mirror hedge` vs `mirror sync`
- `mirror hedge` is Polymarket Hedge Mode.
- Use Polymarket Hedge Mode when you want to stay delta neutral on Polymarket and earn fees from Pandora flow.
- `mirror hedge` is the packaged daemon surface for an existing mirror pair.
- `mirror hedge` now manages a net Polymarket inventory target for the market instead of hedging each external Pandora trade independently.
- `--min-hedge-usdc` is the execution threshold for the current target-vs-actual hedge gap; small external trades still update target exposure and accumulate.
- `--adopt-existing-positions` treats observed Polymarket inventory as the starting live hedge baseline and then trades only the delta to target.
- Sell-side reductions always run before any new opposite-side buy. If a sell is blocked, partially unresolved, or exchange-failed in the same tick, the daemon skips the buy phase instead of building both-side inventory.
- `mirror hedge status` is now the operator truth surface for sell retry health.
  - `sellRetryAttemptedCount`, `sellRetryBlockedCount`, `sellRetryFailedCount`, and `sellRetryRecoveredCount` show whether reductions are being retried, blocked by policy/depth, rejected by the exchange, or cleared from the live queue.
  - `BOTH_SIDE_INVENTORY_LOCKUP` means actual Polymarket inventory still holds both YES and NO while the target is single-sided, so the operator should inspect sell-side reductions immediately.
- `mirror sync --no-hedge` is Pandora Mirroring Mode.
- Use Pandora Mirroring Mode when you want to be the market maker on Pandora and keep Pandora odds aligned to Polymarket without placing Polymarket hedges.
- Plain `mirror sync` without `--no-hedge` is the hybrid loop. It may rebalance Pandora and hedge on Polymarket in the same cycle.
- `mirror sync` remains the lower-level local/manual loop, one-shot execution surface, and troubleshooting path.
- Bundle artifacts support DigitalOcean droplets and generic VPS targets today.
- Cloudflare Workers are not supported in v1 because the hedge daemon expects a long-running stateful runtime with local process/file lifecycle.

## Canonical Batch 1 routing
- `dashboard` is a standalone top-level command.
  - it summarizes discovered mirror markets side-by-side.
  - live enrichment is enabled by default; use `--no-live` when you only want state and daemon context.
- `mirror dashboard` is the mirror-family version of that active-mirror summary surface.
- `mirror drift` is a standalone command.
  - use it for the dedicated drift/readiness surface without the full dashboard payload.
- `mirror hedge-check` is a standalone command.
  - use it for the dedicated hedge-gap/readiness surface without the full dashboard payload.
- `mirror calc` is a standalone command.
  - use it for exact Pandora target-percentage sizing plus the derived hedge inventory.
  - use `mirror hedge-calc` only for offline sizing from explicit reserves or a resolved pair.
- `mirror trace` is a standalone command.
  - use it for historical Pandora reserve snapshots instead of current live diagnostics.
- `fund-check` is a standalone command.
  - use it when you need exact shortfalls and suggested next commands for live hedge readiness.
  - use `pandora polymarket check` for lower-level readiness, `pandora polymarket balance` for Polygon USDC.e collateral, and `pandora polymarket positions` for canonical CTF YES/NO inventory without mirror aggregation.

## Non-negotiable operator rules
- `mirror plan|deploy|go` do **not** use a generic `+1h` assumption.
- `mirror plan` computes a sports-aware suggested `targetTimestamp`.
- Keep that suggested timestamp unless you have a better close-time estimate.
- Use `--target-timestamp <unix|iso>` only when you intentionally need to override the plan’s suggested close time.
- `mirror go|sync` stay in paper/simulated mode unless you explicitly pass `--execute-live` or `--execute`.
- `mirror sync` simulates or executes Pandora rebalance and Polymarket hedge as separate legs. It is not atomic across venues.
- If you want pure Pandora Mirroring Mode, add `--no-hedge`.
- If you want pure Polymarket Hedge Mode, use `mirror hedge` instead of `mirror sync`.
- `mirror go --auto-sync` still inherits the same separate-leg sync semantics; it does not turn the cross-venue path into an atomic transaction.
- `--rebalance-route` and the `flashbots-*` flags apply only to the Ethereum Pandora rebalance leg.
  - they do **not** make the Polygon hedge leg private
  - they do **not** make the ETH-plus-Polygon mirror cycle atomic
- `--rebalance-route public` preserves the current public-submission behavior for the Pandora leg.
- `--rebalance-route auto` allows the runtime to prefer Flashbots/private routing for the Pandora leg when supported.
- `--rebalance-route flashbots-private` requests private single-transaction routing for the Pandora leg.
- `--rebalance-route flashbots-bundle` requests Flashbots bundle routing when the Pandora leg needs approval-plus-trade style submission.
- `--rebalance-route-fallback fail|public` decides whether unsupported or rejected private routing fails closed or degrades to ordinary public Pandora submission.
- `mirror deploy|go` require at least **two independent public resolution URLs from different hosts** in `--sources`.
- Polymarket, Gamma, and CLOB URLs are discovery inputs only and are **not** valid `--sources`.
- Fresh execute mode is validation-gated. The exact final `question`, `rules`, `sources`, and `targetTimestamp` must be validated before live deployment.
- `mirror sync` enforces a close-window guard via `--min-time-to-close-sec`.
  - default requested floor: `1800` seconds
  - effective floor: `max(--min-time-to-close-sec, ceil(--interval-ms / 1000) * 2)`
  - startup refusal code when expiry is already too near: `MIRROR_EXPIRY_TOO_CLOSE`
- `--strict-close-time-delta` promotes `CLOSE_TIME_DELTA` from diagnostic-only to blocking.
  - without it, Polymarket close-time mismatch stays informational
  - Pandora trading time remains the hard close-window gate
- Live sync blocks cached Polymarket source snapshots.
  - paper/dry-run may reuse `polymarket:cache` and surfaces that choice in diagnostics
  - live mode requires fresh source data and fails the `POLYMARKET_SOURCE_FRESH` gate otherwise
- `mirror trace` is the historical reserve forensics surface.
  - it samples Pandora reserves at explicit blocks or across a block range without mutating state
  - use an archive-capable RPC for deep history; pruned nodes often fail historical `eth_call` reads outside their retained state window
- Use `--polymarket-rpc-url` when Polygon preflight or hedge RPC should differ from the main Pandora `--rpc-url`.
  - comma-separated RPC fallbacks are tried in order during live preflight
  - live preflight precedence is `--polymarket-rpc-url`, then `POLYMARKET_RPC_URL`, then `--rpc-url`
- Runtime reserve provenance is explicit in sync payloads.
  - `snapshots[].metrics.reserveSource`, `snapshots[].actionPlan.reserveSource`, and the reserve context payload tell you whether sizing used `verify-payload` reserves or `onchain:outcome-token-balances`
  - `reserveReadAt` / `reserveReadError` show when the runtime reserve refresh happened and whether it degraded
  - `rebalanceSizingMode`, `rebalanceSizingBasis`, and `rebalanceTargetUsdc` show whether the sync leg used atomic target sizing or an incremental fallback
- Prefer `--rebalance-mode atomic --price-source on-chain` for live mirror sync.
  - `atomic` sizes the Pandora rebalance leg against the current source-vs-Pandora target price in one move when reserves are available
  - `incremental` is a fallback/debug mode that sizes by observed drift instead of solving for the target price
  - `on-chain` refreshes Pandora outcome-token balances before sizing; live mode now fails closed if that reserve refresh is unavailable
  - `indexer` reuses verify payload reserves and is mainly for paper/debug runs
- Private-routing knobs for the Pandora leg are:
  - `--rebalance-route public|auto|flashbots-private|flashbots-bundle`
  - `--rebalance-route-fallback fail|public`
  - `--flashbots-relay-url <url>`
  - `--flashbots-auth-key <key>`
  - `--flashbots-target-block-offset <n>`
- Live mode also rejects stale polled Polymarket data, not just explicit cache snapshots.
  - short-interval sports sync expects websocket-backed source prices
  - if the source is too old or stream-backed prices were expected but not available, the `POLYMARKET_SOURCE_FRESH` gate blocks execution

## First-run onboarding
- Fresh installs should start with `pandora setup --interactive --goal paper-mirror` or `--goal live-mirror` before `mirror plan|deploy|go`.
- For packaged LP daemon rollout, start with `pandora setup --interactive --goal paper-hedge-daemon` or `--goal live-hedge-daemon`.
- The guided setup path surfaces signer, Polymarket, hosting, and provider prerequisites before you reach the mirror validation gates.
- Hedge-daemon goals intentionally skip deploy-time sports discovery and resolution-source capture; those belong to `paper-mirror` and `live-mirror`.
- `PANDORA_RESOLUTION_SOURCES` is a convenience fallback for env-driven setups; explicit `--sources` still win and still require two public URLs from different hosts.

## Live sports sell-side runbook
- Default live sports stance should stay `--sell-hedge-policy depth-checked`.
  - this keeps auto-sells on, but only when the orderbook proves there is executable depth
  - use `manual-only` only when you intentionally want human intervention before every hedge reduction
- Start volatile sports windows with `--depth-slippage-bps 100`.
  - if sell retries keep blocking while `BOTH_SIDE_INVENTORY_LOCKUP` stays present, widen cautiously to `150` or `200` before you consider disabling auto-sells
  - do not let the daemon keep buying the opposite side through a stuck sell; the runtime now skips buy expansion in that case and surfaces the retry counters instead
- Watch these fields during a live game:
  - `deferredHedgeCount`
  - `sellRetryBlockedCount`
  - `sellRetryFailedCount`
  - `sellRetryRecoveredCount`
  - `warningCount` and `BOTH_SIDE_INVENTORY_LOCKUP`

## Polymarket funding and proxy wallet

- `POLYMARKET_FUNDER` / `--funder` must point at the Polymarket proxy wallet (Gnosis Safe), not the signer EOA.
- Live CLOB collateral is Polygon USDC.e on that proxy wallet.
- Use `pandora polymarket balance --funder <proxy>` before live sync to inspect signer and proxy collateral balances.
- Use `pandora polymarket positions` when you need the actual CTF hedge inventory rather than collateral.
  - it is the canonical YES/NO share inventory surface for operators, closeout, and hedge validation
  - expected fields include inventory identifiers (`conditionId`, `marketId`, `yesTokenId`, `noTokenId`), inventory balances (`yesBalance`, `noBalance`), value fields (`estimatedValueUsd`, `prices.yes`, `prices.no`), open-order fields (`openOrdersCount`, `openOrdersNotionalUsd`), and source/provenance diagnostics when the payload is partial
  - `--source auto` should be the default operator mode: use API/CLOB enrichment when available, then fall back to raw on-chain CTF balance reads when enrichment is unavailable
  - `--source api` is for enriched Polymarket inventory, pricing, and open-order visibility
  - `--source on-chain` forces Polygon RPC / CTF reads and is the fail-safe fallback when API enrichment is down or intentionally bypassed
  - when the command is running on raw on-chain fallback, treat balances and token ids as canonical and treat open-order/value fields as opportunistic enrichment that may degrade to diagnostics or nulls
- Use `pandora fund-check` for the high-level mirror funding planner; use `pandora polymarket check` when you need the lower-level readiness surface that validates ownership, approvals, and RPC health directly.
- Use `pandora polymarket deposit --amount-usdc <n> --dry-run|--execute` to move USDC.e from signer to proxy. `pandora polymarket withdraw` can preview moving funds back or to `--to`, but execute mode only works when the signer controls the source wallet; proxy-originated withdrawals typically require manual execution from the proxy wallet.
- Treat proxy funding as a separate prerequisite from ETH-mainnet Pandora capital. A healthy Pandora signer balance does not mean the Polygon hedge wallet is funded.

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

When a user asks for mirror planning or preflight guidance:
- explicitly say the live path remains validation-gated
- explicitly name `agent market validate` as the pre-deploy gate after the final question, rules, sources, and target timestamp are known
- explicitly say the live path needs at least two independent public resolution URLs from different hosts
- explicitly say Polymarket, Gamma, and CLOB URLs are discovery inputs only, not valid resolution sources
- do not stop at `mirror browse` alone unless the user asked only for candidate discovery

### 3. Prepare final operator inputs
- choose at least two independent public resolution URLs from different hosts
- keep the plan’s suggested `targetTimestamp`, or set `--target-timestamp <unix|iso>` explicitly when you have a justified override
- pick the correct PollCategory (`Sports` / `1` for sports)
- for mirror sync/go, `--profile-id` / `--profile-file` now drive both Pandora signing and Polymarket inventory/hedge auth when the profile can materialize private key material (local-env/local-keystore); external-signer profiles still need explicit `POLYMARKET_*` runtime credentials for CLOB auth
- if you are exposing mirror flows through `pandora mcp http`, inspect the tool `policyScopes` first and grant only the exact scopes needed for the run
- inspect `policy list|get` and `profile list|get` before live automation; direct Pandora commands such as `trade`, `sell`, `lp add`, `lp remove`, `resolve`, and `claim` already support profile selectors, and current mirror deployment/sync flows also accept `--profile-id` / `--profile-file`

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
  --rebalance-mode atomic \
  --price-source on-chain \
  --paper
```

### 5. Validate the exact final payload
- run `agent market validate` on the exact final values
- rerun CLI execute with `--validation-ticket <ticket>`
- mention this validation gate explicitly when summarizing any dry-run or preflight answer

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
pandora dashboard
pandora mirror dashboard --with-live
pandora mirror status --strategy-hash <hash> --with-live
pandora mirror drift --market-address <pandora_market> --polymarket-market-id <poly_market_id>
pandora mirror hedge-check --market-address <pandora_market> --polymarket-market-id <poly_market_id>
pandora mirror trace --market-address <pandora_market> --rpc-url <archive_rpc_url> --from-block <start> --to-block <end> --step 25
pandora polymarket balance --funder <proxy-wallet>
pandora polymarket positions --funder <proxy-wallet> --condition-id <condition_id> --source auto
```

### 8. Close out deterministically
```bash
pandora mirror close --pandora-market-address <0x...> --polymarket-market-id <id> --dry-run
pandora mirror pnl --strategy-hash <hash>
pandora mirror pnl --market-address <pandora_market> --polymarket-market-id <poly_market_id>
pandora mirror audit --strategy-hash <hash> --with-live
pandora mirror audit --market-address <pandora_market> --polymarket-market-id <poly_market_id>
```

## Sync and daemon notes
- Prefer `mirror hedge` for the packaged LP daemon lifecycle on DigitalOcean droplets or a generic VPS.
- Use `mirror sync` when you want a local/manual loop, a one-shot reconciliation run, or lower-level troubleshooting.
- Cloudflare Workers are not supported in v1 for `mirror hedge`; the daemon runtime expects a long-running stateful process with local lifecycle management.
- `mirror sync run|once|start` use the same mirror payload assumptions built during deploy/go.
- `mirror sync run` is the foreground loop.
  - `--stream|--no-stream` only applies to `run`
  - `--stream` is a table-mode terminal feature; JSON mode stays bounded unless `PANDORA_DAEMON_LOG_JSONL=1` is set for daemon logs
  - `--daemon` is a `run`/family concept; use `mirror sync start` for the detached path
- `mirror go` / `mirror sync` do not accept a daemon `--source` flag.
  - `--source auto|api|on-chain` belongs to `pandora polymarket positions`
- Live daemon execution requires both `--max-open-exposure-usdc` and `--max-trades-per-day`.
- Hedging is enabled by default on mirror daemon paths; add `--no-hedge` only when you intentionally want Pandora-only operation.
- Use `mirror-live-repro-checklist.md` for tx-drop, relay-403, and Gamma-search investigations that still need captured evidence.
- `mirror sync stop|status` can target `--strategy-hash <hash>` or an explicit `--pid-file <path>`.
- `mirror sync status` is the daemon-health surface.
  - key metadata fields are `status`, `alive`, `checkedAt`, `pidFile`, `logFile`, and `metadata.pidAlive`
  - stop responses also add `signalSent`, `forceKilled`, and `exitObserved`
- `mirror dashboard` is the canonical operator summary for active mirror markets discovered from local state and daemon metadata.
  - `pandora dashboard` is the top-level convenience alias; it enables live enrichment by default and supports `--no-live`
- `mirror status` is the persisted-state single-market dashboard for a strategy hash or state file, and it also supports selector-first lookup when persisted state is not available yet.
  - `runtime.health.status` can be `running`, `idle`, `blocked`, `degraded`, `stale`, or `error`
  - start with `runtime.health.code`, `runtime.health.message`, `runtime.health.heartbeatAgeMs`, `runtime.pendingAction`, `runtime.lastAction`, and `runtime.lastError`
  - `blocked` states such as `PENDING_ACTION_LOCK*` or `LAST_ACTION_REQUIRES_REVIEW` are fail-closed; reconcile before restarting or sending another live trade
  - `mirror sync unlock` is the supported operator recovery command for the common timeout/manual-review path and clears the matching persisted blocker when you intentionally override it
  - `stale` means daemon metadata still reports alive but the heartbeat aged past threshold; inspect pid/log state before trusting it
- `mirror status --with-live` is the live diagnostic surface for an existing mirror, whether it was resolved from persisted state or direct selectors.
  - `live.verifyDiagnostics` carries verify-time feed/match warnings
  - `live.polymarketPosition.mergeReadiness` and `live.polymarketPosition.diagnostics` carry merge-advisory, balance, and open-order visibility warnings instead of hard-failing when that view is partial
  - `--drift-trigger-bps`, `--hedge-trigger-usdc`, `--indexer-url`, `--timeout-ms`, and Polymarket host/mock overrides all apply to this live diagnostic projection path
  - the live payload also includes `sourceMarket`, `pandoraMarket`, `netPnlApproxUsdc`, `pnlApprox`, and `netDeltaApprox`
- `mirror drift` is the dedicated live drift/readiness surface.
  - use it when operators only need drift, trigger, rebalance-side, and cross-venue status.
- `mirror hedge-check` is the dedicated live hedge-gap/readiness surface.
  - use it when operators only need hedge target, current hedge, gap, trigger, and inventory context.
- `mirror calc` is the exact target-percentage sizing surface.
  - use it when operators need the required Pandora notional and derived hedge inventory for a target percentage instead of threshold-only alerts.
  - `netPnlApproxUsdc` is cumulative LP fees approx minus cumulative hedge cost approx; `pnlApprox` adds marked Polymarket inventory; `pnlScenarios` projects current token payouts under each outcome
  - these are operator estimates, not realized closeout proceeds, a full cross-chain trade ledger, or tax-ready accounting
  - use `history`, `export`, `operations` receipts, `polymarket positions` for CTF inventory, and `polymarket balance` for collateral when you need reconciliation beyond the status dashboard
- `mirror pnl` is the dedicated cross-venue scenario surface.
  - it promotes the `mirror status --with-live` scenario model into a compact summary with `netPnlApproxUsdc`, `pnlApprox`, `netDeltaApprox`, `hedgeGapUsdc`, and projected resolution outcomes
  - it also supports selector-first lookup when you do not have a persisted state file yet
  - the default fields remain approximate/operator accounting
  - add `--reconciled` to attach explicit realized, unrealized, LP fee, impermanent-loss, gas, funding, provenance, and export-ready rows without leaving this command family
- `mirror audit` is the classified mirror execution ledger.
  - it prefers the append-only mirror audit log when present and falls back to persisted action/alert state only when the ledger does not exist yet
  - use `--with-live` when you need current cross-venue context attached next to the persisted or append-only history
  - the base ledger remains operational/classified history
  - add `--reconciled` to attach deterministic venue, funding, gas, reserve-trace, and inventory-mark provenance into the same payload
- `mirror trace` is the read-only historical reserve tracing surface.
  - use it when postmortems or accounting need reserve snapshots at block `N, N+step, ...`
  - it requires `--market-address`/`--pandora-market-address` plus `--rpc-url`; choose either explicit `--blocks` or a `--from-block` / `--to-block` range
  - payloads should include reserve values, derived YES percentage, fee tier, block metadata, and RPC provenance
  - if the selected RPC cannot serve the requested block history, switch to an archive-capable endpoint instead of trusting partial results
  - traces are capped at 1000 snapshots; narrow the range, increase `--step`, or use `--limit` when a wide postmortem sample would exceed that bound
- `mirror close` is the deterministic closeout path for stop -> withdraw LP -> claim style cleanup.
  - it runs `stop-daemons`, `withdraw-lp`, then `claim-winnings` in order
  - it does **not** automatically settle remaining Polymarket hedge inventory; that remains manual in this command version

### Reconciled accounting rollout

- Keep the public accounting contract on `mirror pnl` plus `mirror audit`.
- Do not treat a future `mirror accounting` command as the default plan when the existing surfaces can carry the reconciled model.
- Current state:
  - `mirror pnl` still includes the operator-estimate scenario model
  - `mirror audit` still includes the operational/classified runtime ledger
- Reconciled attachment now lands on those same two commands:
  - `mirror pnl --reconciled` adds the summarized accounting breakout
  - `mirror audit --reconciled` adds the detailed normalized ledger
- Expected reconciled breakout:
  - realized P&L
  - unrealized mark-to-market
  - LP fee income
  - impermanent loss
  - gas
  - funding and bridge flows
- Keep using `history`, `export`, `operations` receipts, `mirror trace`, and `polymarket positions` when you need supporting reconciliation evidence beyond what the current reconciled attachment already includes.

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
