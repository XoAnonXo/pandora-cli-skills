/**
 * Handle `mirror verify` command execution.
 * Runs pair verification and emits similarity/rules/gate diagnostics.
 * @param {{shared: object, context: object, deps: object}} params
 * @returns {Promise<void>}
 */
module.exports = async function handleMirrorVerify({ shared, context, deps }) {
  const {
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    maybeLoadIndexerEnv,
    resolveIndexerUrl,
    parseMirrorVerifyFlags,
    resolveTrustedDeployPair,
    verifyMirror,
    coerceMirrorServiceError,
    renderMirrorVerifyTable,
  } = deps;

  if (includesHelpFlag(shared.rest)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'mirror.verify.help',
        commandHelpPayload(
          'pandora [--output table|json] mirror verify --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--trust-deploy] [--manifest-file <path>] [--include-similarity] [--with-rules] [--allow-rule-mismatch]',
        ),
      );
    } else {
      console.log(
        'Usage: pandora [--output table|json] mirror verify --pandora-market-address <address>|--market-address <address> --polymarket-market-id <id>|--polymarket-slug <slug> [--trust-deploy] [--manifest-file <path>] [--include-similarity] [--with-rules] [--allow-rule-mismatch]',
      );
    }
    return;
  }

  maybeLoadIndexerEnv(shared);
  const indexerUrl = resolveIndexerUrl(shared.indexerUrl);
  const options = parseMirrorVerifyFlags(shared.rest);
  let trustManifest = null;
  let trustDeploy = false;
  if (options.trustDeploy) {
    const trusted = resolveTrustedDeployPair(options);
    trustManifest = {
      filePath: trusted.manifestFile,
      pair: trusted.trustPair,
    };
    trustDeploy = true;
  }

  let payload;
  try {
    payload = await verifyMirror({
      ...options,
      trustDeploy,
      indexerUrl,
      timeoutMs: shared.timeoutMs,
    });
  } catch (err) {
    throw coerceMirrorServiceError(err, 'MIRROR_VERIFY_FAILED');
  }

  if (!options.withRules && payload && payload.pandora) {
    delete payload.pandora.rules;
    if (payload.sourceMarket) delete payload.sourceMarket.description;
  }
  if (trustManifest) {
    payload.trustManifest = trustManifest;
  }

  emitSuccess(context.outputMode, 'mirror.verify', payload, renderMirrorVerifyTable);
};
