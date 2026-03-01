/**
 * Convert numeric-like input to a finite number.
 * @param {*} value
 * @returns {number|null}
 */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

/**
 * Convert optional numeric-like input to a finite number.
 * Empty values (`null`, `undefined`, empty string) remain `null`.
 * @param {*} value
 * @returns {number|null}
 */
function toOptionalNumber(value) {
  return toNumber(value);
}

/**
 * Round a finite number with fixed decimal precision.
 * @param {number} value
 * @param {number} [decimals=6]
 * @returns {number|null}
 */
function round(value, decimals = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Clamp a number into an inclusive `[min, max]` range.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Sleep helper used by polling/daemon loops.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleepMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLocalHostname(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Allow `https://` URLs everywhere, and `http://` only for local development hosts.
 * @param {string} value
 * @returns {boolean}
 */
function isSecureHttpUrlOrLocal(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol !== 'http:') return false;
    return isLocalHostname(parsed.hostname);
  } catch {
    return false;
  }
}

/** Shared utility exports used by parser and service modules. */
module.exports = {
  toNumber,
  toOptionalNumber,
  round,
  clamp,
  sleepMs,
  isSecureHttpUrlOrLocal,
};
