/**
 * Retry wrapper for Polymarket hedge orders with exponential backoff.
 *
 * Only retries on transient failures (ok: false results and caught errors).
 * Validation throws (missing key, bad amounts) propagate immediately.
 *
 * @param {{
 *   hedgeFn: Function,
 *   hedgeArgs: object,
 *   maxRetries: number,
 *   baseDelayMs: number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} params
 * @returns {Promise<{result: object, retryCount: number, attempts: Array}>}
 */
async function retryHedgeOrder(params) {
  const { hedgeFn, hedgeArgs, maxRetries = 3, baseDelayMs = 2000 } = params;
  const sleepFn = typeof params.sleep === 'function'
    ? params.sleep
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const attempts = [];
  let lastResult = null;
  let retryCount = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      await sleepFn(delayMs);
      retryCount++;
    }

    let result;
    let thrown = false;
    try {
      result = await hedgeFn(hedgeArgs);
    } catch (err) {
      thrown = true;
      const isValidation = isValidationError(err);
      if (isValidation) {
        throw err;
      }
      result = {
        ok: false,
        error: {
          code: (err && err.code) ? String(err.code) : null,
          message: (err && err.message) ? String(err.message) : String(err),
        },
        _thrown: true,
      };
    }

    attempts.push({
      attempt,
      ok: result && result.ok !== false,
      error: result && result.ok === false && result.error ? result.error : null,
      thrown,
    });

    if (result && result.ok !== false) {
      return { result, retryCount, attempts };
    }

    lastResult = result;
  }

  return { result: lastResult, retryCount, attempts };
}

function isValidationError(err) {
  if (!err) return false;
  const msg = String(err.message || '');
  if (/must be a positive number/i.test(msg)) return true;
  if (/missing.*tokenId/i.test(msg)) return true;
  if (/unsupported order side/i.test(msg)) return true;
  if (/must be a valid private key/i.test(msg)) return true;
  if (err.code === 'POLYMARKET_WALLET_DEPENDENCY_MISSING') return true;
  return false;
}

module.exports = { retryHedgeOrder, isValidationError };
