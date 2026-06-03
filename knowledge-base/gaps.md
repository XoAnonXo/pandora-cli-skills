---
title: Gaps and improvement backlog
type: surface
status: active
updated: 2026-06-03
source_paths:
  - cli/lib/mirror_sync_service.cjs
  - cli/lib/mirror_sync/gates.cjs
  - cli/lib/mirror_sync/execution.cjs
  - cli/lib/mirror_sync/hedge_retry.cjs
  - cli/lib/mirror_sync/hedge_gap_monitor.cjs
  - cli/lib/mirror_sync/auto_close.cjs
  - cli/lib/mirror_close_service.cjs
  - cli/lib/market_admin_service.cjs
  - cli/lib/model_diagnose_service.cjs
  - cli/lib/connectors/polymarket_connector.cjs
  - cli/lib/connectors/pandora_amm_connector.cjs
  - cli/lib/odds_history_service.cjs
  - cli/lib/arbitrage_service.cjs
  - cli/lib/watch_command_service.cjs
  - cli/lib/sports_sync_service.cjs
  - cli/lib/arb_command_service.cjs
  - docs/skills/trading-workflows.md
  - docs/skills/command-reference.md
  - package.json
tags:
  - gaps
  - market-maker-safety
  - data-pipeline
  - model-diagnose
  - trader-ux
  - operator-ux
---

# Gaps and Improvement Backlog

Things that need better tooling, data sources, or solutions before they become fully usable. Organized by priority.

---

## Priority: CRITICAL — Market-Maker Safety

These gaps can cause direct financial loss in the market-maker (mirror + hedge) operating model. Must be addressed before running live markets with real funds.

### 1. ~~No automatic liquidity withdrawal when a market ends~~ (ADDRESSED)

**Status:** Implemented via `--auto-withdraw-on-expiry` flag on `mirror sync`.

When `--auto-withdraw-on-expiry` is enabled, the daemon automatically calls `removeLiquidity` and stops itself when time-to-expiry drops below the configured lead time. The lead time is configurable per market type via `--auto-withdraw-lead-sec`:

The default lead time is chosen automatically based on market type (detected via `isSportsLikePolymarketSource`):

- **Sports markets:** 1800 sec (30 min) — safety buffer because match result becomes known before formal expiry
- **Regular markets:** 60 sec (1 min) — just enough for transaction confirmation; result is unknown until expiry, so no reason to withdraw earlier

Override with `--auto-withdraw-lead-sec <seconds>` for manual control. The auto-withdraw check is independent of the `MIN_TIME_TO_EXPIRY` gate (which controls when the daemon stops trading).

**What was added:**
- `cli/lib/mirror_sync/auto_close.cjs` — `runAutoClose()` function that withdraws all LP tokens
- `--auto-withdraw-on-expiry` flag in mirror sync flags parser (distinct from `mirror go --auto-close` which is lifecycle close after resolve)
- `--auto-withdraw-lead-sec <seconds>` — configurable lead time before expiry (default = `--min-time-to-close-sec` value)
- Auto-withdraw check in the daemon tick loop (fires before rebalance/hedge, one-shot via state flag)
- Webhook notification on auto-withdraw (success or failure with resume command)
- State persistence: `autoWithdrawTriggered`, `autoWithdrawResult`

**Remaining future work:**
- Auto-resolve + auto-claim after withdrawal (requires trusted result oracle)
- Real-time event result detection (WebSocket from live-scores API) for tighter withdrawal timing
- Gradual liquidity ramp-down approaching expiry

### 2. ~~Hedge failure leaves unprotected exposure~~ (ADDRESSED)

**Status:** Implemented via three-layered defense in `mirror sync`.

When a hedge order fails, the daemon now has automatic retry, monitoring, and emergency withdrawal capabilities:

**Layer 1 — Hedge retry with backoff (`cli/lib/mirror_sync/hedge_retry.cjs`):**
- `retryHedgeOrder()` wraps every `hedgeFn()` call inside `executeHedgeLeg`
- Exponential backoff: `delay × 2^attempt` (default: 2s → 4s → 8s)
- Only retries on transient failures (API errors, timeouts); validation errors propagate immediately
- Configurable: `--hedge-retry-count <N>` (default 3, 0 = disabled), `--hedge-retry-delay-ms <ms>` (default 2000)

**Layer 2 — Hedge gap alert webhook (`cli/lib/mirror_sync/hedge_gap_monitor.cjs`):**
- `evaluateHedgeGapAlert()` runs every tick after action processing
- Fires `mirror.sync.hedge-gap-alert` webhook when `|hedgeGapUsdc|` exceeds `--hedge-gap-alert-usdc` threshold
- Edge-triggered debounce: fires once when gap crosses threshold, resets when gap drops back
- Configurable: `--hedge-gap-alert-usdc <amount>` (default null = disabled)

**Layer 3 — Emergency LP withdrawal:**
- When `|hedgeGapUsdc|` exceeds `--hedge-gap-critical-usdc`, calls `runAutoClose()` with `trigger: 'hedge-gap'`
- Withdraws all LP tokens, fires `mirror.sync.emergency-withdraw` webhook, stops daemon
- One-shot guard via `state.emergencyWithdrawTriggered` (same pattern as auto-withdraw-on-expiry)
- Configurable: `--hedge-gap-critical-usdc <amount>` (default null = disabled)

**What was added:**
- `cli/lib/mirror_sync/hedge_retry.cjs` — retry wrapper with exponential backoff
- `cli/lib/mirror_sync/hedge_gap_monitor.cjs` — gap threshold evaluation + alert webhook
- Generalized `auto_close.cjs` to accept different trigger types (`expiry` / `hedge-gap`)
- 4 new CLI flags: `--hedge-retry-count`, `--hedge-retry-delay-ms`, `--hedge-gap-alert-usdc`, `--hedge-gap-critical-usdc`
- State fields: `hedgeGapAlertActive`, `emergencyWithdrawTriggered`, `emergencyWithdrawResult`
- 25 unit + integration tests in `tests/unit/mirror_hedge_safety.test.cjs`

**Conscious exclusions:**
- Pre-funding (hold YES+NO on Polymarket in advance) — excluded due to capital constraints
- Gas bump — not applicable, hedge orders are off-chain CLOB FAK orders
- Multi-host CLOB failover for order placement — reads support multi-host; order failover is a separate enhancement

### 3. ~~Slippage between Pandora rebalance and Polymarket hedge~~ (ADDRESSED)

**Status:** Implemented via post-fill slippage tracking, net P&L metrics, and slippage alerts.

**Original hypothesis was wrong:** The gap described "use real bid/ask instead of mid-prices for hedge sizing." Code analysis showed this was already the case — hedge sizing uses no Polymarket prices at all (pure reserve math), and `referencePrice` already prefers `bestAsk`/`bestBid`. FAK orders execute at market with no limit price.

**Real problems found and fixed:**

1. **No post-fill slippage tracking** — the CLOB response contains `takingAmount`/`makingAmount` (actual fill amounts) but `executeHedgeLeg` ignored them. Fixed: `extractHedgeFillData()` now parses fill data and computes `realizedSlippageUsdc = (fillPrice - referencePrice) × shares`.

2. **Hardcoded 0.3% fee approximation** — `cumulativeLpFeesApproxUsdc` used a hardcoded `0.003` multiplier. Fixed: `resolveFeeFraction()` reads `plan.reserveFeeTier` (e.g. 3000 = 0.3%), falls back to 0.003 if absent.

3. **No net P&L metric** — operator couldn't answer "Is this market-making profitable?" Fixed: `buildPnlMetrics()` exposes `netPnlApproxUsdc` and `netPnlStatus` (`profitable` / `net-negative`) in every tick snapshot.

4. **No slippage alert** — no alert when per-trade or cumulative slippage exceeds thresholds. Fixed: `evaluateSlippageAlert()` fires `mirror.sync.slippage-alert` on per-trade slippage exceeding threshold and `mirror.sync.net-negative-alert` when cumulative P&L goes negative (edge-triggered).

**What was added:**
- `extractHedgeFillData()` and `resolveFeeFraction()` in `execution.cjs`
- `evaluateSlippageAlert()` in `hedge_gap_monitor.cjs`
- `buildPnlMetrics()` in `planning.cjs` — P&L section in tick snapshots
- State field: `cumulativeHedgeSlippageRealizedUsdc`, `netNegativeAlertActive`
- CLI flag: `--hedge-slippage-alert-usdc <amount>` (default null = disabled)
- Fill data telemetry on `action.hedge.fill` and `action.hedge.realizedSlippageUsdc`

**Note:** CLOB fill data is best-effort telemetry (known phantom-fill issues). Position tracking uses `state.currentHedgeShares`, not fill responses.

---

## Priority: High

### 4. ~~Documentation does not separate trader vs operator roles~~ (ADDRESSED)

**Status:** Implemented via dedicated role guides and role map in command reference.

**What was added:**
- `docs/skills/trader-guide.md` — command map, canonical workflow, and examples for traders (discover, quote, trade, portfolio, claim)
- `docs/skills/operator-guide.md` — command map, workflows, and safety features for operators (deploy, mirror, hedge, resolve)
- Role map table in `command-reference.md` mapping every command family to its primary role
- "By Role" routing section in `capabilities.md` with trader/operator reading paths
- Updated README.md with separate trader/operator entry points in the map and human reading order

### 5. ~~Polymarket connector -- thin analytics surface~~ (ADDRESSED)

**Status:** Implemented — connector now exposes real order book, depth, volume, and trade history.

The Polymarket connector (`cli/lib/connectors/polymarket_connector.cjs`) was enriched from a thin mid-price surface to a full analytics connector:

**What was added:**

- `getBook(tokenId)` — real L2 order book from CLOB (`bids`, `asks`, `bestBid`, `bestAsk`, `midPrice`, `spreadBps`, `lastTradePrice`)
- `getDepth(yesTokenId, noTokenId)` — executable depth for both sides via `fetchDepthForMarket` (`depthWithinSlippageUsd`, `depthCoverage`, per-side depth with `midPrice`, `worstPrice`, `referencePrice`)
- `getPrice()` — enriched with `volumeUsd` and `liquidityUsd` from Gamma (previously stripped)
- `getTradeHistory(conditionId)` — recent fills from CLOB via `getMarketTradesEvents`
- `normalizeOrderbook` exported from `polymarket_trade_adapter.cjs` for reuse

**What this unblocks (not yet wired):**
- `spreadBps` and `depthCoverage` for `model diagnose` — data is now available via connector, auto-feed is a future step
- Enriched `odds record` with bid/ask and volume — data pipeline can now use the richer `getPrice` output
- Trade flow analysis via `getTradeHistory` for informed-flow metrics

### 6. No historical odds import + `odds record` is fragile

The only way to collect price history is to run `odds record` in real-time and wait. There is no way to import historical data retroactively. If a user wants to calibrate a model on 30 days of data, they needed to start recording 30 days ago.

**What is needed:** `odds import --source polymarket --market-id <id> --period 30d` — pull historical prices from blockchain events or Polymarket API.

**Impact:** `simulate mc` works out of the box (parameters are manual), but results are less accurate without calibrated drift/vol from real data. `model calibrate` works, but collecting data through `odds record` is inconvenient for several reasons beyond just waiting.

**Additional `odds record` limitations:**

| Problem | Detail |
|---|---|
| Process must stay alive | Synchronous loop with `sleepMs` — closing the terminal or losing connection stops recording. No background daemon, no auto-resume. |
| Only mid-prices | Records `yesPrice`, `noPrice`, `midPrice` from `getPrice()`. No bid/ask, no volume, no depth. Data is insufficient for `spreadBps` or `depthCoverage`. |
| No deduplication | Running `odds record` twice on the same market doubles the data. No uniqueness check on insert. |
| Query only by event-id | `odds history` requires `--event-id`. Cannot query "all markets" or "last 7 days" or filter by competition. |
| JSONL fallback is fragile | If SQLite is unavailable, falls back to plain JSONL file. Grows without bound, slow on large datasets, no indexing. |

---

## Priority: Medium

### 7. Watch cannot act on alerts

Watch detects problems (exposure over limit, price drop, market resolved) but can only send notifications. It cannot take even simple automatic actions.

**What could exist:**
- `--auto-claim-on-resolve` — claim winnings when a market resolves (safe, obvious)
- `--auto-sell-below <price>` — sell position if price drops below threshold (stop-loss)
- `--auto-sell-above <price>` — sell position if price rises above threshold (take-profit)

**Risk note:** auto-sell requires signing transactions, so this needs profile integration and explicit user opt-in.

### 8. No P&L tracking over time

`portfolio` shows a current snapshot. There is no history: "yesterday my portfolio was worth $500, today $480, this week -$120". No trend, no performance graph.

**What is needed:** `portfolio history --wallet 0x... --period 30d` — periodic snapshots stored locally, with summary and trend.

### 9. No backtesting framework

`simulate mc` projects forward from current state. There is no way to test a strategy against historical data: "If I had bought YES every time the price dropped below $0.30 last month, how much would I have made?"

**What is needed:** A backtest command that replays historical odds data through a strategy definition and reports simulated P&L.

### 10. No automated data pipeline for model inputs

The path from raw data to `model diagnose` is fully manual:

```text
1. Run `odds record` with interval and duration  (manual)
2. Run `model calibrate` on collected prices       (manual)
3. Run `model correlation` if multi-market          (manual)
4. Copy RMSE, drift, tail values from output        (manual)
5. Run `model diagnose` with those values           (manual)
```

An automated pipeline would collect prices on a schedule, run calibration and correlation automatically, feed results into diagnose, and emit a periodic health report.

### 11. No built-in provider presets for sports odds APIs

The sports infrastructure is well-developed internally:
- `sports_provider_registry` — universal HTTP client with primary/backup fallback, env-based config
- `sports_event_normalizer` — normalizes any API response into a unified format
- `sports_consensus_service` — aggregates quotes from multiple bookmakers via trimmed median, with tier-1 coverage policy and confidence classification (`high`/`normal`/`degraded`/`insufficient`)

What is **missing**: presets for concrete APIs. An operator must manually map env-variables (`SPORTSBOOK_PRIMARY_BASE_URL`, `..._API_KEY`, `..._COMPETITIONS_PATH`, etc.) to their chosen provider's endpoints and hope the response format is compatible with the normalizer.

**What could exist:** built-in presets like `--provider the-odds-api` that auto-configure base URL, auth method, and endpoint paths:

| Provider | What it offers | Accessibility |
|---|---|---|
| The Odds API | Odds from 20+ bookmakers, REST API | Free tier + paid |
| Betfair Exchange API | Real exchange odds | Account + API key |
| Sportradar | Professional sports data | Expensive, for business |

With a preset, setup reduces from ~10 env-variables to `--provider <name> --api-key <key>`.

### 12. No trader-focused quickstart

There is no "try in 5 minutes" path. A new user must understand setup, doctor, profiles, and policies before seeing a single market.

**What could exist:** `pandora quickstart --role trader` — shows 5 active markets, proposes a first quote, explains the result interactively.

---

## Priority: Low

### 13. Arbitrage has no atomic two-leg execution

`arb scan` finds cross-venue opportunities but execution is fully manual and split across two platforms. While the second leg is being executed on Polymarket, the spread can disappear. A failed second leg turns arbitrage into a speculative position.

**What could exist:** `arb execute --pair <id>` that executes the Pandora leg and provides timing guidance for the Polymarket leg. Full atomicity across venues is technically very hard (different protocols/chains).

### 14. No pipeline or chaining command

Each step is a separate command. Results must be manually passed between them. There is no way to say: "take arb scan results, filter by spread > 3%, quote each, show summary table".

**What could exist:** A pipeline syntax or a `pandora run-chain` command that connects steps.

### 15. `model diagnose` -- remaining missing data inputs

Beyond the Polymarket connector gap (item 5), three metrics remain hard to obtain:

| Metric | Problem | What is needed |
|---|---|---|
| `informedFlowRatio` | Impossible to determine reliably from public data alone. Requires trade-level flow classification (PIN/VPIN model). | Full trade history from blockchain + statistical model (Easley-O'Hara). Heavy lift. |
| `noiseRatio` | Inverse of `informedFlowRatio`. Same problem. | Same as above. |
| `manipulationAlerts` | No built-in manipulation detector. | Rule-based or statistical anomaly detector over trade flow (wash trading detection, volume spike analysis). |

These are academic-grade metrics. Reasonable to leave as defaults-only inputs for now.

### 16. `anomalyRate` helper

Can be computed from existing `odds record` history by counting outliers (>2-3 sigma from mean). Pandora does not automate this.

**What is needed:** A helper command or flag that reads odds history and emits anomaly rate, ready to feed into `model diagnose`.

---

## Summary

| # | Gap | Priority | Effort | Impact |
|---|---|---|---|---|
| 1 | ~~Auto-withdraw liquidity on event end~~ | **ADDRESSED** | — | `--auto-withdraw-on-expiry` flag implemented |
| 2 | ~~Hedge failure → unprotected exposure~~ | **ADDRESSED** | — | Three-layer defense: retry + alert + emergency withdrawal |
| 3 | ~~Slippage tracking (rebalance vs hedge)~~ | **ADDRESSED** | — | Post-fill tracking + net P&L + slippage alerts |
| 4 | ~~Trader vs operator docs~~ | **ADDRESSED** | — | Role guides + role map in command reference |
| 5 | ~~Polymarket connector analytics~~ | **ADDRESSED** | — | Real L2 book, depth, volume, trade history in connector |
| 6 | Historical odds import + odds record fragility | High | Medium | Calibrate needs convenient data; odds record is fragile |
| 7 | Watch auto-actions | Medium | Medium | Stop-loss and auto-claim |
| 8 | P&L tracking | Medium | Medium | Portfolio performance visibility |
| 9 | Backtesting | Medium | High | Strategy validation on historical data |
| 10 | Automated model pipeline | Medium | Medium | Removes manual copy-paste between commands |
| 11 | Sports odds provider presets | Medium | Low | Reduces setup from ~10 env-vars to one flag |
| 12 | Trader quickstart | Medium | Low | Lowers entry barrier |
| 13 | Atomic arb execution | Low | High | Reduces execution risk in arbitrage |
| 14 | Pipeline/chaining | Low | Medium | Convenience for power users |
| 15 | Academic diagnose metrics | Low | Very high | informedFlowRatio, noiseRatio, manipulationAlerts |
| 16 | anomalyRate helper | Low | Low | Quick win from existing data |

## TL;DR

1. ~~AMM не выводит ликвидность автоматически~~ — решено: флаг `--auto-withdraw-on-expiry` **(ADDRESSED)**
2. ~~Хедж может упасть, а позиция юзера на Pandora уже записана~~ — решено: retry + alert webhook + emergency withdrawal **(ADDRESSED)**
3. ~~Слипедж хеджа на Polymarket не отслеживается~~ — решено: трекинг fill-данных + net P&L + алерт на слипедж **(ADDRESSED)**
4. ~~Docs не разделяют трейдера и оператора~~ — решено: trader-guide.md + operator-guide.md + role map **(ADDRESSED)**
5. ~~Polymarket коннектор не даёт order book / spread / depth~~ — решено: getBook (L2), getDepth, getTradeHistory, volume/liquidity в getPrice **(ADDRESSED)**
6. Нет импорта исторических цен + `odds record` хрупкий (синхронный процесс, только mid-price, нет дедупликации) **(High)**
7. Watch видит проблемы, но не может действовать — нет stop-loss / auto-claim **(Medium)**
8. Нет истории P&L — только текущий снимок портфеля, без трендов **(Medium)**
9. Нет бэктестинга — нельзя проверить стратегию на прошлых данных **(Medium)**
10. Пайплайн odds → calibrate → diagnose полностью ручной **(Medium)**
11. sports sync имеет полную инфраструктуру (агрегатор, нормализатор, fallback), но нет пресетов для конкретных API **(Medium)**
12. Нет быстрого старта для трейдера — слишком долгий путь до первой сделки **(Medium)**
13. Арбитраж не атомарный — вторая нога может не пройти, и позиция становится спекулятивной **(Low)**
14. Нет пайплайна / цепочки команд — каждый шаг вручную **(Low)**
15. informedFlowRatio, noiseRatio, manipulationAlerts — академические метрики, требуют тяжёлой инфраструктуры **(Low)**
16. anomalyRate можно посчитать из существующих данных, но хелпера нет **(Low)**
