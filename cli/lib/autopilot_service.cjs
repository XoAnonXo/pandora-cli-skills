const fs = require('fs');
const {
  AUTOPILOT_SCHEMA_VERSION,
  defaultStateFile,
  defaultKillSwitchFile,
  strategyHash,
  loadState,
  saveState,
  pruneIdempotencyKeys,
  resetDailyCountersIfNeeded,
} = require('./autopilot_state_store.cjs');

function toNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function sleepMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildIdempotencyKey(options, quote, nowMs) {
  const yesPct = toNumber(quote && quote.odds && quote.odds.yesPct);
  const bucketSize = Math.max(1_000, options.cooldownMs || 60_000);
  const bucket = Math.floor(nowMs / bucketSize);
  const trigger = options.triggerYesBelow !== null && options.triggerYesBelow !== undefined ? `below:${options.triggerYesBelow}` : `above:${options.triggerYesAbove}`;
  return [options.marketAddress.toLowerCase(), options.side, trigger, String(yesPct), String(bucket)].join('|');
}

function evaluateTrigger(options, quote) {
  const yesPct = toNumber(quote && quote.odds && quote.odds.yesPct);
  if (yesPct === null) {
    return {
      triggered: false,
      reason: 'yesPct unavailable in quote payload.',
      yesPct: null,
    };
  }

  if (options.triggerYesBelow !== null && yesPct < options.triggerYesBelow) {
    return {
      triggered: true,
      reason: `YES ${yesPct}% is below trigger ${options.triggerYesBelow}%`,
      yesPct,
      triggerCode: 'YES_BELOW_TRIGGER',
    };
  }

  if (options.triggerYesAbove !== null && yesPct > options.triggerYesAbove) {
    return {
      triggered: true,
      reason: `YES ${yesPct}% is above trigger ${options.triggerYesAbove}%`,
      yesPct,
      triggerCode: 'YES_ABOVE_TRIGGER',
    };
  }

  return {
    triggered: false,
    reason: 'Trigger thresholds not met.',
    yesPct,
  };
}

async function runAutopilot(options, deps) {
  const now = () => (typeof deps.now === 'function' ? deps.now() : new Date());

  const strategy = {
    mode: options.mode,
    marketAddress: options.marketAddress,
    side: options.side,
    amountUsdc: options.amountUsdc,
    triggerYesBelow: options.triggerYesBelow,
    triggerYesAbove: options.triggerYesAbove,
    executeLive: options.executeLive,
  };

  const hash = strategyHash(strategy);
  const stateFile = options.stateFile || defaultStateFile(strategy);
  const killSwitchFile = options.killSwitchFile || defaultKillSwitchFile();

  const loaded = loadState(stateFile, hash);
  const state = loaded.state;

  const snapshots = [];
  const actions = [];
  const webhookReports = [];

  let shouldStop = false;
  const handleStop = () => {
    shouldStop = true;
  };

  process.on('SIGINT', handleStop);
  process.on('SIGTERM', handleStop);

  const iterations = options.mode === 'once' ? 1 : (options.iterations || Number.POSITIVE_INFINITY);
  let iteration = 0;
  let stoppedReason = null;

  try {
    while (!shouldStop && iteration < iterations) {
      iteration += 1;
      const tickStart = now();

      if (killSwitchFile && fs.existsSync(killSwitchFile)) {
        stoppedReason = `Kill switch file detected at ${killSwitchFile}`;
        break;
      }

      resetDailyCountersIfNeeded(state, tickStart);

      const quote = await deps.quoteFn({
        marketAddress: options.marketAddress,
        side: options.side,
        amountUsdc: options.amountUsdc,
        yesPct: options.yesPct,
        slippageBps: options.slippageBps,
      });

      const trigger = evaluateTrigger(options, quote);
      const snapshot = {
        iteration,
        timestamp: tickStart.toISOString(),
        quote,
        trigger,
        action: null,
      };

      if (trigger.triggered) {
        const key = buildIdempotencyKey(options, quote, tickStart.getTime());
        if ((state.idempotencyKeys || []).includes(key)) {
          snapshot.action = {
            mode: options.executeLive ? 'live' : 'paper',
            status: 'skipped',
            reason: 'Duplicate trigger bucket (idempotency key already processed).',
            idempotencyKey: key,
          };
        } else if (state.tradesToday >= options.maxTradesPerDay) {
          snapshot.action = {
            mode: options.executeLive ? 'live' : 'paper',
            status: 'blocked',
            reason: `Daily trade cap reached (${options.maxTradesPerDay}).`,
          };
        } else if (state.dailySpendUsdc + options.amountUsdc > options.maxOpenExposureUsdc) {
          snapshot.action = {
            mode: options.executeLive ? 'live' : 'paper',
            status: 'blocked',
            reason: `Exposure cap exceeded: ${(state.dailySpendUsdc + options.amountUsdc).toFixed(2)} > ${options.maxOpenExposureUsdc}.`,
          };
        } else {
          if (options.executeLive) {
            const execution = await deps.executeFn({
              marketAddress: options.marketAddress,
              side: options.side,
              amountUsdc: options.amountUsdc,
              yesPct: trigger.yesPct,
              maxAmountUsdc: options.maxAmountUsdc,
              minProbabilityPct: options.minProbabilityPct,
              maxProbabilityPct: options.maxProbabilityPct,
            });

            snapshot.action = {
              mode: 'live',
              status: 'executed',
              idempotencyKey: key,
              execution,
            };
          } else {
            snapshot.action = {
              mode: 'paper',
              status: 'simulated',
              idempotencyKey: key,
              estimate: quote && quote.estimate ? quote.estimate : null,
              reason: trigger.reason,
            };
          }

          state.idempotencyKeys.push(key);
          pruneIdempotencyKeys(state);
          state.dailySpendUsdc = Number((state.dailySpendUsdc + options.amountUsdc).toFixed(6));
          state.tradesToday += 1;
          state.lastExecution = snapshot.action;
          actions.push(snapshot.action);

          if (typeof deps.sendWebhook === 'function') {
            const webhookReport = await deps.sendWebhook({
              event: 'autopilot.trigger',
              strategyHash: hash,
              iteration,
              alertMessage: trigger.reason,
              message: `[Pandora Autopilot] ${trigger.reason}`,
              quote,
              action: snapshot.action,
            });
            webhookReports.push(webhookReport);
          }
        }
      }

      state.lastTickAt = tickStart.toISOString();
      saveState(loaded.filePath, state);
      snapshots.push(snapshot);

      if (shouldStop) break;
      if (iteration >= iterations) break;
      await sleepMs(options.intervalMs);
    }
  } finally {
    process.off('SIGINT', handleStop);
    process.off('SIGTERM', handleStop);
    saveState(loaded.filePath, state);
  }

  if (!stoppedReason && shouldStop) {
    stoppedReason = 'Received termination signal.';
  }

  return {
    schemaVersion: AUTOPILOT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    strategyHash: hash,
    mode: options.mode,
    executeLive: options.executeLive,
    stateFile: loaded.filePath,
    killSwitchFile,
    iterationsRequested: Number.isFinite(iterations) ? iterations : null,
    iterationsCompleted: snapshots.length,
    stoppedReason,
    parameters: {
      marketAddress: options.marketAddress,
      side: options.side,
      amountUsdc: options.amountUsdc,
      triggerYesBelow: options.triggerYesBelow,
      triggerYesAbove: options.triggerYesAbove,
      intervalMs: options.intervalMs,
      cooldownMs: options.cooldownMs,
      maxAmountUsdc: options.maxAmountUsdc,
      maxOpenExposureUsdc: options.maxOpenExposureUsdc,
      maxTradesPerDay: options.maxTradesPerDay,
    },
    state,
    actionCount: actions.length,
    actions,
    snapshots,
    webhookReports,
  };
}

module.exports = {
  AUTOPILOT_SCHEMA_VERSION,
  runAutopilot,
};
