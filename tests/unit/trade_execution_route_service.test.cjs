const test = require('node:test');
const assert = require('node:assert/strict');

const {
  executeTradeWithRoute,
  resolveTradeExecutionRoute,
} = require('../../cli/lib/trade_execution_route_service.cjs');

function makeCliError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

test('resolveTradeExecutionRoute maps auto to the private single-tx path when approval is not needed', () => {
  assert.equal(resolveTradeExecutionRoute('auto', false), 'flashbots-private');
  assert.equal(resolveTradeExecutionRoute('auto', true), 'flashbots-bundle');
  assert.equal(resolveTradeExecutionRoute('public', true), 'public');
});

test('executeTradeWithRoute uses the private single-tx executor when auto resolves without approval', async () => {
  const calls = [];
  const result = await executeTradeWithRoute({
    runtime: {
      chainId: 1,
      mode: 'live',
      flashbotsAuthKey: `0x${'1'.repeat(64)}`,
      executionRouteFallback: 'fail',
    },
    requestedExecutionRoute: 'auto',
    needsApproval: false,
    errorFactory: makeCliError,
    executePublicRoute: async () => {
      calls.push('public');
      return { route: 'public' };
    },
    executeFlashbotsPrivateRoute: async () => {
      calls.push('private');
      return { route: 'private' };
    },
    executeFlashbotsBundleRoute: async () => {
      calls.push('bundle');
      return { route: 'bundle' };
    },
  });

  assert.deepEqual(calls, ['private']);
  assert.equal(result.route, 'private');
});

test('executeTradeWithRoute uses the bundle executor when auto resolves with approval', async () => {
  const calls = [];
  const result = await executeTradeWithRoute({
    runtime: {
      chainId: 1,
      mode: 'live',
      flashbotsAuthKey: `0x${'1'.repeat(64)}`,
      executionRouteFallback: 'fail',
    },
    requestedExecutionRoute: 'auto',
    needsApproval: true,
    errorFactory: makeCliError,
    executePublicRoute: async () => {
      calls.push('public');
      return { route: 'public' };
    },
    executeFlashbotsPrivateRoute: async () => {
      calls.push('private');
      return { route: 'private' };
    },
    executeFlashbotsBundleRoute: async () => {
      calls.push('bundle');
      return { route: 'bundle' };
    },
  });

  assert.deepEqual(calls, ['bundle']);
  assert.equal(result.route, 'bundle');
});

test('executeTradeWithRoute fails closed on unsupported chains when no fallback is configured', async () => {
  await assert.rejects(
    executeTradeWithRoute({
      runtime: {
        chainId: 137,
        mode: 'live',
        flashbotsAuthKey: `0x${'1'.repeat(64)}`,
        executionRouteFallback: 'fail',
      },
      requestedExecutionRoute: 'flashbots-private',
      needsApproval: false,
      errorFactory: makeCliError,
      executePublicRoute: async () => ({ route: 'public' }),
      executeFlashbotsPrivateRoute: async () => ({ route: 'private' }),
      executeFlashbotsBundleRoute: async () => ({ route: 'bundle' }),
    }),
    (error) => {
      assert.equal(error.code, 'FLASHBOTS_UNSUPPORTED_CHAIN');
      return true;
    },
  );
});

test('executeTradeWithRoute falls back to public submission when private routing is unavailable and fallback is enabled', async () => {
  let publicMetadata = null;
  const result = await executeTradeWithRoute({
    runtime: {
      chainId: 1,
      mode: 'live',
      flashbotsAuthKey: null,
      executionRouteFallback: 'public',
      flashbotsRelayUrl: 'https://relay.flashbots.example',
    },
    requestedExecutionRoute: 'flashbots-private',
    needsApproval: false,
    errorFactory: makeCliError,
    buildRouteMetadata: (metadata) => metadata,
    executePublicRoute: async (metadata) => {
      publicMetadata = metadata;
      return { route: 'public', metadata };
    },
    executeFlashbotsPrivateRoute: async () => ({ route: 'private' }),
    executeFlashbotsBundleRoute: async () => ({ route: 'bundle' }),
  });

  assert.equal(result.route, 'public');
  assert.equal(publicMetadata.executionRouteResolved, 'public');
  assert.equal(publicMetadata.executionRouteFallbackUsed, true);
  assert.match(publicMetadata.executionRouteFallbackReason, /requires --flashbots-auth-key/i);
});

test('executeTradeWithRoute rejects single-tx private routing when an approval is required', async () => {
  await assert.rejects(
    executeTradeWithRoute({
      runtime: {
        chainId: 1,
        mode: 'live',
        flashbotsAuthKey: `0x${'1'.repeat(64)}`,
        executionRouteFallback: 'fail',
      },
      requestedExecutionRoute: 'flashbots-private',
      needsApproval: true,
      errorFactory: makeCliError,
      executePublicRoute: async () => ({ route: 'public' }),
      executeFlashbotsPrivateRoute: async () => ({ route: 'private' }),
      executeFlashbotsBundleRoute: async () => ({ route: 'bundle' }),
    }),
    (error) => {
      assert.equal(error.code, 'FLASHBOTS_BUNDLE_REQUIRED');
      assert.equal(error.details.publicFallbackEligible, false);
      assert.match(error.message, /rebalance-route-fallback public/i);
      return true;
    },
  );
});

test('executeTradeWithRoute degrades auto routing to public when fallback is explicitly enabled', async () => {
  let publicMetadata = null;
  const result = await executeTradeWithRoute({
    runtime: {
      chainId: 1,
      mode: 'live',
      flashbotsAuthKey: null,
      executionRouteFallback: 'public',
    },
    requestedExecutionRoute: 'auto',
    needsApproval: false,
    errorFactory: makeCliError,
    buildRouteMetadata: (metadata) => metadata,
    executePublicRoute: async (metadata) => {
      publicMetadata = metadata;
      return { route: 'public', metadata };
    },
    executeFlashbotsPrivateRoute: async () => ({ route: 'private' }),
    executeFlashbotsBundleRoute: async () => ({ route: 'bundle' }),
  });

  assert.equal(result.route, 'public');
  assert.equal(publicMetadata.executionRouteResolved, 'public');
  assert.equal(publicMetadata.executionRouteFallbackUsed, true);
  assert.match(publicMetadata.executionRouteFallbackReason, /requires --flashbots-auth-key/i);
});

test('executeTradeWithRoute keeps auto routing fail-closed when fallback is not configured', async () => {
  await assert.rejects(
    executeTradeWithRoute({
      runtime: {
        chainId: 1,
        mode: 'live',
        flashbotsAuthKey: null,
        executionRouteFallback: 'fail',
      },
      requestedExecutionRoute: 'auto',
      needsApproval: false,
      errorFactory: makeCliError,
      executePublicRoute: async () => ({ route: 'public' }),
      executeFlashbotsPrivateRoute: async () => ({ route: 'private' }),
      executeFlashbotsBundleRoute: async () => ({ route: 'bundle' }),
    }),
    (error) => {
      assert.equal(error.code, 'FLASHBOTS_AUTH_KEY_REQUIRED');
      assert.equal(error.details.publicFallbackEligible, false);
      assert.match(error.message, /rebalance-route-fallback public/i);
      return true;
    },
  );
});

test('executeTradeWithRoute keeps explicit private routing fail-closed when fallback is not configured', async () => {
  await assert.rejects(
    executeTradeWithRoute({
      runtime: {
        chainId: 1,
        mode: 'live',
        flashbotsAuthKey: null,
        executionRouteFallback: 'fail',
      },
      requestedExecutionRoute: 'flashbots-private',
      needsApproval: false,
      errorFactory: makeCliError,
      executePublicRoute: async () => ({ route: 'public' }),
      executeFlashbotsPrivateRoute: async () => ({ route: 'private' }),
      executeFlashbotsBundleRoute: async () => ({ route: 'bundle' }),
    }),
    (error) => {
      assert.equal(error.code, 'FLASHBOTS_AUTH_KEY_REQUIRED');
      assert.equal(error.details.publicFallbackEligible, false);
      assert.match(error.message, /rebalance-route-fallback public/i);
      return true;
    },
  );
});

test('executeTradeWithRoute does not fall back to public once a private submission has already been sent', async () => {
  let publicCalls = 0;

  await assert.rejects(
    executeTradeWithRoute({
      runtime: {
        chainId: 1,
        mode: 'live',
        flashbotsAuthKey: `0x${'1'.repeat(64)}`,
        executionRouteFallback: 'public',
      },
      requestedExecutionRoute: 'flashbots-private',
      needsApproval: false,
      errorFactory: makeCliError,
      executePublicRoute: async () => {
        publicCalls += 1;
        return { route: 'public' };
      },
      executeFlashbotsPrivateRoute: async () => {
        throw makeCliError(
          'FLASHBOTS_PRIVATE_RECEIPT_FAILED',
          'Flashbots private transaction was submitted, but receipt polling failed.',
          {
            transactionHash: `0x${'2'.repeat(64)}`,
            submissionState: 'submitted',
          },
        );
      },
      executeFlashbotsBundleRoute: async () => ({ route: 'bundle' }),
    }),
    (error) => {
      assert.equal(error.code, 'FLASHBOTS_PRIVATE_RECEIPT_FAILED');
      assert.equal(error.details.transactionHash, `0x${'2'.repeat(64)}`);
      return true;
    },
  );

  assert.equal(publicCalls, 0);
});
