---
title: Gaps and improvement backlog
type: surface
status: active
updated: 2026-06-02
source_paths:
  - cli/lib/mirror_sync_service.cjs
  - cli/lib/mirror_sync/gates.cjs
  - cli/lib/mirror_sync/execution.cjs
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

When `--auto-withdraw-on-expiry` is enabled, the daemon automatically calls `removeLiquidity` and stops itself the moment the `MIN_TIME_TO_EXPIRY` gate fires (default 30 minutes before market expiry). This eliminates the window where the AMM holds full liquidity after the daemon stops trading.

**What was added:**
- `cli/lib/mirror_sync/auto_close.cjs` — `runAutoClose()` function that withdraws all LP tokens
- `--auto-withdraw-on-expiry` flag in mirror sync flags parser (distinct from `mirror go --auto-close` which is lifecycle close after resolve)
- Auto-withdraw check in the daemon tick loop (fires before rebalance/hedge, one-shot via state flag)
- Webhook notification on auto-withdraw (success or failure with resume command)
- State persistence: `autoWithdrawTriggered`, `autoWithdrawResult`

**Remaining future work:**
- Auto-resolve + auto-claim after withdrawal (requires trusted result oracle)
- Real-time event result detection (WebSocket from live-scores API) for tighter withdrawal timing
- Gradual liquidity ramp-down approaching expiry

### 2. Hedge failure leaves unprotected exposure

When a user buys YES on Pandora, mirror sync attempts to hedge by buying YES on Polymarket. If the hedge fails (Polymarket API down, insufficient depth, transaction reverted, gas spike on Polygon), the operator holds an unhedged position — user has YES on Pandora, but operator has no matching YES on Polymarket.

**Current protection:** `DEPTH_COVERAGE` gate checks available depth before executing. `pendingActionLock` tracks in-flight operations. But:
- Depth can disappear between check and execution
- If the hedge transaction reverts, the Pandora side is already done (user already bought)
- There is no automatic retry with increased gas or alternative routing
- There is no alert when hedge gap exceeds a threshold

**What is needed:**
- Hedge gap monitoring with automatic alert when unhedged exposure > X USDC
- Auto-retry for failed hedge orders (with backoff and gas bump)
- Consider pre-funding: hold both YES and NO on Polymarket in advance, rebalance between them rather than buying on demand
- Kill switch that pauses liquidity provision (removeLiquidity) if hedge gap is critical

### 3. No `pause()` function in AMM contract

The Pandora AMM smart contract ABI currently only has `addLiquidity`, `removeLiquidity`, and `resolveMarket`. There is no `pause()` / `unpause()` mechanism to freeze trading in an emergency.

The only way to stop trading is to remove all liquidity (`removeLiquidity`), which is slow (requires a blockchain transaction) and cannot be instant. In a fast-moving situation (exploit, oracle failure, match result known), every second of delay means potential loss.

**What is needed:**
- A `pause()` function in the smart contract that the operator can call to freeze all buy/sell operations instantly
- Integration with mirror sync: when auto-pause triggers fire, also pause the AMM contract on-chain

**Note:** This requires a contract upgrade or redeployment, not just a CLI change.

### 4. Slippage between Pandora rebalance and Polymarket hedge

Mirror sync uses mid-prices from Polymarket (via `getPrice()`, not real order book data) to determine drift and rebalance size. The actual hedge buy on Polymarket happens at market price with slippage. If the spread is wide or depth is thin, the hedge costs more than the model calculated.

Over time, cumulative slippage can exceed the commission earned from the Pandora AMM fee tier.

**What is needed:**
- Use real bid/ask from CLOB API (already in dependencies) instead of mid-prices for hedge sizing
- Track cumulative slippage vs cumulative fees to detect when the operation is net-negative
- Alert when slippage per hedge exceeds a configurable threshold

---

## Priority: High

### 5. Documentation does not separate trader vs operator roles

All commands are documented in one stream. A new user cannot tell which commands are for trading (scan, quote, trade, arb scan, watch, claim) and which are for running markets (mirror, sports sync, hedge, lp, resolve). This causes confusion about the purpose of core features.

**What is needed:**
- Two clear sections in docs: "Trader Guide" and "Operator Guide"
- Separate workflow examples for each role
- Clear labeling on every command: who is the intended user

**Source of confusion:** mirror sync, sports sync, and hedge look like trader tools but are operator tools. arb scan and watch look like operator tools but are trader tools.

### 6. Polymarket connector -- thin analytics surface

The Polymarket connector (`cli/lib/connectors/polymarket_connector.cjs`) currently exposes:

- `getPrice()` — yes/no prices from gamma API
- `getBook()` — same data repackaged (not real order book)
- `placeTrade()` — not implemented in this module
- `cancelTrade()` — not implemented in this module
- `getPositions()` — position summary

`@polymarket/clob-client` is listed as a dependency (`^5.2.4` in `package.json`) but is only used for trade execution in the mirror/hedge path. It is not used for analytics.

Extending the Polymarket connector to fetch order book data and trade history would unblock:

- Real order book with bid/ask and depth → `spreadBps` for model diagnose
- Book depth → `depthCoverage` for model diagnose
- Trade history / recent fills
- Volume breakdown

**Impact:** One refactor closes half the gaps in `model diagnose` and makes arb scan more informed.

### 7. No historical odds import + `odds record` is fragile

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

### 8. Watch cannot act on alerts

Watch detects problems (exposure over limit, price drop, market resolved) but can only send notifications. It cannot take even simple automatic actions.

**What could exist:**
- `--auto-claim-on-resolve` — claim winnings when a market resolves (safe, obvious)
- `--auto-sell-below <price>` — sell position if price drops below threshold (stop-loss)
- `--auto-sell-above <price>` — sell position if price rises above threshold (take-profit)

**Risk note:** auto-sell requires signing transactions, so this needs profile integration and explicit user opt-in.

### 9. No P&L tracking over time

`portfolio` shows a current snapshot. There is no history: "yesterday my portfolio was worth $500, today $480, this week -$120". No trend, no performance graph.

**What is needed:** `portfolio history --wallet 0x... --period 30d` — periodic snapshots stored locally, with summary and trend.

### 10. No backtesting framework

`simulate mc` projects forward from current state. There is no way to test a strategy against historical data: "If I had bought YES every time the price dropped below $0.30 last month, how much would I have made?"

**What is needed:** A backtest command that replays historical odds data through a strategy definition and reports simulated P&L.

### 11. No automated data pipeline for model inputs

The path from raw data to `model diagnose` is fully manual:

```text
1. Run `odds record` with interval and duration  (manual)
2. Run `model calibrate` on collected prices       (manual)
3. Run `model correlation` if multi-market          (manual)
4. Copy RMSE, drift, tail values from output        (manual)
5. Run `model diagnose` with those values           (manual)
```

An automated pipeline would collect prices on a schedule, run calibration and correlation automatically, feed results into diagnose, and emit a periodic health report.

### 12. No built-in provider presets for sports odds APIs

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

### 13. No trader-focused quickstart

There is no "try in 5 minutes" path. A new user must understand setup, doctor, profiles, and policies before seeing a single market.

**What could exist:** `pandora quickstart --role trader` — shows 5 active markets, proposes a first quote, explains the result interactively.

---

## Priority: Low

### 14. Arbitrage has no atomic two-leg execution

`arb scan` finds cross-venue opportunities but execution is fully manual and split across two platforms. While the second leg is being executed on Polymarket, the spread can disappear. A failed second leg turns arbitrage into a speculative position.

**What could exist:** `arb execute --pair <id>` that executes the Pandora leg and provides timing guidance for the Polymarket leg. Full atomicity across venues is technically very hard (different protocols/chains).

### 15. No pipeline or chaining command

Each step is a separate command. Results must be manually passed between them. There is no way to say: "take arb scan results, filter by spread > 3%, quote each, show summary table".

**What could exist:** A pipeline syntax or a `pandora run-chain` command that connects steps.

### 16. `model diagnose` -- remaining missing data inputs

Beyond the Polymarket connector gap (item 2), three metrics remain hard to obtain:

| Metric | Problem | What is needed |
|---|---|---|
| `informedFlowRatio` | Impossible to determine reliably from public data alone. Requires trade-level flow classification (PIN/VPIN model). | Full trade history from blockchain + statistical model (Easley-O'Hara). Heavy lift. |
| `noiseRatio` | Inverse of `informedFlowRatio`. Same problem. | Same as above. |
| `manipulationAlerts` | No built-in manipulation detector. | Rule-based or statistical anomaly detector over trade flow (wash trading detection, volume spike analysis). |

These are academic-grade metrics. Reasonable to leave as defaults-only inputs for now.

### 17. `anomalyRate` helper

Can be computed from existing `odds record` history by counting outliers (>2-3 sigma from mean). Pandora does not automate this.

**What is needed:** A helper command or flag that reads odds history and emits anomaly rate, ready to feed into `model diagnose`.

---

## Summary

| # | Gap | Priority | Effort | Impact |
|---|---|---|---|---|
| 1 | ~~Auto-withdraw liquidity on event end~~ | **ADDRESSED** | — | `--auto-withdraw-on-expiry` flag implemented |
| 2 | Hedge failure → unprotected exposure | **CRITICAL** | High | Prevents unhedged losses |
| 3 | No pause() in AMM contract | **CRITICAL** | High (contract) | Emergency stop capability |
| 4 | Slippage tracking (rebalance vs hedge) | **CRITICAL** | Medium | Prevents silent net-negative operation |
| 5 | Trader vs operator docs | High | Low | Removes 80% of new-user confusion |
| 6 | Polymarket connector analytics | High | Medium | Unblocks spread, depth, trade history |
| 7 | Historical odds import + odds record fragility | High | Medium | Calibrate needs convenient data; odds record is fragile |
| 8 | Watch auto-actions | Medium | Medium | Stop-loss and auto-claim |
| 9 | P&L tracking | Medium | Medium | Portfolio performance visibility |
| 10 | Backtesting | Medium | High | Strategy validation on historical data |
| 11 | Automated model pipeline | Medium | Medium | Removes manual copy-paste between commands |
| 12 | Sports odds provider presets | Medium | Low | Reduces setup from ~10 env-vars to one flag |
| 13 | Trader quickstart | Medium | Low | Lowers entry barrier |
| 14 | Atomic arb execution | Low | High | Reduces execution risk in arbitrage |
| 15 | Pipeline/chaining | Low | Medium | Convenience for power users |
| 16 | Academic diagnose metrics | Low | Very high | informedFlowRatio, noiseRatio, manipulationAlerts |
| 17 | anomalyRate helper | Low | Low | Quick win from existing data |

## TL;DR

1. ~~AMM не выводит ликвидность автоматически~~ — решено: флаг `--auto-withdraw-on-expiry` **(ADDRESSED)**
2. Хедж может упасть, а позиция юзера на Pandora уже записана — оператор остаётся без защиты **(CRITICAL)**
3. В контракте AMM нет `pause()` — невозможно экстренно остановить торговлю **(CRITICAL)**
4. Слипедж хеджа на Polymarket не отслеживается — операция может быть убыточной и никто не узнает **(CRITICAL)**
5. Docs не разделяют трейдера и оператора — непонятно кому какие команды **(High)**
6. Polymarket коннектор не даёт order book / spread / depth — половина метрик diagnose недоступна **(High)**
7. Нет импорта исторических цен + `odds record` хрупкий (синхронный процесс, только mid-price, нет дедупликации) **(High)**
8. Watch видит проблемы, но не может действовать — нет stop-loss / auto-claim **(Medium)**
9. Нет истории P&L — только текущий снимок портфеля, без трендов **(Medium)**
10. Нет бэктестинга — нельзя проверить стратегию на прошлых данных **(Medium)**
11. Пайплайн odds → calibrate → diagnose полностью ручной **(Medium)**
12. sports sync имеет полную инфраструктуру (агрегатор, нормализатор, fallback), но нет пресетов для конкретных API **(Medium)**
13. Нет быстрого старта для трейдера — слишком долгий путь до первой сделки **(Medium)**
14. Арбитраж не атомарный — вторая нога может не пройти, и позиция становится спекулятивной **(Low)**
15. Нет пайплайна / цепочки команд — каждый шаг вручную **(Low)**
16. informedFlowRatio, noiseRatio, manipulationAlerts — академические метрики, требуют тяжёлой инфраструктуры **(Low)**
17. anomalyRate можно посчитать из существующих данных, но хелпера нет **(Low)**
