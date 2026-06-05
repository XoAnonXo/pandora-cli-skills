const { round } = require('../shared/utils.cjs');

/**
 * Execute automatic liquidity withdrawal.
 *
 * Triggered either when MIN_TIME_TO_EXPIRY gate fails (--auto-withdraw-on-expiry)
 * or when hedge gap exceeds a critical threshold (--hedge-gap-critical-usdc).
 * Withdraws all LP tokens from the Pandora AMM, records the result in state,
 * and sends a webhook notification so the operator knows what happened.
 *
 * @param {{
 *   options: object,
 *   state: object,
 *   tickAt: Date,
 *   runLp: Function,
 *   sendWebhook: Function|null,
 *   snapshotMetrics: object,
 *   minimumTimeToCloseSec: number,
 *   trigger?: string,
 *   webhookEvent?: string,
 *   triggerContext?: object,
 * }} params
 * @returns {Promise<object>}
 */
async function runAutoClose(params) {
  const { options, state, tickAt, runLp, sendWebhook, snapshotMetrics, minimumTimeToCloseSec } = params;
  const trigger = params.trigger || 'expiry';
  const webhookEvent = params.webhookEvent || 'mirror.sync.auto-withdraw';
  const triggerContext = params.triggerContext || {};

  const defaultReason = trigger === 'hedge-gap'
    ? 'Critical hedge gap exceeded threshold with --hedge-gap-critical-usdc enabled'
    : 'MIN_TIME_TO_EXPIRY gate failed with --auto-withdraw-on-expiry enabled';

  const result = {
    status: 'pending',
    trigger,
    triggeredAt: tickAt.toISOString(),
    reason: defaultReason,
    timeToExpirySec: snapshotMetrics.pandoraTimeToExpirySec,
    minimumTimeToCloseSec,
    withdrawal: null,
    error: null,
    resumeCommand: null,
    ...triggerContext,
  };

  const marketAddress = options.pandoraMarketAddress || null;

  try {
    const lpResult = await runLp({
      action: 'remove',
      marketAddress,
      lpAll: true,
      execute: Boolean(options.executeLive),
      privateKey: options.privateKey || null,
      profileId: options.profileId || null,
      profileFile: options.profileFile || null,
      chainId: options.chainId || null,
      rpcUrl: options.rpcUrl || null,
      deadlineSeconds: 300,
    });
    result.status = 'completed';
    result.withdrawal = {
      mode: lpResult.mode || null,
      status: lpResult.status || null,
      marketAddress: lpResult.marketAddress || marketAddress,
      lpTokens: lpResult.lpTokens || null,
      txHash: lpResult.tx && lpResult.tx.txHash ? lpResult.tx.txHash : null,
      txStatus: lpResult.tx && lpResult.tx.status ? lpResult.tx.status : null,
    };
  } catch (err) {
    result.status = 'failed';
    result.error = {
      code: (err && err.code) || 'AUTO_CLOSE_WITHDRAW_FAILED',
      message: (err && err.message) || String(err),
    };
    result.resumeCommand = marketAddress
      ? `pandora lp remove --market-address ${marketAddress} --all --execute`
      : 'pandora lp remove --all-markets --execute';
  }

  if (trigger === 'hedge-gap') {
    state.emergencyWithdrawTriggered = true;
    state.emergencyWithdrawResult = result;
  } else {
    state.autoWithdrawTriggered = true;
    state.autoWithdrawResult = result;
  }

  if (sendWebhook) {
    try {
      const timeInfo = result.timeToExpirySec !== null && result.timeToExpirySec !== undefined
        ? ` Time to expiry: ${round(result.timeToExpirySec, 0) ?? 'unknown'}s.`
        : '';
      await sendWebhook({
        event: webhookEvent,
        message: `[Pandora Mirror] Auto-withdraw ${result.status} (trigger: ${trigger}).${timeInfo}`,
        payload: result,
      });
    } catch (_) {
      // Best-effort webhook; do not let delivery failure block the close flow.
    }
  }

  return result;
}

module.exports = { runAutoClose };
