function toServiceError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function toIntegerOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

/**
 * Resolve attach-only fork runtime settings.
 * Precedence in fork mode: --fork-rpc-url > FORK_RPC_URL (when --fork).
 * @param {object} [options]
 * @param {{env?: object, isSecureHttpUrlOrLocal?: (url: string) => boolean, defaultChainId?: number}} [runtime]
 * @returns {{mode: 'live'|'fork', rpcUrl: (string|null), chainId: (number|null)}}
 */
function resolveForkRuntime(options = {}, runtime = {}) {
  const env = runtime.env && typeof runtime.env === 'object' ? runtime.env : process.env;
  const isSecureHttpUrlOrLocal =
    typeof runtime.isSecureHttpUrlOrLocal === 'function' ? runtime.isSecureHttpUrlOrLocal : () => true;
  const defaultChainId = Number.isInteger(runtime.defaultChainId) ? runtime.defaultChainId : 1;

  const forkExplicit = options.fork === true;
  const forkRpcUrlFromFlag = String(options.forkRpcUrl || '').trim();
  const forkRequested = forkExplicit || Boolean(forkRpcUrlFromFlag);

  if (!forkRequested) {
    const chainId = toIntegerOrNull(options.chainId) ?? toIntegerOrNull(env.CHAIN_ID) ?? defaultChainId;
    return {
      mode: 'live',
      rpcUrl: null,
      chainId,
    };
  }

  const envForkRpcUrl = String(env.FORK_RPC_URL || '').trim();
  let rpcUrl = forkRpcUrlFromFlag || (forkExplicit ? envForkRpcUrl : '');

  if (!rpcUrl) {
    throw toServiceError(
      'MISSING_REQUIRED_FLAG',
      '--fork requires FORK_RPC_URL env var or explicit --fork-rpc-url <url>.',
      {
        hints: ['Set FORK_RPC_URL=http://127.0.0.1:8545 and rerun with --fork.'],
      },
    );
  }

  if (!isSecureHttpUrlOrLocal(rpcUrl)) {
    throw toServiceError(
      'INVALID_FLAG_VALUE',
      '--fork-rpc-url must use https:// (or http://localhost/127.0.0.1 for local testing).',
      { rpcUrl },
    );
  }

  const chainId =
    toIntegerOrNull(options.forkChainId)
    ?? toIntegerOrNull(options.chainId)
    ?? toIntegerOrNull(env.CHAIN_ID)
    ?? defaultChainId;

  return {
    mode: 'fork',
    rpcUrl,
    chainId,
  };
}

module.exports = {
  resolveForkRuntime,
};
