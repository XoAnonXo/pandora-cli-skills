# Mirror Hedge Sell Remediation Validation

This note records what changed after the OKC/BOS sell-failure audit, what we have now proved, and what still remains an operator assumption rather than a proven fact.

## Proven facts
- The hedge daemon already computes a single-sided net target correctly.
- The failure mode was not "the daemon wants both sides." The failure mode was "sell-side reduction got stuck while actual inventory was still dual-sided."
- Deferred sell queue entries could stay in state after the underlying sell exposure was no longer pending.
- `mirror hedge status` did not show sell retry counters, so operators could see queue size but not whether sells were being retried, blocked, or exchange-failed.
- Both-side actual inventory vs single-side target was not called out explicitly.
- Buy expansion safety existed in the runtime path, but there was no guardrail test proving that a blocked or failed sell prevented new opposite-side buys in the same cycle.

## Open assumptions
- Live sports orderbooks may still require wider sell-side slippage during volatile windows. We now document safe starting values, but the exact best setting is market-dependent.
- Exchange-side sell failures may come from multiple causes beyond shallow depth alone. The runtime now captures the exchange payload so future incidents can separate "no depth" from exchange rejects instead of guessing.
- Recovery speed for deferred sells will still depend on the next observed orderbook state. We now show that recovery is visible and measurable, not that every live sell will clear immediately.

## Remediation shipped
- Deferred hedge queue is now treated as live pending work, not append-only history.
- `mirror hedge status` now surfaces:
  - `sellRetryAttemptedCount`
  - `sellRetryBlockedCount`
  - `sellRetryFailedCount`
  - `sellRetryRecoveredCount`
  - `warningCount`
  - `BOTH_SIDE_INVENTORY_LOCKUP`
- Sell-side audit entries now include:
  - sell attempt records
  - depth snapshots
  - exchange error payloads for live execution failures
  - explicit `buy-phase-skipped` entries when sell reductions stop the cycle from buying the opposite side

## Replay validation
- Replay fixture: `tests/fixtures/mirror_hedge/okc-bos-sell-failure.json`
- Expected post-fix outcome from the fixture:
  - `sellRetryAttemptedCount = 1`
  - `sellRetryFailedCount = 1`
  - `sellRetryRecoveredCount = 1`
  - stale `sell-yes` deferred entry is pruned from live queue
  - buy phase is skipped while the `sell-no` reduction is still failed or pending
  - warning `BOTH_SIDE_INVENTORY_LOCKUP` is present

## Metrics to watch after ship
- `deferredHedgeCount`
- `sellRetryBlockedCount`
- `sellRetryFailedCount`
- `sellRetryRecoveredCount`
- `warningCount`
- `lastErrorCode`
