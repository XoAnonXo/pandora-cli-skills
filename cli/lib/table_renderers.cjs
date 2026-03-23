'use strict';

function createTableRenderers(deps = {}) {
  const short = deps.short;
  const formatTimestamp = deps.formatTimestamp;
  const formatUnixTimestampIfLikely = deps.formatUnixTimestampIfLikely;
  const printTable = deps.printTable;
  const printRecord = deps.printRecord;
  const formatNumericCell = deps.formatNumericCell;
  const formatOddsPercent = deps.formatOddsPercent;
  const buildMarketLiquidityMetrics = deps.buildMarketLiquidityMetrics;

function renderDoctorReportTable(report) {
  if (report.goal) {
    console.log(`Goal: ${report.goal}`);
  }
  if (report.env.usedEnvFile) {
    console.log(`Loaded env file: ${report.env.envFile}`);
  } else {
    console.log('Skipped env file loading (--skip-dotenv).');
  }

  const statusRows = [
    ['journey readiness', report.journeyReadiness && report.journeyReadiness.status ? report.journeyReadiness.status.toUpperCase() : 'N/A', report.journeyReadiness && report.journeyReadiness.note ? report.journeyReadiness.note : ''],
    ['required env', report.env.required.ok ? 'PASS' : 'FAIL', report.env.required.ok ? '' : report.env.required.missing.join(', ')],
    ['env validation', report.env.validation.ok ? 'PASS' : 'FAIL', report.env.validation.ok ? '' : `${report.env.validation.errors.length} issue(s)`],
    ['rpc reachability', report.rpc.ok ? 'PASS' : 'FAIL', report.rpc.ok ? `chainId=${report.rpc.chainId}` : report.rpc.error || 'Unavailable'],
  ];

  for (const check of report.codeChecks) {
    const status = check.ok ? 'PASS' : check.required ? 'FAIL' : 'WARN';
    const detail = check.ok ? `${check.codeByteLength} bytes` : check.error || 'No code';
    statusRows.push([`code:${check.key}`, status, detail]);
  }

  if (report.polymarket && report.polymarket.checked) {
    const host = report.polymarket.hostReachability || {};
    statusRows.push([
      'polymarket:host',
      host.ok ? 'PASS' : 'FAIL',
      host.ok ? `${report.polymarket.host} (${host.status})` : host.error || 'Unreachable',
    ]);
    const polyCheck = report.polymarket.check;
    statusRows.push([
      'polymarket:chain',
      polyCheck && polyCheck.chainOk && polyCheck.chainId === 137 ? 'PASS' : 'FAIL',
      polyCheck ? `chainId=${polyCheck.chainId} expected=137` : 'Unavailable',
    ]);
    statusRows.push([
      'polymarket:funder',
      polyCheck && polyCheck.ownership && polyCheck.ownership.funderCodePresent === true ? 'PASS' : 'FAIL',
      polyCheck && polyCheck.runtime ? polyCheck.runtime.funderAddress || 'missing' : 'Unavailable',
    ]);
    statusRows.push([
      'polymarket:ownership',
      polyCheck && polyCheck.ownership && polyCheck.ownership.ok ? 'PASS' : 'FAIL',
      polyCheck && polyCheck.ownership && polyCheck.ownership.ownerCheckError
        ? polyCheck.ownership.ownerCheckError
        : '',
    ]);
    statusRows.push([
      'polymarket:api-key',
      polyCheck && polyCheck.apiKeySanity && polyCheck.apiKeySanity.ok ? 'PASS' : 'FAIL',
      polyCheck && polyCheck.apiKeySanity ? polyCheck.apiKeySanity.status : 'Unavailable',
    ]);
  }

  printTable(['Check', 'Status', 'Details'], statusRows);

  if (report.summary.ok) {
    console.log('Doctor checks passed.');
  } else {
    console.log('Doctor checks failed.');
    if (Array.isArray(report.summary.failures) && report.summary.failures.length) {
      for (const failure of report.summary.failures) {
        console.log(`- ${failure}`);
      }
    }
  }

  if (report.polymarket && report.polymarket.checked && Array.isArray(report.polymarket.warnings) && report.polymarket.warnings.length) {
    console.log('Polymarket diagnostics:');
    for (const warning of report.polymarket.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function renderSetupTable(data) {
  const runtimeRows = [];
  if (data.runtimeInfo) {
    runtimeRows.push(['cwd', data.runtimeInfo.cwd || '']);
    runtimeRows.push(['env file', data.runtimeInfo.envFile || '']);
    runtimeRows.push(['example file', data.runtimeInfo.exampleFile || '']);
    runtimeRows.push(['interactive', data.runtimeInfo.interactive ? 'yes' : 'no']);
    runtimeRows.push(['goal', data.runtimeInfo.goal || data.goal || '']);
    runtimeRows.push(['node', data.runtimeInfo.nodeVersion || '']);
    runtimeRows.push(['platform', data.runtimeInfo.platform || '']);
  }

  if (runtimeRows.length) {
    printTable(['Runtime', 'Value'], runtimeRows);
  }

  printTable(
    ['Step', 'Status', 'Details'],
    [
      ['mode', String(data.mode || '').toUpperCase() || 'N/A', data.mode === 'manual' ? 'Manual scaffold' : 'Guided onboarding'],
      ['goal', data.goal || 'N/A', data.readiness && data.readiness.goal ? `readiness=${data.readiness.goal}` : ''],
      ['init-env', data.envStep.status.toUpperCase(), data.envStep.message || ''],
      ['doctor', data.doctor.summary.ok ? 'PASS' : 'FAIL', data.doctor.summary.ok ? 'All checks passed' : `${data.doctor.summary.errorCount} issue(s)`],
    ],
  );

  if (data.wizard && data.wizard.review && Array.isArray(data.wizard.review.entries) && data.wizard.review.entries.length) {
    printTable(
      ['Review', 'Value'],
      data.wizard.review.entries.map((entry) => [entry.key, entry.value]),
    );
  }

  renderDoctorReportTable(data.doctor);

  if (Array.isArray(data.wizard && data.wizard.notes) && data.wizard.notes.length) {
    console.log('Onboarding notes:');
    for (const note of data.wizard.notes) {
      console.log(`- ${note}`);
    }
  }

  if (data.cancelled) {
    console.log('Setup cancelled before write. No files were changed.');
  } else if (data.doctor.summary.ok) {
    console.log('Setup complete.');
  } else if (data.placeholderSignerGuidance && Array.isArray(data.guidedNextSteps) && data.guidedNextSteps.length) {
    console.log('Setup wrote a starter env and detected placeholder signer material. Next steps:');
    for (const step of data.guidedNextSteps) {
      console.log(`- ${step}`);
    }
  } else if (Array.isArray(data.guidedNextSteps) && data.guidedNextSteps.length) {
    console.log('Setup incomplete. Next steps:');
    for (const step of data.guidedNextSteps) {
      console.log(`- ${step}`);
    }
  } else {
    console.log('Setup incomplete. Resolve doctor failures and rerun `pandora setup`.');
  }
}

function renderSetupPlanTable(data) {
  const runtimeRows = [];
  if (data.runtimeInfo) {
    runtimeRows.push(['cwd', data.runtimeInfo.cwd || '']);
    runtimeRows.push(['env file', data.runtimeInfo.envFile || '']);
    runtimeRows.push(['goal', data.runtimeInfo.goal || data.goal || '']);
  }

  if (runtimeRows.length) {
    printTable(['Runtime', 'Value'], runtimeRows);
  }

  printTable(
    ['Plan', 'Value'],
    [
      ['mode', 'PLAN'],
      ['goal', data.goal || 'Choose a goal first'],
      ['env status', data.envStep && data.envStep.status ? data.envStep.status : ''],
      ['steps', data.plan && Array.isArray(data.plan.steps) ? String(data.plan.steps.length) : '0'],
    ],
  );

  if (data.plan && Array.isArray(data.plan.steps) && data.plan.steps.length) {
    printTable(
      ['Step', 'Purpose', 'Writes env'],
      data.plan.steps.map((step) => [
        step.id || '',
        step.title || '',
        Array.isArray(step.writesEnv) && step.writesEnv.length ? step.writesEnv.join(', ') : 'none',
      ]),
    );
  }

  if (Array.isArray(data.guidedNextSteps) && data.guidedNextSteps.length) {
    console.log('Next steps:');
    for (const step of data.guidedNextSteps) {
      console.log(`- ${step}`);
    }
  }
}

function renderMarketsListTable(data) {
  const hasOdds = Boolean(
    data.enrichment &&
    data.enrichment.withOdds &&
    Array.isArray(data.enrichedItems),
  );
  const tableItems = hasOdds ? data.enrichedItems : data.items;

  if (!tableItems.length) {
    console.log('No markets found.');
    return;
  }

  if (hasOdds) {
    printTable(
      ['ID', 'Type', 'Chain', 'Poll', 'Close', 'YES', 'NO', 'Diagnostic'],
      tableItems.map((item) => [
        short(item.id, 18),
        item.marketType || '',
        `${item.chainName || ''} (${item.chainId || ''})`,
        short(item.pollAddress, 18),
        formatTimestamp(item.marketCloseTimestamp),
        formatOddsPercent(item.odds && item.odds.yesProbability),
        formatOddsPercent(item.odds && item.odds.noProbability),
        short((item.odds && item.odds.diagnostic) || '', 44),
      ]),
    );
    return;
  }

  printTable(
    ['ID', 'Type', 'Chain', 'Poll', 'Close', 'Volume'],
    tableItems.map((item) => [
      short(item.id, 18),
      item.marketType || '',
      `${item.chainName || ''} (${item.chainId || ''})`,
      short(item.pollAddress, 18),
      formatTimestamp(item.marketCloseTimestamp),
      item.totalVolume || '',
    ]),
  );
}

function renderScanTable(data) {
  const items = Array.isArray(data.enrichedItems)
    ? data.enrichedItems
    : Array.isArray(data.items)
      ? data.items
      : [];
  if (!items.length) {
    console.log('No markets found.');
    return;
  }

  printTable(
    ['ID', 'Type', 'Question', 'YES', 'NO', 'Reserve YES', 'Reserve NO', 'Fee', 'Close', 'Category'],
    items.map((item) => {
      const liquidity = item && item.liquidity ? item.liquidity : buildMarketLiquidityMetrics(item || {});
      const poll = item && item.poll && typeof item.poll === 'object' ? item.poll : null;
      const category = poll && poll.category !== undefined ? poll.category : item.category;
      return [
        short(item.id, 18),
        item.marketType || '',
        short((poll && poll.question) || item.question || '', 44),
        formatOddsPercent(item.odds && item.odds.yesProbability),
        formatOddsPercent(item.odds && item.odds.noProbability),
        liquidity && liquidity.reserveYes !== null ? liquidity.reserveYes : '',
        liquidity && liquidity.reserveNo !== null ? liquidity.reserveNo : '',
        liquidity && liquidity.feePct !== null ? `${liquidity.feePct}%` : '',
        formatTimestamp(item.marketCloseTimestamp),
        category === null || category === undefined ? '' : category,
      ];
    }),
  );
}

function renderQuoteTable(data) {
  const odds = data.odds || {};
  const estimate = data.estimate || null;
  const liquidity = data.liquidity || null;
  const parimutuel = data.parimutuel || null;
  const targeting = data.targeting || null;
  const quoteMode = String(data && data.mode ? data.mode : 'buy').toLowerCase();
  printTable(
    ['Field', 'Value'],
    [
      ['marketAddress', data.marketAddress],
      ['marketType', data.marketType || ''],
      ['mode', quoteMode],
      ['side', data.side],
      ['amountUsdc', quoteMode === 'sell' ? 'n/a' : data.amountUsdc],
      ['sharesIn', quoteMode === 'sell' ? data.amount : 'n/a'],
      ['currentPct', targeting && targeting.currentPct !== null && targeting.currentPct !== undefined ? `${targeting.currentPct}%` : 'n/a'],
      ['targetPct', targeting && targeting.targetPct !== null && targeting.targetPct !== undefined ? `${targeting.targetPct}%` : 'n/a'],
      ['requiredSide', targeting && targeting.requiredSide ? targeting.requiredSide : 'n/a'],
      ['requiredAmountUsdc', targeting && targeting.requiredAmountUsdc !== null && targeting.requiredAmountUsdc !== undefined ? targeting.requiredAmountUsdc : 'n/a'],
      ['postTradePct', targeting && targeting.postTradePct !== null && targeting.postTradePct !== undefined ? `${targeting.postTradePct}%` : 'n/a'],
      ['oddsSource', odds.source || 'n/a'],
      ['yesPct', odds.yesPct === null || odds.yesPct === undefined ? 'n/a' : `${odds.yesPct}%`],
      ['noPct', odds.noPct === null || odds.noPct === undefined ? 'n/a' : `${odds.noPct}%`],
      ['quoteAvailable', data.quoteAvailable ? 'yes' : 'no'],
      ['estimatedShares', quoteMode === 'sell' ? 'n/a' : estimate ? estimate.estimatedShares : 'n/a'],
      ['minSharesOut', quoteMode === 'sell' ? 'n/a' : estimate ? estimate.minSharesOut : 'n/a'],
      ['estimatedUsdcOut', quoteMode === 'sell' && estimate ? estimate.estimatedUsdcOut : 'n/a'],
      ['minAmountOut', quoteMode === 'sell' && estimate ? estimate.minAmountOut : 'n/a'],
      ['grossUsdcOut', quoteMode === 'sell' && estimate ? estimate.grossUsdcOut : 'n/a'],
      ['feeAmount', quoteMode === 'sell' && estimate ? estimate.feeAmount : 'n/a'],
      ['potentialPayoutIfWin', quoteMode === 'sell' ? 'n/a' : estimate ? estimate.potentialPayoutIfWin : 'n/a'],
      ['potentialProfitIfWin', quoteMode === 'sell' ? 'n/a' : estimate ? estimate.potentialProfitIfWin : 'n/a'],
      ['reserveYes', liquidity && liquidity.reserveYes !== null ? liquidity.reserveYes : 'n/a'],
      ['reserveNo', liquidity && liquidity.reserveNo !== null ? liquidity.reserveNo : 'n/a'],
      ['kValue', liquidity && liquidity.kValue !== null ? liquidity.kValue : 'n/a'],
      ['diagnostic', Array.isArray(data.diagnostics) && data.diagnostics.length ? data.diagnostics.join(' | ') : odds.diagnostic || ''],
    ],
  );

  if (Array.isArray(data.curve) && data.curve.length > 1) {
    console.log('');
    if (quoteMode === 'sell') {
      printTable(
        ['Shares In', 'USDC Out', 'Eff. Price', 'Slippage %'],
        data.curve.map((row) => [
          row.amount === null || row.amount === undefined ? 'n/a' : row.amount,
          row.estimatedUsdcOut === null || row.estimatedUsdcOut === undefined ? 'n/a' : row.estimatedUsdcOut,
          row.effectivePrice === null ? 'n/a' : row.effectivePrice,
          row.slippagePct === null ? 'n/a' : row.slippagePct,
        ]),
      );
    } else {
      printTable(
        ['Amount USDC', 'Shares Out', 'Eff. Price', 'Slippage %', 'ROI if Win %'],
        data.curve.map((row) => [
          row.amountUsdc,
          row.estimatedShares === null ? 'n/a' : row.estimatedShares,
          row.effectivePrice === null ? 'n/a' : row.effectivePrice,
          row.slippagePct === null ? 'n/a' : row.slippagePct,
          row.roiIfWinPct === null ? 'n/a' : row.roiIfWinPct,
        ]),
      );
    }
  }

  if (parimutuel) {
    console.log('');
    printTable(
      ['Pari Field', 'Value'],
      [
        ['poolYes', parimutuel.poolYes],
        ['poolNo', parimutuel.poolNo],
        ['totalPool', parimutuel.totalPool],
        ['sharePct', parimutuel.sharePct],
        ['payoutIfWin', parimutuel.payoutIfWin],
        ['profitIfWin', parimutuel.profitIfWin],
        ['breakevenProbability', parimutuel.breakevenProbability],
      ],
    );
  }
}

function renderTradeTable(data) {
  const riskGuards = data.riskGuards || {};
  const rows = [
    ['mode', data.mode],
    ['action', data.action || 'buy'],
    ['marketAddress', data.marketAddress],
    ['side', data.side],
    ['amountUsdc', data.amountUsdc === null || data.amountUsdc === undefined ? '' : data.amountUsdc],
    ['shares', data.amount === null || data.amount === undefined ? '' : data.amount],
    [
      'selectedProbabilityPct',
      data.selectedProbabilityPct === null || data.selectedProbabilityPct === undefined
        ? 'n/a'
        : `${data.selectedProbabilityPct}%`,
    ],
    ['maxAmountUsdcGuard', riskGuards.maxAmountUsdc === null || riskGuards.maxAmountUsdc === undefined ? '' : riskGuards.maxAmountUsdc],
    [
      'probabilityRangeGuard',
      `${riskGuards.minProbabilityPct === null || riskGuards.minProbabilityPct === undefined
        ? '-inf'
        : `${riskGuards.minProbabilityPct}%`
      } .. ${riskGuards.maxProbabilityPct === null || riskGuards.maxProbabilityPct === undefined
        ? '+inf'
        : `${riskGuards.maxProbabilityPct}%`
      }`,
    ],
    ['quoteAvailable', data.quote && data.quote.quoteAvailable ? 'yes' : 'no'],
    ['account', data.account || ''],
    ['approvalAsset', data.approvalAsset || ''],
    ['approveTxHash', data.approveTxHash || ''],
    ['approveTxUrl', data.approveTxUrl || ''],
    ['approveGasEstimate', data.approveGasEstimate || ''],
    ['approveStatus', data.approveStatus || ''],
    ['tradeTxHash', data.tradeTxHash || ''],
    ['tradeTxUrl', data.tradeTxUrl || ''],
    ['tradeGasEstimate', data.tradeGasEstimate || ''],
    ['tradeStatus', data.tradeStatus || ''],
    ['buyTxHash', data.buyTxHash || ''],
    ['buyTxUrl', data.buyTxUrl || ''],
    ['buyGasEstimate', data.buyGasEstimate || ''],
    ['buyStatus', data.buyStatus || ''],
    ['sellTxHash', data.sellTxHash || ''],
    ['sellTxUrl', data.sellTxUrl || ''],
    ['sellGasEstimate', data.sellGasEstimate || ''],
    ['sellStatus', data.sellStatus || ''],
    ['finalStatus', data.finalStatus || ''],
    ['status', data.status || ''],
  ];
  printTable(['Field', 'Value'], rows);
}

function renderPollsListTable(data) {
  if (!data.items.length) {
    console.log('No polls found.');
    return;
  }

  printTable(
    ['ID', 'Status', 'Creator', 'Deadline', 'Question'],
    data.items.map((item) => [
      short(item.id, 18),
      item.status,
      short(item.creator, 16),
      formatUnixTimestampIfLikely(item.deadlineEpoch),
      short(item.question, 56),
    ]),
  );
}

function renderEventsListTable(data) {
  if (!data.items.length) {
    console.log('No events found.');
    return;
  }

  printTable(
    ['ID', 'Source', 'Chain', 'Time', 'Tx', 'Summary'],
    data.items.map((item) => [
      short(item.id, 20),
      item.source,
      item.chainId || '',
      formatTimestamp(item.timestamp || item.blockNumber),
      short(item.txHash, 18),
      short(item.eventType || item.eventName || item.amount || item.marketAddress || '', 42),
    ]),
  );
}

function renderPositionsListTable(data) {
  if (!data.items.length) {
    console.log('No positions found.');
    return;
  }

  printTable(
    ['ID', 'Wallet', 'Market', 'Last Trade', 'Chain'],
    data.items.map((item) => [
      short(item.id, 22),
      short(item.user, 18),
      short(item.marketAddress, 18),
      formatTimestamp(item.lastTradeAt),
      item.chainId,
    ]),
  );
}

function renderPortfolioTable(data) {
  const summaryRows = [
    ['wallet', data.wallet],
    ['chainIdFilter', data.chainId === null ? 'all' : data.chainId],
    ['positions', data.summary.positionCount],
    ['uniqueMarkets', data.summary.uniqueMarkets],
    ['liquidityAdded', data.summary.liquidityAdded],
    ['liquidityRemoved', data.summary.liquidityRemoved],
    ['netLiquidity', data.summary.netLiquidity],
    ['claims', data.summary.claims],
    ['cashflowNet', data.summary.cashflowNet],
    ['pnlProxy', data.summary.pnlProxy],
    ['totalDeposited', data.summary.totalDeposited === null ? '' : data.summary.totalDeposited],
    ['totalNetDelta', data.summary.totalNetDelta === null ? '' : data.summary.totalNetDelta],
    ['totalPositionMarkValueUsdc', data.summary.totalPositionMarkValueUsdc === null ? '' : data.summary.totalPositionMarkValueUsdc],
    ['totalUnrealizedPnl', data.summary.totalUnrealizedPnl === null ? '' : data.summary.totalUnrealizedPnl],
    ['eventsIncluded', data.summary.eventsIncluded ? 'yes' : 'no'],
    ['lpIncluded', data.summary.lpIncluded ? 'yes' : 'no'],
    ['lpPositionCount', data.summary.lpPositionCount === undefined ? '' : data.summary.lpPositionCount],
    ['lpMarketsWithBalance', data.summary.lpMarketsWithBalance === undefined ? '' : data.summary.lpMarketsWithBalance],
    ['lpEstimatedCollateralOutUsdc', data.summary.lpEstimatedCollateralOutUsdc === undefined ? '' : data.summary.lpEstimatedCollateralOutUsdc],
    ['diagnostic', data.summary.diagnostic || ''],
  ];

  printTable(['Field', 'Value'], summaryRows);

  if (Array.isArray(data.positions) && data.positions.length) {
    console.log('');
    printTable(
      ['Market', 'Question', 'Chain', 'Side', 'YES Bal', 'NO Bal', 'YES%', 'NO%', 'Mark (USDC)', 'Last Trade'],
      data.positions.map((item) => [
        short(item.marketAddress, 18),
        short(item.question || '', 38),
        item.chainId,
        item.positionSide || '',
        item.yesBalance === null || item.yesBalance === undefined ? '' : item.yesBalance,
        item.noBalance === null || item.noBalance === undefined ? '' : item.noBalance,
        item.odds && item.odds.yesPct !== null && item.odds.yesPct !== undefined ? `${item.odds.yesPct}%` : '',
        item.odds && item.odds.noPct !== null && item.odds.noPct !== undefined ? `${item.odds.noPct}%` : '',
        item.markValueUsdc === null || item.markValueUsdc === undefined ? '' : item.markValueUsdc,
        formatTimestamp(item.lastTradeAt),
      ]),
    );
  }

  if (Array.isArray(data.lpPositions) && data.lpPositions.length) {
    console.log('');
    printTable(
      ['LP Market', 'LP Tokens', 'Est. Collateral Out (USDC)', 'Diagnostics'],
      data.lpPositions.map((item) => [
        short(item.marketAddress, 18),
        item.lpTokenBalance || '',
        item.preview && item.preview.collateralOutUsdc ? item.preview.collateralOutUsdc : '',
        short(Array.isArray(item.diagnostics) ? item.diagnostics.join('; ') : '', 56),
      ]),
    );
  }
}

function renderWatchTable(data) {
  const rows = [
    ['iterationsRequested', data.iterationsRequested],
    ['snapshotsCaptured', data.count],
    ['alertsTriggered', data.alertCount || 0],
    ['wallet', data.parameters.wallet || ''],
    ['marketAddress', data.parameters.marketAddress || ''],
    ['side', data.parameters.side || ''],
    ['amountUsdc', data.parameters.amountUsdc || ''],
    ['intervalMs', data.intervalMs],
  ];
  printTable(['Field', 'Value'], rows);

  if (!Array.isArray(data.snapshots) || !data.snapshots.length) {
    return;
  }

  console.log('');
  printTable(
    ['Iter', 'Timestamp', 'NetLiquidity', 'Claims', 'QuoteAvail', 'YES%', 'NO%', 'Alerts'],
    data.snapshots.map((snapshot) => [
      snapshot.iteration,
      snapshot.timestamp,
      snapshot.portfolioSummary ? snapshot.portfolioSummary.netLiquidity : '',
      snapshot.portfolioSummary ? snapshot.portfolioSummary.claims : '',
      snapshot.quote ? (snapshot.quote.quoteAvailable ? 'yes' : 'no') : '',
      snapshot.quote && snapshot.quote.odds && snapshot.quote.odds.yesPct !== null ? snapshot.quote.odds.yesPct : '',
      snapshot.quote && snapshot.quote.odds && snapshot.quote.odds.noPct !== null ? snapshot.quote.odds.noPct : '',
      snapshot.alertCount || 0,
    ]),
  );

  if (Array.isArray(data.alerts) && data.alerts.length) {
    console.log('');
    for (const alert of data.alerts) {
      console.log(`ALERT [${alert.code}] iter=${alert.iteration}: ${alert.message}`);
    }
  }
}

function renderHistoryTable(data) {
  const summary = data.summary || {};
  printTable(
    ['Field', 'Value'],
    [
      ['wallet', data.wallet || ''],
      ['chainId', data.chainId === null || data.chainId === undefined ? 'all' : data.chainId],
      ['trades', summary.tradeCount || 0],
      ['open', summary.openCount || 0],
      ['won', summary.wonCount || 0],
      ['lost', summary.lostCount || 0],
      ['closedOther', summary.closedOtherCount || 0],
      ['grossVolumeUsdc', summary.grossVolumeUsdc === undefined ? '' : summary.grossVolumeUsdc],
      ['realizedPnlApproxUsdc', summary.realizedPnlApproxUsdc === undefined ? '' : summary.realizedPnlApproxUsdc],
      ['unrealizedPnlApproxUsdc', summary.unrealizedPnlApproxUsdc === undefined ? '' : summary.unrealizedPnlApproxUsdc],
    ],
  );

  if (!Array.isArray(data.items) || !data.items.length) {
    return;
  }

  console.log('');
  printTable(
    ['Time', 'Market', 'Side', 'Amount', 'Entry', 'Mark', 'P/L', 'Status'],
    data.items.map((item) => [
      formatTimestamp(item.timestamp),
      short(item.marketAddress, 18),
      item.side || '',
      formatNumericCell(item.collateralAmountUsdc, 2),
      formatNumericCell(item.entryPriceUsdcPerToken, 4),
      formatNumericCell(item.markPriceUsdcPerToken, 4),
      formatNumericCell(
        item.status === 'open' ? item.pnlUnrealizedApproxUsdc : item.pnlRealizedApproxUsdc,
        4,
      ),
      item.status || '',
    ]),
  );
}

function renderExportTable(data) {
  if (data.outPath) {
    printTable(
      ['Field', 'Value'],
      [
        ['format', data.format],
        ['wallet', data.wallet],
        ['chainId', data.chainId === null || data.chainId === undefined ? 'all' : data.chainId],
        ['count', data.count],
        ['outPath', data.outPath],
      ],
    );
    return;
  }

  if (typeof data.content === 'string') {
    console.log(data.content);
    return;
  }

  printTable(
    ['Field', 'Value'],
    [
      ['format', data.format],
      ['wallet', data.wallet],
      ['count', data.count],
    ],
  );
}

function renderArbitrageTable(data) {
  if (!Array.isArray(data.opportunities) || !data.opportunities.length) {
    console.log('No arbitrage opportunities found.');
    return;
  }

  printTable(
    ['Group', 'Spread YES', 'Spread NO', 'Confidence', 'Best YES', 'Best NO', 'Risk Flags'],
    data.opportunities.map((item) => [
      short(item.groupId, 20),
      formatNumericCell(item.spreadYesPct, 3),
      formatNumericCell(item.spreadNoPct, 3),
      formatNumericCell(item.confidenceScore, 3),
      item.bestYesBuy ? `${item.bestYesBuy.venue}:${short(item.bestYesBuy.marketId, 14)}` : '',
      item.bestNoBuy ? `${item.bestNoBuy.venue}:${short(item.bestNoBuy.marketId, 14)}` : '',
      Array.isArray(item.riskFlags) ? item.riskFlags.join(', ') : '',
    ]),
  );
}

function renderAutopilotTable(data) {
  printTable(
    ['Field', 'Value'],
    [
      ['mode', data.mode],
      ['executeLive', data.executeLive ? 'yes' : 'no'],
      ['hedgeEnabled', data.parameters && data.parameters.hedgeEnabled === false ? 'no' : 'yes'],
      ['hedgeRatio', data.parameters && data.parameters.hedgeRatio !== undefined ? data.parameters.hedgeRatio : ''],
      ['strategyHash', data.strategyHash],
      ['iterationsCompleted', data.iterationsCompleted],
      ['actionCount', data.actionCount],
      ['stateFile', data.stateFile],
      ['stoppedReason', data.stoppedReason || ''],
    ],
  );

  if (!Array.isArray(data.actions) || !data.actions.length) {
    return;
  }

  console.log('');
  printTable(
    ['Mode', 'Status', 'Reason', 'Execution'],
    data.actions.map((action) => [
      action.mode || '',
      action.status || '',
      short(action.reason || '', 56),
      short(action.execution && action.execution.buyTxHash ? action.execution.buyTxHash : '', 24),
    ]),
  );
}

function renderMirrorPlanTable(data) {
  const timing = data.timing || {};
  printTable(
    ['Field', 'Value'],
    [
      ['source', data.source || 'polymarket'],
      ['sourceMarketId', data.sourceMarket ? data.sourceMarket.marketId : ''],
      ['sourceSlug', data.sourceMarket ? data.sourceMarket.slug || '' : ''],
      ['sourceYesPct', data.sourceMarket && data.sourceMarket.yesPct !== null ? data.sourceMarket.yesPct : ''],
      ['sourceTimestampKind', timing.sourceTimestampKind || (data.sourceMarket ? data.sourceMarket.timestampSource || '' : '')],
      ['eventStartAt', timing.eventStartTimestampIso || ''],
      ['suggestedTargetAt', timing.suggestedTargetTimestampIso || ''],
      ['tradingCutoffAt', timing.tradingCutoffTimestampIso || ''],
      ['recommendedLiquidityUsdc', data.liquidityRecommendation ? data.liquidityRecommendation.liquidityUsdc : ''],
      ['distributionYes', data.distributionHint ? data.distributionHint.distributionYes : ''],
      ['distributionNo', data.distributionHint ? data.distributionHint.distributionNo : ''],
      ['planDigest', data.planDigest || ''],
    ],
  );

  if (data.match) {
    console.log('');
    printTable(
      ['Match Market', 'Similarity', 'Status', 'Question'],
      [[
        short(data.match.marketAddress, 20),
        data.match.similarity ? formatNumericCell(data.match.similarity.score, 4) : '',
        data.match.status === null || data.match.status === undefined ? '' : data.match.status,
        short(data.match.question || '', 72),
      ]],
    );
  }
}

function renderMirrorLpExplainTable(data) {
  const flow = data.flow || {};
  const minted = flow.mintedCompleteSets || {};
  const seeded = flow.seededPoolReserves || {};
  const excess = flow.returnedExcessTokens || {};
  const inventory = flow.totalLpInventory || {};

  printTable(
    ['Field', 'Value'],
    [
      ['liquidityUsdc', data.inputs ? data.inputs.liquidityUsdc : ''],
      ['sourceYesPct', data.inputs && data.inputs.sourceYesPct !== null ? data.inputs.sourceYesPct : ''],
      ['distributionYes', data.inputs ? data.inputs.distributionYes : ''],
      ['distributionNo', data.inputs ? data.inputs.distributionNo : ''],
      ['mintedYes', minted.yesTokens !== undefined ? minted.yesTokens : ''],
      ['mintedNo', minted.noTokens !== undefined ? minted.noTokens : ''],
      ['poolReserveYes', seeded.reserveYesUsdc !== undefined ? seeded.reserveYesUsdc : ''],
      ['poolReserveNo', seeded.reserveNoUsdc !== undefined ? seeded.reserveNoUsdc : ''],
      ['impliedPandoraYesPct', seeded.impliedPandoraYesPct !== undefined ? seeded.impliedPandoraYesPct : ''],
      ['returnedExcessYes', excess.excessYesUsdc !== undefined ? excess.excessYesUsdc : ''],
      ['returnedExcessNo', excess.excessNoUsdc !== undefined ? excess.excessNoUsdc : ''],
      ['totalYes', inventory.totalYesUsdc !== undefined ? inventory.totalYesUsdc : ''],
      ['totalNo', inventory.totalNoUsdc !== undefined ? inventory.totalNoUsdc : ''],
      ['inventoryDelta', inventory.deltaUsdc !== undefined ? inventory.deltaUsdc : ''],
      ['neutralCompleteSets', inventory.neutralCompleteSets ? 'yes' : 'no'],
    ],
  );
}

function renderMirrorHedgeCalcTable(data) {
  const metrics = data.metrics || {};
  printTable(
    ['Field', 'Value'],
    [
      ['reserveYesUsdc', metrics.reserveYesUsdc !== undefined ? metrics.reserveYesUsdc : ''],
      ['reserveNoUsdc', metrics.reserveNoUsdc !== undefined ? metrics.reserveNoUsdc : ''],
      ['excessYesUsdc', metrics.excessYesUsdc !== undefined ? metrics.excessYesUsdc : ''],
      ['excessNoUsdc', metrics.excessNoUsdc !== undefined ? metrics.excessNoUsdc : ''],
      ['deltaPoolUsdc', metrics.deltaPoolUsdc !== undefined ? metrics.deltaPoolUsdc : ''],
      ['deltaTotalUsdc', metrics.deltaTotalUsdc !== undefined ? metrics.deltaTotalUsdc : ''],
      ['targetHedgeUsdc', metrics.targetHedgeUsdcSigned !== undefined ? metrics.targetHedgeUsdcSigned : ''],
      ['hedgeToken', metrics.hedgeToken || ''],
      ['hedgeSharesApprox', metrics.hedgeSharesApprox !== undefined ? metrics.hedgeSharesApprox : ''],
      ['hedgeCostApproxUsdc', metrics.hedgeCostApproxUsdc !== undefined ? metrics.hedgeCostApproxUsdc : ''],
      ['breakEvenVolumeUsdc', metrics.breakEvenVolumeUsdc !== undefined ? metrics.breakEvenVolumeUsdc : ''],
    ],
  );

  if (!Array.isArray(data.scenarios) || !data.scenarios.length) return;
  console.log('');
  printTable(
    ['Volume', 'Fee Revenue', 'Hedge Cost', 'Net PnL Approx'],
    data.scenarios.map((row) => [
      row.volumeUsdc !== undefined ? row.volumeUsdc : '',
      row.feeRevenueUsdc !== undefined ? row.feeRevenueUsdc : '',
      row.hedgeCostApproxUsdc !== undefined ? row.hedgeCostApproxUsdc : '',
      row.netPnlApproxUsdc !== undefined ? row.netPnlApproxUsdc : '',
    ]),
  );
}

function renderMirrorSimulateTable(data) {
  const initial = data.initialState || {};
  const targeting = data.targeting || {};
  printTable(
    ['Field', 'Value'],
    [
      ['liquidityUsdc', data.inputs ? data.inputs.liquidityUsdc : ''],
      ['sourceYesPct', data.inputs && data.inputs.sourceYesPct !== null ? data.inputs.sourceYesPct : ''],
      ['targetYesPct', data.inputs && data.inputs.targetYesPct !== null ? data.inputs.targetYesPct : ''],
      ['tradeSide', data.inputs ? data.inputs.tradeSide : ''],
      ['initialReserveYes', initial.reserveYesUsdc !== undefined ? initial.reserveYesUsdc : ''],
      ['initialReserveNo', initial.reserveNoUsdc !== undefined ? initial.reserveNoUsdc : ''],
      ['initialYesPct', initial.initialYesPct !== undefined ? initial.initialYesPct : ''],
      ['volumeNeededToTarget', targeting.volumeNeededToTargetUsdc !== undefined ? targeting.volumeNeededToTargetUsdc : ''],
    ],
  );

  if (!Array.isArray(data.scenarios) || !data.scenarios.length) return;
  console.log('');
  printTable(
    ['Volume', 'Post YES%', 'Fees', 'Hedge', 'Hedge Cost', 'Net PnL Approx'],
    data.scenarios.map((row) => [
      row.volumeUsdc !== undefined ? row.volumeUsdc : '',
      row.postYesPct !== undefined ? row.postYesPct : '',
      row.feesEarnedUsdc !== undefined ? row.feesEarnedUsdc : '',
      row.hedge && row.hedge.hedgeToken
        ? `${row.hedge.hedgeToken}:${row.hedge.targetHedgeUsdc}`
        : '',
      row.hedge && row.hedge.hedgeCostApproxUsdc !== undefined ? row.hedge.hedgeCostApproxUsdc : '',
      row.netPnlApproxUsdc !== undefined ? row.netPnlApproxUsdc : '',
    ]),
  );
}

function renderMirrorBrowseTable(data) {
  if (!Array.isArray(data.items) || !data.items.length) {
    console.log('No mirrorable markets found for current filters.');
    if (data.gammaApiError) {
      console.log(`Gamma API error: ${data.gammaApiError}`);
    }
    if (Array.isArray(data.diagnostics) && data.diagnostics.length) {
      console.log('Diagnostics:');
      for (const diagnostic of data.diagnostics) {
        console.log(`- ${diagnostic}`);
      }
    }
    return;
  }

  printTable(
    ['Slug', 'YES%', '24h Vol', 'Close', 'Mirror', 'Question'],
    data.items.map((item) => [
      short(item.slug || item.marketId || '', 28),
      formatNumericCell(item.yesPct, 3),
      formatNumericCell(item.volume24hUsd, 2),
      formatTimestamp(item.closeTimestamp),
      item.existingMirror ? short(item.existingMirror.marketAddress, 14) : '',
      short(item.question || '', 72),
    ]),
  );

  if (Array.isArray(data.diagnostics) && data.diagnostics.length) {
    console.log('');
    console.log('Diagnostics:');
    for (const diagnostic of data.diagnostics) {
      console.log(`- ${diagnostic}`);
    }
  }
  if (data.gammaApiError) {
    console.log('');
    console.log(`Gamma API error: ${data.gammaApiError}`);
  }
}

function renderMirrorDeployTable(data) {
  printTable(
    ['Field', 'Value'],
    [
      ['dryRun', data.dryRun ? 'yes' : 'no'],
      ['planDigest', data.planDigest || ''],
      ['pollAddress', data.pandora && data.pandora.pollAddress ? data.pandora.pollAddress : ''],
      ['marketAddress', data.pandora && data.pandora.marketAddress ? data.pandora.marketAddress : ''],
      ['pollTxHash', data.tx && data.tx.pollTxHash ? data.tx.pollTxHash : ''],
      ['approveTxHash', data.tx && data.tx.approveTxHash ? data.tx.approveTxHash : ''],
      ['marketTxHash', data.tx && data.tx.marketTxHash ? data.tx.marketTxHash : ''],
      ['targetTimestamp', data.timing && data.timing.selectedTargetTimestampIso ? data.timing.selectedTargetTimestampIso : ''],
      ['tradingCutoffAt', data.timing && data.timing.tradingCutoffTimestampIso ? data.timing.tradingCutoffTimestampIso : ''],
      ['seedOddsMatch', data.postDeployChecks && data.postDeployChecks.seedOddsMatch !== null ? (data.postDeployChecks.seedOddsMatch ? 'yes' : 'no') : ''],
      ['seedDiffPct', data.postDeployChecks && data.postDeployChecks.diffPct !== null ? data.postDeployChecks.diffPct : ''],
      ['blockedLiveSync', data.postDeployChecks && data.postDeployChecks.blockedLiveSync ? 'yes' : 'no'],
      ['manifestFile', data.trustManifest && data.trustManifest.filePath ? data.trustManifest.filePath : ''],
      ['nativeRequired', data.preflight && data.preflight.nativeRequired ? data.preflight.nativeRequired : ''],
      ['usdcRequired', data.preflight && data.preflight.usdcRequired ? data.preflight.usdcRequired : ''],
    ],
  );
}

function renderMirrorVerifyTable(data) {
  printTable(
    ['Field', 'Value'],
    [
      ['matchConfidence', data.matchConfidence],
      ['gateOk', data.gateResult && data.gateResult.ok ? 'yes' : 'no'],
      ['failedChecks', data.gateResult && Array.isArray(data.gateResult.failedChecks) ? data.gateResult.failedChecks.join(', ') : ''],
      [
        'minTimeToExpirySec',
        data.expiry && data.expiry.minTimeToExpirySec !== null && data.expiry.minTimeToExpirySec !== undefined
          ? data.expiry.minTimeToExpirySec
          : '',
      ],
      ['expiryWarn', data.expiry && data.expiry.warn ? 'yes' : 'no'],
      ['pandoraMarket', data.pandora ? data.pandora.marketAddress : ''],
      ['sourceMarket', data.sourceMarket ? data.sourceMarket.marketId : ''],
      ['ruleHashLeft', data.ruleHashLeft || ''],
      ['ruleHashRight', data.ruleHashRight || ''],
      ['overlapRatio', data.ruleDiffSummary && data.ruleDiffSummary.overlapRatio !== null ? data.ruleDiffSummary.overlapRatio : ''],
    ],
  );
}

function renderMirrorSyncTable(data) {
  printTable(
    ['Field', 'Value'],
    [
      ['mode', data.mode],
      ['executeLive', data.executeLive ? 'yes' : 'no'],
      ['strategyHash', data.strategyHash],
      ['iterationsCompleted', data.iterationsCompleted],
      ['actionCount', data.actionCount],
      ['stateFile', data.stateFile],
      ['stoppedReason', data.stoppedReason || ''],
    ],
  );

  if (!Array.isArray(data.actions) || !data.actions.length) {
    return;
  }

  console.log('');
  printTable(
    ['Mode', 'Status', 'Rebalance', 'Hedge', 'Key'],
    data.actions.map((action) => [
      action.mode || '',
      action.status || '',
      action.rebalance ? `${action.rebalance.side}:${action.rebalance.amountUsdc}` : '',
      action.hedge ? `${short(action.hedge.tokenId, 14)}:${action.hedge.amountUsdc}` : '',
      short(action.idempotencyKey || '', 24),
    ]),
  );
}

function renderMirrorSyncDaemonTable(data) {
  const meta = data && data.metadata ? data.metadata : {};
  printTable(
    ['Field', 'Value'],
    [
      ['found', data && data.found === false ? 'no' : 'yes'],
      ['status', data && data.status ? data.status : ''],
      ['alive', data && data.alive ? 'yes' : 'no'],
      ['strategyHash', data && data.strategyHash ? data.strategyHash : meta.strategyHash || ''],
      ['pid', data && data.pid !== null && data.pid !== undefined ? data.pid : meta.pid || ''],
      ['pidFile', data && data.pidFile ? data.pidFile : meta.pidFile || ''],
      ['logFile', data && data.logFile ? data.logFile : meta.logFile || ''],
      ['startedAt', meta.startedAt || ''],
      ['checkedAt', meta.checkedAt || data.checkedAt || ''],
      ['stopSignalSent', data && Object.prototype.hasOwnProperty.call(data, 'signalSent') ? (data.signalSent ? 'yes' : 'no') : ''],
    ],
  );
}

function renderMirrorStatusTable(data) {
  const state = data.state || {};
  const runtime = data.runtime || {};
  const runtimeHealth = runtime.health || {};
  const daemon = runtime.daemon || {};
  const lastAction = runtime.lastAction || {};
  const lastError = runtime.lastError || {};
  printTable(
    ['Field', 'Value'],
    [
      ['strategyHash', data.strategyHash || state.strategyHash || ''],
      ['stateFile', data.stateFile || ''],
      ['lastTickAt', state.lastTickAt || ''],
      ['runtimeHealth', runtimeHealth.status || ''],
      ['daemonStatus', daemon.status || (daemon.found === false ? 'not-found' : '')],
      ['daemonPid', daemon.pid === undefined || daemon.pid === null ? '' : daemon.pid],
      ['dailySpendUsdc', state.dailySpendUsdc === undefined ? '' : state.dailySpendUsdc],
      ['tradesToday', state.tradesToday === undefined ? '' : state.tradesToday],
      ['currentHedgeUsdc', state.currentHedgeUsdc === undefined ? '' : state.currentHedgeUsdc],
      ['cumulativeLpFeesApproxUsdc', state.cumulativeLpFeesApproxUsdc === undefined ? '' : state.cumulativeLpFeesApproxUsdc],
      ['cumulativeHedgeCostApproxUsdc', state.cumulativeHedgeCostApproxUsdc === undefined ? '' : state.cumulativeHedgeCostApproxUsdc],
      ['idempotencyKeys', Array.isArray(state.idempotencyKeys) ? state.idempotencyKeys.length : 0],
    ],
  );

  if (data.runtime) {
    console.log('');
    printTable(
      ['Runtime Field', 'Value'],
      [
        ['healthStatus', runtimeHealth.status || ''],
        ['healthCode', runtimeHealth.code || ''],
        ['healthMessage', runtimeHealth.message || ''],
        ['lastTickAt', runtimeHealth.lastTickAt || ''],
        ['heartbeatAgeMs', runtimeHealth.heartbeatAgeMs === undefined || runtimeHealth.heartbeatAgeMs === null ? '' : runtimeHealth.heartbeatAgeMs],
        ['lastActionStatus', lastAction.status || ''],
        ['lastActionStartedAt', lastAction.startedAt || ''],
        ['lastActionCompletedAt', lastAction.completedAt || ''],
        ['lastErrorCode', lastError.code || ''],
        ['lastErrorAt', lastError.at || ''],
        ['daemonAlive', daemon.alive ? 'yes' : 'no'],
        ['daemonPidFile', daemon.pidFile || ''],
        ['daemonLogFile', daemon.logFile || ''],
      ],
    );
  }

  if (!data.live) {
    return;
  }

  console.log('');
  printTable(
    ['Live Field', 'Value'],
    [
      ['crossVenueStatus', data.live.crossVenue && data.live.crossVenue.status ? data.live.crossVenue.status : ''],
      ['pandoraYesPct', data.live.pandoraYesPct],
      ['sourceYesPct', data.live.sourceYesPct],
      ['driftBps', data.live.driftBps],
      ['driftTriggered', data.live.driftTriggered ? 'yes' : 'no'],
      ['hedgeGapUsdc', data.live.hedgeGapUsdc],
      ['hedgeTriggered', data.live.hedgeTriggered ? 'yes' : 'no'],
      ['lifecycleActive', data.live.lifecycleActive ? 'yes' : 'no'],
      ['minTimeToExpirySec', data.live.minTimeToExpirySec],
      ['netPnlApproxUsdc', data.live.netPnlApproxUsdc],
      ['netDeltaApprox', data.live.netDeltaApprox === undefined ? '' : data.live.netDeltaApprox],
      ['pnlApprox', data.live.pnlApprox === undefined ? '' : data.live.pnlApprox],
      ['recommendedAction', data.live.actionability && data.live.actionability.recommendedAction ? data.live.actionability.recommendedAction : ''],
      [
        'polymarketPosition',
        data.live.polymarketPosition
          ? `yes=${data.live.polymarketPosition.yesBalance ?? 'n/a'} no=${data.live.polymarketPosition.noBalance ?? 'n/a'} openOrders=${data.live.polymarketPosition.openOrdersCount ?? 'n/a'} openOrdersUsd=${data.live.polymarketPosition.openOrdersNotionalUsd ?? 'n/a'} estUsd=${data.live.polymarketPosition.estimatedValueUsd ?? 'n/a'}`
          : '',
      ],
    ],
  );

  if (data.live.crossVenue) {
    console.log('');
    printTable(
      ['Cross-Venue Field', 'Value'],
      [
        ['gateOk', data.live.crossVenue.gateOk ? 'yes' : 'no'],
        ['failedChecks', Array.isArray(data.live.crossVenue.failedChecks) ? data.live.crossVenue.failedChecks.join(', ') : ''],
        ['matchConfidence', data.live.crossVenue.matchConfidence === undefined ? '' : data.live.crossVenue.matchConfidence],
        ['ruleHashMatch', data.live.crossVenue.ruleHashMatch === null ? '' : data.live.crossVenue.ruleHashMatch ? 'yes' : 'no'],
        ['closeTimeDeltaSec', data.live.crossVenue.closeTimeDeltaSec === undefined ? '' : data.live.crossVenue.closeTimeDeltaSec],
        ['sourceType', data.live.crossVenue.sourceType || ''],
      ],
    );
  }

  if (data.live.actionableDiagnostics && data.live.actionableDiagnostics.length) {
    console.log('');
    printTable(
      ['Diagnostic', 'Severity', 'Action'],
      data.live.actionableDiagnostics.map((item) => [
        item.code || '',
        item.severity || '',
        item.action || '',
      ]),
    );
  }

  if (data.live.pnlScenarios && data.live.pnlScenarios.resolutionScenarios) {
    const resolution = data.live.pnlScenarios.resolutionScenarios;
    console.log('');
    printTable(
      ['Outcome', 'InventoryPayoutUsd', 'FeesPlusInventoryPnlApproxUsdc'],
      [
        [
          'yes',
          resolution.yes && resolution.yes.hedgeInventoryPayoutUsd !== undefined ? resolution.yes.hedgeInventoryPayoutUsd : '',
          resolution.yes && resolution.yes.feesPlusInventoryPnlApproxUsdc !== undefined ? resolution.yes.feesPlusInventoryPnlApproxUsdc : '',
        ],
        [
          'no',
          resolution.no && resolution.no.hedgeInventoryPayoutUsd !== undefined ? resolution.no.hedgeInventoryPayoutUsd : '',
          resolution.no && resolution.no.feesPlusInventoryPnlApproxUsdc !== undefined ? resolution.no.feesPlusInventoryPnlApproxUsdc : '',
        ],
      ],
    );
  }
}

function renderMirrorCloseTable(data) {
  const target = data && typeof data.target === 'object' && data.target ? data.target : {};
  printTable(
    ['Field', 'Value'],
    [
      ['mode', data.mode || ''],
      ['all', target.all ? 'yes' : 'no'],
      ['pandoraMarketAddress', target.pandoraMarketAddress || ''],
      ['polymarketMarketId', target.polymarketMarketId || ''],
      ['polymarketSlug', target.polymarketSlug || ''],
      ['successCount', data.summary && data.summary.successCount !== undefined ? data.summary.successCount : ''],
      ['failureCount', data.summary && data.summary.failureCount !== undefined ? data.summary.failureCount : ''],
    ],
  );

  if (!Array.isArray(data.steps) || !data.steps.length) {
    return;
  }

  console.log('');
  printTable(
    ['Step', 'Status', 'Error'],
    data.steps.map((step) => [
      step.step || '',
      step.ok ? 'ok' : 'failed',
      step.error && step.error.message ? step.error.message : '',
    ]),
  );
}

function renderMirrorGoTable(data) {
  const lifecycle = data.lifecycle || {};
  printTable(
    ['Field', 'Value'],
    [
      ['mode', data.mode || ''],
      ['planDigest', data.plan && data.plan.planDigest ? data.plan.planDigest : ''],
      ['deployedMarket', data.deploy && data.deploy.pandora ? data.deploy.pandora.marketAddress || '' : ''],
      ['verifyGateOk', data.verify && data.verify.gateResult ? (data.verify.gateResult.ok ? 'yes' : 'no') : ''],
      ['syncStarted', data.sync ? 'yes' : 'no'],
      ['lifecycleStatus', lifecycle.status || ''],
      ['suggestedLifecycleCommand', Array.isArray(lifecycle.suggestedResumeCommands) ? lifecycle.suggestedResumeCommands[0] || '' : ''],
      ['suggestedSyncCommand', data.suggestedSyncCommand || ''],
    ],
  );
}

function renderPolymarketCheckTable(data) {
  const runtime = data.runtime || {};
  const balance = data.balances && data.balances.usdc ? data.balances.usdc : {};
  const approvals = data.approvals || {};
  const apiSanity = data.apiKeySanity || {};

  printTable(
    ['Field', 'Value'],
    [
      ['readyForLive', data.readyForLive ? 'yes' : 'no'],
      ['chainId', data.chainId === null || data.chainId === undefined ? '' : data.chainId],
      ['signerAddress', runtime.signerAddress || ''],
      ['funderAddress', runtime.funderAddress || ''],
      ['ownerAddress', runtime.ownerAddress || ''],
      ['usdcBalance', balance.formatted || balance.raw || ''],
      ['missingApprovals', approvals.missingCount || 0],
      ['apiKeySanity', apiSanity.status || 'unknown'],
    ],
  );

  if (!Array.isArray(approvals.missingChecks) || !approvals.missingChecks.length) {
    return;
  }

  console.log('');
  printTable(
    ['Missing Check', 'Spender', 'Type'],
    approvals.missingChecks.map((item) => [item.key || '', short(item.spender || '', 20), item.type || '']),
  );
}

function renderPolymarketApproveTable(data) {
  const summary = data.approvalSummary || {};
  printTable(
    ['Field', 'Value'],
    [
      ['mode', data.mode || ''],
      ['status', data.status || ''],
      ['missingCount', summary.missingCount || 0],
      ['plannedTxCount', Array.isArray(data.txPlan) ? data.txPlan.length : 0],
      ['executedTxCount', data.executedCount || 0],
      ['signerMatchesOwner', data.signerMatchesOwner ? 'yes' : 'no'],
      ['manualProxyActionRequired', data.manualProxyActionRequired ? 'yes' : 'no'],
    ],
  );

  if (!Array.isArray(data.txReceipts) || !data.txReceipts.length) {
    return;
  }

  console.log('');
  printTable(
    ['Key', 'Tx Hash', 'Status'],
    data.txReceipts.map((item) => [item.key || '', short(item.txHash || '', 24), item.status || '']),
  );
}

function renderPolymarketPreflightTable(data) {
  printTable(
    ['Field', 'Value'],
    [
      ['ok', data.ok ? 'yes' : 'no'],
      ['failedChecks', Array.isArray(data.failedChecks) ? data.failedChecks.length : 0],
    ],
  );

  if (!Array.isArray(data.checks) || !data.checks.length) {
    return;
  }

  console.log('');
  printTable(
    ['Check', 'Status', 'Message'],
    data.checks.map((item) => [item.code || '', item.ok ? 'ok' : 'failed', item.message || '']),
  );
}

function renderWebhookTable(data) {
  printTable(
    ['Field', 'Value'],
    [
      ['targets', data.count || 0],
      ['successCount', data.successCount || 0],
      ['failureCount', data.failureCount || 0],
    ],
  );

  if (!Array.isArray(data.results) || !data.results.length) {
    return;
  }

  console.log('');
  printTable(
    ['Target', 'Status', 'Attempt', 'Detail'],
    data.results.map((item) => [
      item.target,
      item.ok ? 'ok' : 'failed',
      item.attempt,
      item.ok ? '' : short(item.error || '', 56),
    ]),
  );
}

function renderLeaderboardTable(data) {
  if (!Array.isArray(data.items) || !data.items.length) {
    console.log('No leaderboard rows found.');
    return;
  }

  printTable(
    ['Rank', 'Address', 'Profit', 'Volume', 'Trades', 'WinRate'],
    data.items.map((item) => [
      item.rank,
      short(item.address, 18),
      formatNumericCell(item.realizedPnl, 4),
      formatNumericCell(item.totalVolume, 4),
      item.totalTrades,
      `${formatNumericCell((item.winRate || 0) * 100, 2)}%`,
    ]),
  );
}

function renderAnalyzeTable(data) {
  const result = data.result || {};
  printTable(
    ['Field', 'Value'],
    [
      ['marketAddress', data.marketAddress || ''],
      ['provider', data.provider || ''],
      ['model', data.model || ''],
      ['marketYesPct', data.market && data.market.yesPct !== undefined ? data.market.yesPct : ''],
      ['fairYesPct', result.fairYesPct !== undefined ? result.fairYesPct : ''],
      ['confidence', result.confidence !== undefined ? result.confidence : ''],
      ['rationale', result.rationale || ''],
    ],
  );
}

function renderSuggestTable(data) {
  printTable(
    ['Field', 'Value'],
    [
      ['wallet', data.wallet || ''],
      ['risk', data.risk || ''],
      ['budget', data.budget],
      ['count', data.count],
    ],
  );

  if (!Array.isArray(data.items) || !data.items.length) {
    return;
  }

  console.log('');
  printTable(
    ['Rank', 'Venue', 'Market', 'Side', 'Amount', 'Edge', 'Confidence'],
    data.items.map((item) => [
      item.rank,
      item.venue || '',
      short(item.marketId, 16),
      item.side || '',
      formatNumericCell(item.amountUsdc, 2),
      `${formatNumericCell(item.expectedEdgePct, 2)}%`,
      formatNumericCell(item.confidenceScore, 3),
    ]),
  );
}

function renderRiskTable(data) {
  const panic = data && typeof data.panic === 'object' && data.panic ? data.panic : {};
  const guardrails = data && typeof data.guardrails === 'object' && data.guardrails ? data.guardrails : {};
  const counters = data && typeof data.counters === 'object' && data.counters ? data.counters : {};
  printTable(
    ['Field', 'Value'],
    [
      ['riskFile', data && data.riskFile ? data.riskFile : ''],
      ['action', data && data.action ? data.action : 'show'],
      ['changed', data && data.changed !== undefined ? String(Boolean(data.changed)) : ''],
      ['panic.active', String(Boolean(panic.active))],
      ['panic.reason', panic.reason || ''],
      ['panic.engagedAt', panic.engagedAt || ''],
      ['panic.engagedBy', panic.engagedBy || ''],
      ['guardrails.enabled', String(guardrails.enabled !== false)],
      [
        'guardrails.maxSingleLiveNotionalUsdc',
        guardrails.maxSingleLiveNotionalUsdc === null || guardrails.maxSingleLiveNotionalUsdc === undefined
          ? ''
          : String(guardrails.maxSingleLiveNotionalUsdc),
      ],
      [
        'guardrails.maxDailyLiveNotionalUsdc',
        guardrails.maxDailyLiveNotionalUsdc === null || guardrails.maxDailyLiveNotionalUsdc === undefined
          ? ''
          : String(guardrails.maxDailyLiveNotionalUsdc),
      ],
      [
        'guardrails.maxDailyLiveOps',
        guardrails.maxDailyLiveOps === null || guardrails.maxDailyLiveOps === undefined
          ? ''
          : String(guardrails.maxDailyLiveOps),
      ],
      ['guardrails.blockForkExecute', String(Boolean(guardrails.blockForkExecute))],
      ['counters.day', counters.day || ''],
      ['counters.liveOps', counters.liveOps === undefined ? '' : String(counters.liveOps)],
      ['counters.liveNotionalUsdc', counters.liveNotionalUsdc === undefined ? '' : String(counters.liveNotionalUsdc)],
    ],
  );
  if (Array.isArray(data && data.stopFiles) && data.stopFiles.length) {
    console.log('');
    printTable(
      ['Stop Files'],
      data.stopFiles.map((filePath) => [filePath]),
    );
  }
}

function renderSingleEntityTable(data) {
  if (data && typeof data.item === 'object' && data.item !== null) {
    printRecord(data.item);
    return;
  }
  if (Array.isArray(data && data.items)) {
    if (!data.items.length) {
      console.log('No items found.');
      return;
    }
    for (const item of data.items) {
      printRecord(item);
      console.log('');
    }
    return;
  }
  if (data && typeof data === 'object') {
    printRecord(data);
    return;
  }
  console.log(String(data));
}

function renderMarketsGetTable(data) {
  if (data.item) {
    renderSingleEntityTable(data);
    return;
  }

  if (!Array.isArray(data.items) || !data.items.length) {
    console.log('No markets found.');
    return;
  }

  printTable(
    ['ID', 'Type', 'Chain', 'Poll', 'Close', 'Volume'],
    data.items.map((item) => [
      short(item.id, 18),
      item.marketType || '',
      `${item.chainName || ''} (${item.chainId || ''})`,
      short(item.pollAddress, 18),
      formatTimestamp(item.marketCloseTimestamp),
      item.totalVolume || '',
    ]),
  );

  if (Array.isArray(data.missingIds) && data.missingIds.length) {
    console.log(`Missing IDs: ${data.missingIds.join(', ')}`);
  }
}

function renderMarketsMineTable(data) {
  const items = Array.isArray(data && data.items) ? data.items : [];
  printTable(
    ['Field', 'Value'],
    [
      ['wallet', data && data.wallet ? data.wallet : ''],
      ['walletSource', data && data.walletSource ? data.walletSource : ''],
      ['chainId', data && data.chainId !== undefined && data.chainId !== null ? data.chainId : ''],
      ['markets', Number.isInteger(data && data.count) ? data.count : 0],
      ['tokenMarkets', data && data.exposureCounts ? data.exposureCounts.token : 0],
      ['lpMarkets', data && data.exposureCounts ? data.exposureCounts.lp : 0],
      ['claimableMarkets', data && data.exposureCounts ? data.exposureCounts.claimable : 0],
      ['signerResolved', data && data.runtime && data.runtime.signerResolved ? 'yes' : 'no'],
    ],
  );

  if (!items.length) {
    console.log('');
    console.log('No owned market exposure found.');
    return;
  }

  console.log('');
  printTable(
    ['Market', 'Exposure', 'YES Bal', 'NO Bal', 'LP Tokens', 'Claimable USDC', 'Question'],
    items.map((item) => {
      const token = item && item.exposure ? item.exposure.token : null;
      const lp = item && item.exposure ? item.exposure.lp : null;
      const claimable = item && item.exposure ? item.exposure.claimable : null;
      return [
        short(item && item.marketAddress ? item.marketAddress : '', 18),
        Array.isArray(item && item.exposureTypes) ? item.exposureTypes.join(',') : '',
        token && token.yesBalance !== null && token.yesBalance !== undefined ? token.yesBalance : '',
        token && token.noBalance !== null && token.noBalance !== undefined ? token.noBalance : '',
        lp && lp.lpTokenBalance !== null && lp.lpTokenBalance !== undefined ? lp.lpTokenBalance : '',
        claimable && claimable.estimatedClaimUsdc !== null && claimable.estimatedClaimUsdc !== undefined
          ? claimable.estimatedClaimUsdc
          : claimable && claimable.marketClaimable
            ? 'yes'
            : '',
        short(item && item.question ? item.question : '', 44),
      ];
    }),
  );

  const diagnostics = Array.isArray(data && data.diagnostics) ? data.diagnostics.filter(Boolean) : [];
  if (diagnostics.length) {
    console.log('');
    console.log(`Diagnostics: ${diagnostics.join('; ')}`);
  }
}



  return {
    renderDoctorReportTable,
    renderSetupTable,
    renderSetupPlanTable,
    renderMarketsListTable,
    renderScanTable,
    renderQuoteTable,
    renderTradeTable,
    renderPollsListTable,
    renderEventsListTable,
    renderPositionsListTable,
    renderPortfolioTable,
    renderWatchTable,
    renderHistoryTable,
    renderExportTable,
    renderArbitrageTable,
    renderAutopilotTable,
    renderMirrorPlanTable,
    renderMirrorLpExplainTable,
    renderMirrorHedgeCalcTable,
    renderMirrorSimulateTable,
    renderMirrorBrowseTable,
    renderMirrorDeployTable,
    renderMirrorVerifyTable,
    renderMirrorSyncTable,
    renderMirrorSyncDaemonTable,
    renderMirrorStatusTable,
    renderMirrorCloseTable,
    renderMirrorGoTable,
    renderPolymarketCheckTable,
    renderPolymarketApproveTable,
    renderPolymarketPreflightTable,
    renderWebhookTable,
    renderLeaderboardTable,
    renderAnalyzeTable,
    renderSuggestTable,
    renderRiskTable,
    renderSingleEntityTable,
    renderMarketsGetTable,
    renderMarketsMineTable,
  };
}

module.exports = {
  createTableRenderers,
};
