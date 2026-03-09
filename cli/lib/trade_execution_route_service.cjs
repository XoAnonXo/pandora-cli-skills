'use strict';

function createRouteError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details && typeof details === 'object') {
    error.details = details;
  }
  return error;
}

function coerceRouteError(error, fallbackCode, fallbackMessage, details = {}, errorFactory = createRouteError) {
  if (error && error.code && error.message) {
    error.details = {
      ...(error.details && typeof error.details === 'object' ? error.details : {}),
      ...details,
    };
    return error;
  }
  return errorFactory(
    fallbackCode,
    error && error.message ? error.message : fallbackMessage,
    {
      ...details,
      ...(error && error.details && typeof error.details === 'object' ? error.details : {}),
    },
  );
}

function resolveTradeExecutionRoute(requestedRoute, needsApproval) {
  return requestedRoute === 'auto'
    ? needsApproval
      ? 'flashbots-bundle'
      : 'flashbots-private'
    : requestedRoute;
}

function hasSubmittedFlashbotsContext(error) {
  const details = error && error.details && typeof error.details === 'object' ? error.details : {};
  if (details.submissionState === 'submitted') return true;
  if (typeof details.transactionHash === 'string' && details.transactionHash) return true;
  if (typeof details.tradeTxHash === 'string' && details.tradeTxHash) return true;
  if (Array.isArray(details.transactionHashes) && details.transactionHashes.length > 0) return true;
  if (typeof details.bundleHash === 'string' && details.bundleHash) return true;
  return false;
}

async function executeTradeWithRoute(options = {}) {
  const requestedExecutionRoute = String(options.requestedExecutionRoute || 'public');
  const resolvedExecutionRoute = resolveTradeExecutionRoute(requestedExecutionRoute, Boolean(options.needsApproval));
  const runtime = options.runtime && typeof options.runtime === 'object' ? options.runtime : {};
  const errorFactory = typeof options.errorFactory === 'function' ? options.errorFactory : createRouteError;
  const canFallbackToPublic = requestedExecutionRoute !== 'public' && runtime.executionRouteFallback === 'public';
  const flashbotsSupportedChainId = Number.isInteger(options.flashbotsSupportedChainId)
    ? options.flashbotsSupportedChainId
    : 1;

  const buildDetails = (extra = {}) => ({
    requestedRoute: requestedExecutionRoute,
    resolvedRoute: resolvedExecutionRoute,
    executionRouteFallback: runtime.executionRouteFallback || null,
    chainId: runtime.chainId,
    mode: runtime.mode || null,
    flashbotsRelayUrl: runtime.flashbotsRelayUrl || null,
    ...extra,
  });

  if (resolvedExecutionRoute === 'public') {
    return options.executePublicRoute(
      options.buildRouteMetadata
        ? options.buildRouteMetadata({ executionRouteResolved: 'public' })
        : undefined,
    );
  }

  const runFlashbotsRoute = async () => {
    if (runtime.chainId !== flashbotsSupportedChainId) {
      throw errorFactory(
        'FLASHBOTS_UNSUPPORTED_CHAIN',
        `Flashbots private routing is only supported on Ethereum mainnet (chain ${flashbotsSupportedChainId}).`,
        buildDetails(),
      );
    }
    if (runtime.mode !== 'live') {
      throw errorFactory(
        'FLASHBOTS_UNSUPPORTED_RUNTIME',
        'Flashbots private routing is only supported for live Ethereum execution, not fork mode.',
        buildDetails(),
      );
    }
    if (!runtime.flashbotsAuthKey) {
      throw errorFactory(
        'FLASHBOTS_AUTH_KEY_REQUIRED',
        'Flashbots private routing requires --flashbots-auth-key or FLASHBOTS_AUTH_KEY.',
        buildDetails(),
      );
    }
    if (resolvedExecutionRoute === 'flashbots-private') {
      if (options.needsApproval) {
        throw errorFactory(
          'FLASHBOTS_BUNDLE_REQUIRED',
          'Flashbots private transaction routing cannot include an approval; use auto or flashbots-bundle.',
          buildDetails(),
        );
      }
      return options.executeFlashbotsPrivateRoute();
    }
    return options.executeFlashbotsBundleRoute();
  };

  try {
    return await runFlashbotsRoute();
  } catch (error) {
    const routeError = coerceRouteError(
      error,
      'FLASHBOTS_ROUTE_FAILED',
      'Flashbots private routing failed.',
      buildDetails(),
      errorFactory,
    );
    if (!canFallbackToPublic || hasSubmittedFlashbotsContext(routeError)) {
      throw routeError;
    }
    return options.executePublicRoute(
      options.buildRouteMetadata
        ? options.buildRouteMetadata({
            executionRouteResolved: 'public',
            executionRouteFallbackUsed: true,
            executionRouteFallbackReason: routeError.message,
          })
        : undefined,
    );
  }
}

module.exports = {
  createRouteError,
  coerceRouteError,
  hasSubmittedFlashbotsContext,
  resolveTradeExecutionRoute,
  executeTradeWithRoute,
};
