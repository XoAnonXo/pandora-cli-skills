'use strict';

const {
  PROFILE_ENV_EXTERNAL_SIGNER_TOKEN_CANDIDATES,
  PROFILE_ENV_EXTERNAL_SIGNER_URL_CANDIDATES,
} = require('../shared/profile_constants.cjs');
const { createProfileError } = require('../shared/profile_errors.cjs');
const { createProfileResolverService } = require('../profile_resolver_service.cjs');
const { createExternalSignerBackend } = require('./external_signer_backend.cjs');
const { createLocalKeystoreSignerBackend } = require('./local_keystore_signer.cjs');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeComparableChainId(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    if (Number.isSafeInteger(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return text;
}

function normalizeWalletAddress(value) {
  const text = normalizeOptionalString(value);
  if (!text) return null;
  return /^0x[a-fA-F0-9]{40}$/.test(text) ? text : null;
}

function firstPopulatedEnv(env, candidates) {
  for (const name of Array.isArray(candidates) ? candidates : []) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) continue;
    const value = env[normalizedName];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    return {
      name: normalizedName,
      value: String(value),
    };
  }
  return null;
}

function hasProfileSelector(options = {}) {
  return Boolean(
    options.profile
    || normalizeOptionalString(options.profileId)
    || normalizeOptionalString(options.profileFile),
  );
}

function buildResolveOptions(options = {}) {
  return {
    profile: options.profile || null,
    profileId: normalizeOptionalString(options.profileId),
    profileFile: normalizeOptionalString(options.profileFile),
    chainId: options.chainId,
    rpcUrl: options.rpcUrl,
    policyId: normalizeOptionalString(options.policyId),
    command: normalizeOptionalString(options.command),
    toolFamily: normalizeOptionalString(options.toolFamily),
    mode: normalizeOptionalString(options.mode),
    liveRequested: options.liveRequested === true,
    mutating: options.mutating === true,
    category: options.category,
    includeSecretMaterial: options.includeSecretMaterial === true,
  };
}

function buildProfileResolver(env, profileResolver) {
  return profileResolver || createProfileResolverService({ env });
}

function buildMissingSignerError() {
  return createProfileError(
    'PROFILE_SIGNER_REQUIRED',
    'Missing signer credentials. Set PRIVATE_KEY/PANDORA_PRIVATE_KEY or pass --profile-id/--profile-file.',
  );
}

function buildProfileNotReadyError(result) {
  const resolution = result && result.resolution ? result.resolution : null;
  return createProfileError(
    'PROFILE_RESOLUTION_UNAVAILABLE',
    resolution && Array.isArray(resolution.notes) && resolution.notes.length
      ? resolution.notes[resolution.notes.length - 1]
      : 'Signer profile is not ready for execution.',
    { result },
  );
}

function assertExecutionContextMatchesResolution(resolution, options = {}) {
  if (!resolution) return;
  const expectedRpcUrl = normalizeOptionalString(resolution.rpcUrl);
  const actualRpcUrl = normalizeOptionalString(options.rpcUrl);
  if (expectedRpcUrl && actualRpcUrl && expectedRpcUrl !== actualRpcUrl) {
    throw createProfileError(
      'PROFILE_CONTEXT_MISMATCH',
      `Execution rpcUrl does not match the resolved profile context. Expected ${expectedRpcUrl}.`,
      {
        expectedRpcUrl,
        actualRpcUrl,
      },
    );
  }
  const expectedChainId = normalizeComparableChainId(resolution.chainId);
  const actualChainId = normalizeComparableChainId(options.chainId);
  if (expectedChainId !== null && actualChainId !== null && expectedChainId !== actualChainId) {
    throw createProfileError(
      'PROFILE_CONTEXT_MISMATCH',
      `Execution chainId does not match the resolved profile context. Expected ${expectedChainId}.`,
      {
        expectedChainId,
        actualChainId,
      },
    );
  }
}

function assertResolvedWalletMatches(resolution, signerAddress) {
  const expectedWallet = normalizeWalletAddress(resolution && resolution.wallet);
  const normalizedSignerAddress = normalizeWalletAddress(signerAddress);
  if (expectedWallet && normalizedSignerAddress && expectedWallet.toLowerCase() !== normalizedSignerAddress.toLowerCase()) {
    throw createProfileError(
      'PROFILE_CONTEXT_MISMATCH',
      `Resolved profile wallet does not match the materialized signer address (${normalizedSignerAddress}).`,
      {
        expectedWallet,
        actualWallet: normalizedSignerAddress,
      },
    );
  }
}

function resolveProfileSelection(options = {}) {
  if (!hasProfileSelector(options)) return null;
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const resolver = buildProfileResolver(env, options.profileResolver);
  const result = resolver.resolveProfile(buildResolveOptions({
    ...options,
    includeSecretMaterial: true,
    liveRequested: options.liveRequested === true || options.requireSigner === true,
    mutating: options.mutating === true || options.requireSigner === true,
  }));
  if (options.requireSigner === true) {
    resolver.assertResolvedProfileUsable(result);
  }
  return result;
}

function buildExternalSignerBackend(profile, env, fetchImpl) {
  const secretRef = isPlainObject(profile && profile.secretRef) ? profile.secretRef : {};
  const baseUrlEntry = firstPopulatedEnv(
    env,
    Array.isArray(secretRef.baseUrlEnv) && secretRef.baseUrlEnv.length
      ? secretRef.baseUrlEnv
      : PROFILE_ENV_EXTERNAL_SIGNER_URL_CANDIDATES,
  );
  const authTokenEntry = firstPopulatedEnv(
    env,
    Array.isArray(secretRef.authTokenEnv) && secretRef.authTokenEnv.length
      ? secretRef.authTokenEnv
      : PROFILE_ENV_EXTERNAL_SIGNER_TOKEN_CANDIDATES,
  );
  return createExternalSignerBackend({
    baseUrl: normalizeOptionalString(secretRef.baseUrl) || (baseUrlEntry ? baseUrlEntry.value : null),
    authToken: authTokenEntry ? authTokenEntry.value : null,
    reference: normalizeOptionalString(secretRef.reference),
    supportedMethods: secretRef.supportedMethods,
    chainIds: Array.isArray(profile.chainAllowlist) ? profile.chainAllowlist : null,
    headers: isPlainObject(secretRef.headers) ? secretRef.headers : null,
    timeoutMs: secretRef.timeoutMs,
    fetch: fetchImpl,
  });
}

async function materializeExternalSigner(options = {}) {
  const {
    profile,
    resolution,
    env,
    chainId,
    chain,
    rpcUrl,
    viemRuntime,
    fetch,
    metadata,
  } = options;
  const backend = buildExternalSignerBackend(profile, env, fetch);
  const configuredWallet = normalizeOptionalString(resolution && resolution.wallet);
  const resolvedWallet = normalizeWalletAddress(configuredWallet);
  if (configuredWallet && !resolvedWallet) {
    throw createProfileError(
      'PROFILE_RESOLUTION_UNAVAILABLE',
      'Resolved external signer wallet is not a valid hex address.',
      {
        resolution,
        wallet: configuredWallet,
      },
    );
  }
  await backend.healthCheck();
  let selectedAccount = null;
  try {
    selectedAccount = await backend.selectAccount({
      chainId,
      account: resolvedWallet,
      method: 'signTransaction',
    });
  } catch (error) {
    if (error && error.code === 'EXTERNAL_SIGNER_ACCOUNT_SELECTION_REQUIRED') {
      throw createProfileError(
        'PROFILE_RESOLUTION_UNAVAILABLE',
        'External signer returned multiple accounts. Pin a specific wallet in the signer profile or resolved profile context before execution.',
        {
          resolution,
          chainId,
          accounts: Array.isArray(error.details && error.details.accounts) ? error.details.accounts : null,
        },
      );
    }
    if (error && error.code === 'EXTERNAL_SIGNER_ACCOUNT_NOT_FOUND') {
      throw createProfileError(
        'PROFILE_RESOLUTION_UNAVAILABLE',
        resolvedWallet
          ? `Resolved external signer wallet is not available from the signer service: ${resolvedWallet}`
          : 'External signer did not return any usable account.',
        {
          resolution,
          chainId,
          wallet: resolvedWallet,
        },
      );
    }
    throw error;
  }
  const signerAddress = normalizeWalletAddress(selectedAccount && selectedAccount.address);
  if (!signerAddress) {
    throw createProfileError(
      'PROFILE_RESOLUTION_UNAVAILABLE',
      'External signer returned an invalid account for execution.',
      {
        resolution,
        chainId,
      },
    );
  }
  const account = viemRuntime.toAccount({
    address: signerAddress,
    async signMessage() {
      throw createProfileError('EXTERNAL_SIGNER_METHOD_NOT_ALLOWED', 'External signer message signing is not supported for Pandora execution.', {
        method: 'signMessage',
      });
    },
    async signTransaction(transaction, { serializer } = {}) {
      const result = await backend.signTransaction({
        chainId,
        account: signerAddress,
        transaction: { ...transaction },
        metadata: isPlainObject(metadata) ? metadata : {},
      });
      if (result.signedTransaction) {
        return result.signedTransaction;
      }
      if (!result.signature) {
        throw createProfileError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'External signer did not return a signature or signed transaction.', {
          method: 'signTransaction',
        });
      }
      const serialize = typeof serializer === 'function'
        ? serializer
        : viemRuntime.serializeTransaction;
      if (typeof serialize !== 'function') {
        throw createProfileError('EXTERNAL_SIGNER_INVALID_RESPONSE', 'No transaction serializer was available for external signer result.', {
          method: 'signTransaction',
        });
      }
      return serialize(transaction, viemRuntime.parseSignature(result.signature));
    },
    async signTypedData(typedData) {
      const result = await backend.signTypedData({
        chainId,
        account: signerAddress,
        typedData: { ...typedData },
        metadata: isPlainObject(metadata) ? metadata : {},
      });
      return result.signature;
    },
  });
  const walletClient = viemRuntime.createWalletClient({
    account,
    chain,
    transport: viemRuntime.http(rpcUrl),
  });
  return {
    backend: 'external-signer',
    account,
    walletClient,
    signerAddress: account.address,
    signerMetadata: {
      backend: 'external-signer',
      secretSource: resolution && resolution.secretSource ? resolution.secretSource : null,
      wallet: account.address,
    },
  };
}

async function materializeProfileSigner(options = {}) {
  const resolved = options.resolvedProfile || resolveProfileSelection(options);
  if (!resolved) return null;
  const resolution = resolved.resolution;
  if (!resolution || !resolution.ready) {
    throw buildProfileNotReadyError(resolved);
  }
  assertExecutionContextMatchesResolution(resolution, options);
  const profile = resolved.profile;
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const viemRuntime = options.viemRuntime;
  if (!viemRuntime) {
    throw createProfileError('PROFILE_SIGNER_INVALID_INPUT', 'viemRuntime is required to materialize signer profiles.');
  }

  if (profile.signerBackend === 'local-env') {
    const privateKey = resolution.secretMaterial && resolution.secretMaterial.privateKey
      ? resolution.secretMaterial.privateKey
      : null;
    if (!privateKey) {
      throw createProfileError('PROFILE_RESOLUTION_UNAVAILABLE', 'Local-env profile did not expose private key material for execution.', {
        resolution,
      });
    }
    const account = viemRuntime.privateKeyToAccount(privateKey);
    assertResolvedWalletMatches(resolution, account.address);
    return {
      backend: 'local-env',
      account,
      walletClient: viemRuntime.createWalletClient({
        account,
        chain: options.chain,
        transport: viemRuntime.http(options.rpcUrl),
      }),
      signerAddress: account.address,
      signerMetadata: {
        backend: 'local-env',
        secretSource: resolution.secretSource || null,
        wallet: account.address,
      },
      resolvedProfile: resolved,
    };
  }

  if (profile.signerBackend === 'local-keystore') {
    const backend = createLocalKeystoreSignerBackend({ env });
    const materialized = await backend.materializeSigner({
      profile,
      resolution,
      viemRuntime,
      chain: options.chain,
      rpcUrl: options.rpcUrl,
    });
    assertResolvedWalletMatches(resolution, materialized.signerAddress);
    return {
      ...materialized,
      resolvedProfile: resolved,
    };
  }

  if (profile.signerBackend === 'external-signer') {
    const materialized = await materializeExternalSigner({
      profile,
      resolution,
      env,
      chain: options.chain,
      chainId: options.chainId,
      rpcUrl: options.rpcUrl,
      viemRuntime,
      fetch: options.fetch,
      metadata: options.metadata,
    });
    assertResolvedWalletMatches(resolution, materialized.signerAddress);
    return {
      ...materialized,
      resolvedProfile: resolved,
    };
  }

  throw createProfileError('PROFILE_SIGNER_UNSUPPORTED', `Unsupported signer backend for execution: ${profile.signerBackend}`, {
    profileId: profile.id,
    backend: profile.signerBackend,
  });
}

async function materializeExecutionSigner(options = {}) {
  const viemRuntime = options.viemRuntime;
  if (!viemRuntime) {
    throw createProfileError('PROFILE_SIGNER_INVALID_INPUT', 'viemRuntime is required to materialize execution signers.');
  }

  if (options.privateKey) {
    const account = viemRuntime.privateKeyToAccount(options.privateKey);
    return {
      backend: 'private-key',
      account,
      walletClient: viemRuntime.createWalletClient({
        account,
        chain: options.chain,
        transport: viemRuntime.http(options.rpcUrl),
      }),
      signerAddress: account.address,
      signerMetadata: {
        backend: 'private-key',
        wallet: account.address,
      },
      resolvedProfile: null,
    };
  }

  if (!hasProfileSelector(options) && !options.resolvedProfile) {
    if (options.requireSigner === true) {
      throw buildMissingSignerError();
    }
    return null;
  }

  return materializeProfileSigner(options);
}

module.exports = {
  hasProfileSelector,
  resolveProfileSelection,
  materializeProfileSigner,
  materializeExecutionSigner,
};
