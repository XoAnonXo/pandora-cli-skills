const { validateMirrorUrl } = require('./mirror_parser_guard.cjs');

const DEPLOY_TX_ROUTE_VALUES = new Set(['public', 'auto', 'flashbots-private', 'flashbots-bundle']);
const DEPLOY_TX_ROUTE_FALLBACK_VALUES = new Set(['fail', 'public']);
const FLASHBOTS_AUTH_KEY_PATTERN = /^0x[a-fA-F0-9]{64}$/;

function parseDeployTxRoute(value, flagName, CliError) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!DEPLOY_TX_ROUTE_VALUES.has(normalized)) {
    throw new CliError(
      'INVALID_FLAG_VALUE',
      `${flagName} must be public|auto|flashbots-private|flashbots-bundle.`,
    );
  }
  return normalized;
}

function parseDeployTxRouteFallback(value, flagName, CliError) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!DEPLOY_TX_ROUTE_FALLBACK_VALUES.has(normalized)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be fail|public.`);
  }
  return normalized;
}

function parseDeployFlashbotsRelayUrl(value, flagName, CliError, isSecureHttpUrlOrLocal) {
  return validateMirrorUrl(value, flagName, CliError, isSecureHttpUrlOrLocal);
}

function parseDeployFlashbotsAuthKey(value, flagName, CliError) {
  const normalized = String(value || '').trim();
  if (!FLASHBOTS_AUTH_KEY_PATTERN.test(normalized)) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} must be 0x + 64 hex chars.`);
  }
  return normalized;
}

function assertDeployFlashbotsFlagContract(options, routeFlagName, CliError) {
  const route = String(options.txRoute || 'public').trim().toLowerCase();
  if (route !== 'public') {
    return;
  }
  const flashbotsFlags = [];
  if (options.flashbotsRelayUrl) flashbotsFlags.push('--flashbots-relay-url');
  if (options.flashbotsAuthKey) flashbotsFlags.push('--flashbots-auth-key');
  if (options.flashbotsTargetBlockOffset !== null) flashbotsFlags.push('--flashbots-target-block-offset');
  if (!flashbotsFlags.length) {
    return;
  }
  throw new CliError(
    'INVALID_ARGS',
    `${flashbotsFlags.join(', ')} require ${routeFlagName} auto, flashbots-private, or flashbots-bundle.`,
  );
}

function assertNoDeployRoutePlanFlags(flagNames, planCommandName, CliError) {
  const provided = Array.isArray(flagNames) ? Array.from(new Set(flagNames.filter(Boolean))) : [];
  if (!provided.length) {
    return;
  }
  throw new CliError('INVALID_ARGS', `${planCommandName} is read-only; do not pass ${provided.join(', ')}.`);
}

module.exports = {
  DEPLOY_TX_ROUTE_VALUES,
  DEPLOY_TX_ROUTE_FALLBACK_VALUES,
  parseDeployTxRoute,
  parseDeployTxRouteFallback,
  parseDeployFlashbotsRelayUrl,
  parseDeployFlashbotsAuthKey,
  assertDeployFlashbotsFlagContract,
  assertNoDeployRoutePlanFlags,
};
