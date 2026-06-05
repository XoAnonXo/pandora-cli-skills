const { round } = require('../shared/utils.cjs');

/**
 * Evaluate hedge gap against alert and critical thresholds.
 *
 * Fires a webhook alert when the absolute hedge gap first exceeds the alert threshold.
 * Resets when the gap drops back below threshold (edge-triggered, not level-triggered).
 *
 * @param {{
 *   hedgeGapUsdc: number|null,
 *   alertThresholdUsdc: number|null,
 *   criticalThresholdUsdc: number|null,
 *   state: object,
 *   currentHedgeUsdc: number,
 *   targetHedgeUsdc: number|null,
 *   sendWebhook: Function|null,
 *   strategyHash: string|null,
 * }} params
 * @returns {Promise<{alertFired: boolean, criticalTriggered: boolean}>}
 */
async function evaluateHedgeGapAlert(params) {
  const {
    hedgeGapUsdc,
    alertThresholdUsdc,
    criticalThresholdUsdc,
    state,
    currentHedgeUsdc,
    targetHedgeUsdc,
    sendWebhook,
    strategyHash,
  } = params;

  const result = { alertFired: false, criticalTriggered: false };

  if (hedgeGapUsdc === null || hedgeGapUsdc === undefined) return result;

  const absGap = Math.abs(hedgeGapUsdc);

  if (Number.isFinite(alertThresholdUsdc) && alertThresholdUsdc > 0) {
    if (absGap >= alertThresholdUsdc) {
      if (!state.hedgeGapAlertActive) {
        state.hedgeGapAlertActive = true;
        result.alertFired = true;

        if (sendWebhook) {
          try {
            await sendWebhook({
              event: 'mirror.sync.hedge-gap-alert',
              message: `[Pandora Mirror] Hedge gap alert: unhedged exposure ${round(absGap, 2)} USDC (threshold: ${alertThresholdUsdc} USDC)`,
              payload: {
                hedgeGapUsdc: round(hedgeGapUsdc, 6),
                absHedgeGapUsdc: round(absGap, 6),
                alertThresholdUsdc,
                currentHedgeUsdc: round(currentHedgeUsdc, 6),
                targetHedgeUsdc: targetHedgeUsdc !== null ? round(targetHedgeUsdc, 6) : null,
                strategyHash,
                suggestedAction: strategyHash
                  ? `pandora mirror sync unlock --strategy-hash ${strategyHash}`
                  : 'pandora mirror sync unlock',
              },
            });
          } catch (_) {
            // Best-effort webhook
          }
        }
      }
    } else if (state.hedgeGapAlertActive) {
      state.hedgeGapAlertActive = false;
    }
  }

  if (Number.isFinite(criticalThresholdUsdc) && criticalThresholdUsdc > 0) {
    if (absGap >= criticalThresholdUsdc && !state.emergencyWithdrawTriggered) {
      result.criticalTriggered = true;
    }
  }

  return result;
}

/**
 * Evaluate per-trade slippage and net P&L for alert thresholds.
 *
 * Fires a webhook when per-trade realized slippage exceeds the configured threshold,
 * or when cumulative net P&L goes negative (edge-triggered).
 *
 * @param {{
 *   realizedSlippageUsdc: number|null,
 *   slippageAlertThresholdUsdc: number|null,
 *   state: object,
 *   netPnlApproxUsdc: number|null,
 *   sendWebhook: Function|null,
 *   strategyHash: string|null,
 * }} params
 * @returns {Promise<{slippageAlertFired: boolean, netNegativeAlertFired: boolean}>}
 */
async function evaluateSlippageAlert(params) {
  const {
    realizedSlippageUsdc,
    slippageAlertThresholdUsdc,
    state,
    netPnlApproxUsdc,
    sendWebhook,
    strategyHash,
  } = params;

  const result = { slippageAlertFired: false, netNegativeAlertFired: false };

  if (
    Number.isFinite(slippageAlertThresholdUsdc) && slippageAlertThresholdUsdc > 0
    && Number.isFinite(realizedSlippageUsdc) && realizedSlippageUsdc >= slippageAlertThresholdUsdc
  ) {
    result.slippageAlertFired = true;
    if (sendWebhook) {
      try {
        await sendWebhook({
          event: 'mirror.sync.slippage-alert',
          message: `[Pandora Mirror] Slippage alert: ${round(realizedSlippageUsdc, 4)} USDC on last hedge (threshold: ${slippageAlertThresholdUsdc} USDC)`,
          payload: {
            realizedSlippageUsdc: round(realizedSlippageUsdc, 6),
            slippageAlertThresholdUsdc,
            strategyHash,
          },
        });
      } catch (_) {
        // Best-effort webhook
      }
    }
  }

  if (Number.isFinite(netPnlApproxUsdc) && netPnlApproxUsdc < 0) {
    if (!state.netNegativeAlertActive) {
      state.netNegativeAlertActive = true;
      result.netNegativeAlertFired = true;
      if (sendWebhook) {
        try {
          await sendWebhook({
            event: 'mirror.sync.net-negative-alert',
            message: `[Pandora Mirror] Net P&L is negative: ${round(netPnlApproxUsdc, 4)} USDC. Slippage exceeds earned fees.`,
            payload: {
              netPnlApproxUsdc: round(netPnlApproxUsdc, 6),
              cumulativeLpFeesApproxUsdc: round(state.cumulativeLpFeesApproxUsdc, 6),
              cumulativeHedgeCostApproxUsdc: round(state.cumulativeHedgeCostApproxUsdc, 6),
              strategyHash,
            },
          });
        } catch (_) {
          // Best-effort webhook
        }
      }
    }
  } else if (state.netNegativeAlertActive) {
    state.netNegativeAlertActive = false;
  }

  return result;
}

module.exports = { evaluateHedgeGapAlert, evaluateSlippageAlert };
