/**
 * Handle `mirror hedge-calc` command execution.
 * Resolves optional market context and emits hedge sizing diagnostics.
 * @param {{shared: object, context: object, deps: object}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleMirrorHedgeCalc({ shared, context, deps }) {
  const {
    CliError,
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    maybeLoadIndexerEnv,
    resolveIndexerUrl,
    parseMirrorHedgeCalcFlags,
    resolveTrustedDeployPair,
    verifyMirror,
    buildMirrorHedgeCalc,
    coerceMirrorServiceError,
    renderMirrorHedgeCalcTable,
  } = deps;

  if (includesHelpFlag(shared.rest)) {
    const usage =
      'pandora [--output table|json] mirror hedge-calc [--reserve-yes-usdc <n> --reserve-no-usdc <n>] [--excess-yes-usdc <n>] [--excess-no-usdc <n>] [--polymarket-yes-pct <0-100>] [--hedge-ratio <n>] [--hedge-cost-bps <n>] [--volume-scenarios <csv>] [--pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug>] [--trust-deploy] [--manifest-file <path>]';
    if (context.outputMode === 'json') {
      emitSuccess(context.outputMode, 'mirror.hedge-calc.help', commandHelpPayload(usage));
    } else {
      console.log(`Usage: ${usage}`);
    }
    return;
  }

  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const options = parseMirrorHedgeCalcFlags(shared.rest);

  let trustManifest = null;
  let trustDeploy = false;
  if (options.trustDeploy && options.pandoraMarketAddress && (options.polymarketMarketId || options.polymarketSlug)) {
    const trusted = resolveTrustedDeployPair(options);
    trustManifest = {
      filePath: trusted.manifestFile,
      pair: trusted.trustPair,
    };
    trustDeploy = true;
  }

  let verifyPayload = null;
  let reserveYesUsdc = options.reserveYesUsdc;
  let reserveNoUsdc = options.reserveNoUsdc;
  let polymarketYesPct = options.polymarketYesPct;

  if (options.pandoraMarketAddress && (options.polymarketMarketId || options.polymarketSlug)) {
    try {
      verifyPayload = await verifyMirror({
        indexerUrl,
        timeoutMs: shared.timeoutMs,
        pandoraMarketAddress: options.pandoraMarketAddress,
        polymarketMarketId: options.polymarketMarketId,
        polymarketSlug: options.polymarketSlug,
        polymarketHost: options.polymarketHost,
        polymarketGammaUrl: options.polymarketGammaUrl,
        polymarketGammaMockUrl: options.polymarketGammaMockUrl,
        polymarketMockUrl: options.polymarketMockUrl,
        trustDeploy,
        includeSimilarity: false,
        allowRuleMismatch: true,
      });
    } catch (err) {
      throw coerceMirrorServiceError(err, 'MIRROR_HEDGE_CALC_VERIFY_FAILED');
    }
    if (reserveYesUsdc === null && verifyPayload && verifyPayload.pandora) {
      reserveYesUsdc = Number(verifyPayload.pandora.reserveYes);
    }
    if (reserveNoUsdc === null && verifyPayload && verifyPayload.pandora) {
      reserveNoUsdc = Number(verifyPayload.pandora.reserveNo);
    }
    if (polymarketYesPct === null && verifyPayload && verifyPayload.sourceMarket) {
      polymarketYesPct = Number(verifyPayload.sourceMarket.yesPct);
    }
  }

  if (!Number.isFinite(Number(reserveYesUsdc)) || !Number.isFinite(Number(reserveNoUsdc))) {
    throw new CliError(
      'MISSING_REQUIRED_FLAG',
      'mirror hedge-calc could not resolve reserves. Provide --reserve-yes-usdc and --reserve-no-usdc or pass a resolvable market pair.',
    );
  }

  let payload;
  try {
    payload = buildMirrorHedgeCalc({
      ...options,
      reserveYesUsdc,
      reserveNoUsdc,
      polymarketYesPct,
    });
  } catch (err) {
    throw coerceMirrorServiceError(err, 'MIRROR_HEDGE_CALC_FAILED');
  }

  if (verifyPayload) {
    payload.verify = {
      gateResult: verifyPayload.gateResult,
      matchConfidence: verifyPayload.matchConfidence,
      pandoraMarketAddress: verifyPayload.pandora ? verifyPayload.pandora.marketAddress : null,
      sourceMarketId: verifyPayload.sourceMarket ? verifyPayload.sourceMarket.marketId : null,
    };
  }
  if (trustManifest) {
    payload.trustManifest = trustManifest;
  }

  emitSuccess(context.outputMode, 'mirror.hedge-calc', payload, renderMirrorHedgeCalcTable);
};
