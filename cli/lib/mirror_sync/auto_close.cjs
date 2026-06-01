const { round } = require('../shared/utils.cjs');

/**
 * Execute automatic liquidity withdrawal when MIN_TIME_TO_EXPIRY gate fails.
 *
 * Called once per daemon run when `--auto-withdraw-on-expiry` is enabled. Withdraws all LP
 * tokens from the Pandora AMM, records the result in state, and sends a webhook
 * notification so the operator knows what happened.
 *
 * @param {{
 *   options: object,
 *   state: object,
 *   tickAt: Date,
 *   runLp: Function,
 *   sendWebhook: Function|null,
 *   snapshotMetrics: object,
 *   minimumTimeToCloseSec: number,
 * }} params
 * @returns {Promise<object>}
 */
async function runAutoClose(params) {
  const { options, state, tickAt, runLp, sendWebhook, snapshotMetrics, minimumTimeToCloseSec } = params;

  const result = {
    status: 'pending',
    triggeredAt: tickAt.toISOString(),
    reason: 'MIN_TIME_TO_EXPIRY gate failed with --auto-withdraw-on-expiry enabled',
    timeToExpirySec: snapshotMetrics.pandoraTimeToExpirySec,
    minimumTimeToCloseSec,
    withdrawal: null,
    error: null,
    resumeCommand: null,
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

  state.autoWithdrawTriggered = true;
  state.autoWithdrawResult = result;

  if (sendWebhook) {
    try {
      await sendWebhook({
        event: 'mirror.sync.auto-withdraw',
        message: `[Pandora Mirror] Auto-withdraw ${result.status}. Time to expiry: ${round(result.timeToExpirySec, 0) ?? 'unknown'}s.`,
        payload: result,
      });
    } catch (_) {
      // Best-effort webhook; do not let delivery failure block the close flow.
    }
  }

  return result;
}

module.exports = { runAutoClose };
