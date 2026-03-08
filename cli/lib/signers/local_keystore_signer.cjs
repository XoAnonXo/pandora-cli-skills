'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  PROFILE_ENV_CHAIN_ID_CANDIDATES,
  PROFILE_ENV_KEYSTORE_PASSWORD_CANDIDATES,
  PROFILE_ENV_RPC_URL_CANDIDATES,
} = require('../shared/profile_constants.cjs');
const { createProfileError } = require('../shared/profile_errors.cjs');
const { normalizeSignerBackendResolution } = require('./index.cjs');

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
    if (Number.isSafeInteger(numeric) && numeric > 0) return numeric;
  }
  return text;
}

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
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

function hasUnsafePermissions(stat) {
  if (!stat || process.platform === 'win32') return false;
  return (stat.mode & 0o077) !== 0;
}

function loadKeystoreFile(resolvedPath) {
  try {
    const stat = fs.statSync(resolvedPath);
    return {
      exists: true,
      stat,
      content: fs.readFileSync(resolvedPath, 'utf8'),
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        exists: false,
        stat: null,
        content: null,
      };
    }
    throw createProfileError('PROFILE_KEYSTORE_READ_FAILED', `Unable to read keystore file: ${resolvedPath}`, {
      path: resolvedPath,
      cause: error && error.message ? error.message : String(error),
    });
  }
}

function buildPasswordCandidates(secretRef) {
  return Array.isArray(secretRef.passwordEnv) && secretRef.passwordEnv.length
    ? secretRef.passwordEnv
    : PROFILE_ENV_KEYSTORE_PASSWORD_CANDIDATES;
}

function buildRpcEnvCandidates(secretRef) {
  return Array.isArray(secretRef.rpcUrlEnv) && secretRef.rpcUrlEnv.length
    ? secretRef.rpcUrlEnv
    : PROFILE_ENV_RPC_URL_CANDIDATES;
}

function buildChainEnvCandidates(secretRef) {
  return Array.isArray(secretRef.chainIdEnv) && secretRef.chainIdEnv.length
    ? secretRef.chainIdEnv
    : PROFILE_ENV_CHAIN_ID_CANDIDATES;
}

function describePasswordRequirement(secretRef, passwordSource) {
  if (passwordSource === 'input') {
    return ['input.password'];
  }
  return buildPasswordCandidates(secretRef);
}

function classifyKeystoreUnlockFailure(error) {
  const message = normalizeOptionalString(error && error.message)
    ? String(error.message).toLowerCase()
    : '';

  if (message.includes('invalid password')) {
    return {
      code: 'PROFILE_KEYSTORE_LOCKED',
      message: 'Keystore password was rejected; the keystore remains locked.',
      state: 'locked',
    };
  }

  if (message.includes('invalid json wallet')) {
    return {
      code: 'PROFILE_KEYSTORE_INVALID',
      message: 'Configured keystore file is not a valid JSON wallet.',
      state: 'invalid',
    };
  }

  return {
    code: 'PROFILE_KEYSTORE_UNLOCK_FAILED',
    message: 'Unable to unlock keystore with the configured password.',
    state: 'error',
  };
}

function loadJsonWalletsModule() {
  try {
    return require('@ethersproject/json-wallets');
  } catch (error) {
    throw createProfileError(
      'PROFILE_KEYSTORE_RUNTIME_UNAVAILABLE',
      'The local-keystore signer backend requires the @ethersproject/json-wallets package at runtime.',
      {
        packageName: '@ethersproject/json-wallets',
        cause: error && error.message ? error.message : String(error),
      },
    );
  }
}

function decryptWalletFromKeystore(content, password, resolvedPath) {
  try {
    const { decryptJsonWalletSync } = loadJsonWalletsModule();
    const wallet = decryptJsonWalletSync(content, password);
    return {
      address: normalizeOptionalString(wallet && wallet.address)
        ? String(wallet.address).toLowerCase()
        : null,
      privateKey: normalizeOptionalString(wallet && wallet.privateKey),
    };
  } catch (error) {
    const failure = classifyKeystoreUnlockFailure(error);
    throw createProfileError(failure.code, failure.message, {
      path: resolvedPath,
      keystoreState: failure.state,
      cause: error && error.message ? error.message : String(error),
    });
  }
}

function createLocalKeystoreSignerBackend(options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;

  function resolveProfile(profile, context = {}) {
    const effectiveEnv = context.env && typeof context.env === 'object' ? context.env : env;
    const includeSecretMaterial = context.includeSecretMaterial === true;
    const secretRef = isPlainObject(profile && profile.secretRef) ? profile.secretRef : {};
    const rawPath = normalizeOptionalString(secretRef.path);
    const resolvedPath = rawPath ? path.resolve(expandHome(rawPath)) : null;
    const passwordOverride = normalizeOptionalString(context.password);
    const password = passwordOverride
      ? { source: 'input', value: passwordOverride }
      : firstPopulatedEnv(effectiveEnv, buildPasswordCandidates(secretRef));
    const rpcUrlOverride = normalizeOptionalString(context.rpcUrl);
    const chainIdOverride = normalizeComparableChainId(context.chainId);
    const rpcUrl = rpcUrlOverride
      ? { source: 'input', value: rpcUrlOverride }
      : firstPopulatedEnv(effectiveEnv, buildRpcEnvCandidates(secretRef));
    const chainId = chainIdOverride !== null
      ? { source: 'input', value: chainIdOverride }
      : firstPopulatedEnv(effectiveEnv, buildChainEnvCandidates(secretRef));

    const missingSecrets = [];
    const missingContext = [];
    const notes = [];

    if (!resolvedPath) {
      missingSecrets.push('secretRef.path');
      notes.push('local-keystore profiles require secretRef.path.');
      return normalizeSignerBackendResolution({
        backend: 'local-keystore',
        status: 'missing-config',
        ready: false,
        backendImplemented: true,
        configured: false,
        signerReady: false,
        networkContextReady: false,
        readOnly: Boolean(profile && profile.readOnly),
        credentialsRequired: true,
        secretSource: null,
        wallet: null,
        rpcUrl: rpcUrl ? rpcUrl.value : null,
        chainId: chainId ? chainId.value : null,
        missingSecrets,
        missingContext,
        missing: [...missingSecrets, ...missingContext],
        notes,
      });
    }

    const keystoreRecord = loadKeystoreFile(resolvedPath);
    if (!keystoreRecord.exists) {
      missingSecrets.push(resolvedPath);
      notes.push('Configured keystore file does not exist.');
      return normalizeSignerBackendResolution({
        backend: 'local-keystore',
        status: 'missing-keystore',
        ready: false,
        backendImplemented: true,
        configured: true,
        signerReady: false,
        networkContextReady: Boolean(rpcUrl && chainId),
        readOnly: Boolean(profile && profile.readOnly),
        credentialsRequired: true,
        secretSource: {
          kind: 'file',
          path: resolvedPath,
          exists: false,
        },
        wallet: null,
        rpcUrl: rpcUrl ? rpcUrl.value : null,
        chainId: chainId ? chainId.value : null,
        missingSecrets,
        missingContext,
        missing: [...missingSecrets, ...missingContext],
        notes,
      });
    }

    if (hasUnsafePermissions(keystoreRecord.stat)) {
      notes.push('Keystore file permissions are too broad; restrict to owner-only access.');
      return normalizeSignerBackendResolution({
        backend: 'local-keystore',
        status: 'error',
        ready: false,
        backendImplemented: true,
        configured: true,
        signerReady: false,
        networkContextReady: Boolean(rpcUrl && chainId),
        readOnly: Boolean(profile && profile.readOnly),
        credentialsRequired: true,
        secretSource: {
          kind: 'file',
          path: resolvedPath,
          exists: true,
        },
        wallet: null,
        rpcUrl: rpcUrl ? rpcUrl.value : null,
        chainId: chainId ? chainId.value : null,
        missingSecrets,
        missingContext,
        missing: [...missingSecrets, ...missingContext],
        notes,
      });
    }

    if (!password) {
      missingSecrets.push(...buildPasswordCandidates(secretRef));
      notes.push('Keystore is present but locked until a password source is supplied.');
      return normalizeSignerBackendResolution({
        backend: 'local-keystore',
        status: 'missing-secrets',
        ready: false,
        backendImplemented: true,
        configured: true,
        signerReady: false,
        networkContextReady: Boolean(rpcUrl && chainId),
        readOnly: Boolean(profile && profile.readOnly),
        credentialsRequired: true,
        secretSource: {
          kind: 'file',
          path: resolvedPath,
          exists: true,
        },
        wallet: null,
        rpcUrl: rpcUrl ? rpcUrl.value : null,
        chainId: chainId ? chainId.value : null,
        missingSecrets,
        missingContext,
        missing: [...missingSecrets, ...missingContext],
        notes,
      });
    }

    if (!rpcUrl) {
      missingContext.push(...buildRpcEnvCandidates(secretRef));
    }
    if (!chainId) {
      missingContext.push(...buildChainEnvCandidates(secretRef));
    }

    let wallet = null;
    let unlockError = null;
    try {
      wallet = decryptWalletFromKeystore(keystoreRecord.content, password.value, resolvedPath);
    } catch (error) {
      unlockError = error;
    }

    if (unlockError) {
      notes.push(unlockError.message);
      const unlockState = unlockError && unlockError.details ? unlockError.details.keystoreState : null;
      if (unlockState === 'locked') {
        missingSecrets.push(...describePasswordRequirement(secretRef, password.source));
        return normalizeSignerBackendResolution({
          backend: 'local-keystore',
          status: 'missing-secrets',
          ready: false,
          backendImplemented: true,
          configured: true,
          signerReady: false,
          networkContextReady: Boolean(rpcUrl && chainId),
          readOnly: Boolean(profile && profile.readOnly),
          credentialsRequired: true,
          secretSource: {
            kind: 'file',
            path: resolvedPath,
            exists: true,
          },
          wallet: null,
          rpcUrl: rpcUrl ? rpcUrl.value : null,
          chainId: chainId ? chainId.value : null,
          missingSecrets,
          missingContext,
          missing: [...missingSecrets, ...missingContext],
          notes,
        });
      }
      return normalizeSignerBackendResolution({
        backend: 'local-keystore',
        status: 'error',
        ready: false,
        backendImplemented: true,
        configured: true,
        signerReady: false,
        networkContextReady: Boolean(rpcUrl && chainId),
        readOnly: Boolean(profile && profile.readOnly),
        credentialsRequired: true,
        secretSource: {
          kind: 'file',
          path: resolvedPath,
          exists: true,
        },
        wallet: null,
        rpcUrl: rpcUrl ? rpcUrl.value : null,
        chainId: chainId ? chainId.value : null,
        missingSecrets,
        missingContext,
        missing: [...missingSecrets, ...missingContext],
        notes,
      });
    }

    const signerReady = Boolean(wallet && wallet.privateKey);
    const networkContextReady = Boolean(rpcUrl && chainId);
    const ready = signerReady && networkContextReady;
    notes.push(
      ready
        ? 'Resolved signer material and network context from encrypted keystore configuration.'
        : signerReady
          ? 'Keystore unlocked successfully, but rpcUrl/chainId context is still missing.'
          : 'Keystore could not provide signer material.',
    );

    return normalizeSignerBackendResolution({
      backend: 'local-keystore',
      status: !signerReady
        ? 'error'
        : ready
          ? 'ready'
          : 'missing-context',
      ready,
      backendImplemented: true,
      configured: true,
      signerReady,
      networkContextReady,
      readOnly: Boolean(profile && profile.readOnly),
      credentialsRequired: true,
      secretSource: {
        kind: 'file',
        path: resolvedPath,
        exists: true,
      },
      wallet: wallet ? wallet.address : null,
      rpcUrl: rpcUrl ? rpcUrl.value : null,
      chainId: chainId ? chainId.value : null,
      missingSecrets,
      missingContext,
      missing: [...missingSecrets, ...missingContext],
      notes,
      ...(includeSecretMaterial && wallet && wallet.privateKey
        ? {
            secretMaterial: {
              privateKey: wallet.privateKey,
            },
          }
        : {}),
    });
  }

  async function materializeSigner(input = {}) {
    const profile = input.profile;
    const resolution = input.resolution;
    const viemRuntime = input.viemRuntime;
    if (!profile || !resolution) {
      throw createProfileError('PROFILE_SIGNER_INVALID_INPUT', 'profile and resolution are required to materialize a keystore signer.');
    }
    if (!viemRuntime || typeof viemRuntime.privateKeyToAccount !== 'function') {
      throw createProfileError('PROFILE_SIGNER_INVALID_INPUT', 'viemRuntime.privateKeyToAccount is required.');
    }
    if (!resolution.ready) {
      throw createProfileError('PROFILE_RESOLUTION_UNAVAILABLE', 'Keystore profile is not ready for execution.', {
        resolution,
      });
    }
    const secretRef = isPlainObject(profile.secretRef) ? profile.secretRef : {};
    const materializedPrivateKey = normalizeOptionalString(
      resolution && isPlainObject(resolution.secretMaterial)
        ? resolution.secretMaterial.privateKey
        : null,
    );
    if (materializedPrivateKey) {
      const account = viemRuntime.privateKeyToAccount(materializedPrivateKey);
      const walletClient = viemRuntime.createWalletClient({
        account,
        chain: input.chain,
        transport: viemRuntime.http(input.rpcUrl),
      });
      return {
        backend: 'local-keystore',
        account,
        walletClient,
        signerAddress: account.address,
        signerMetadata: {
          backend: 'local-keystore',
          secretSource: resolution.secretSource || null,
          wallet: account.address,
        },
      };
    }
    const resolvedPath = path.resolve(expandHome(secretRef.path));
    const keystoreRecord = loadKeystoreFile(resolvedPath);
    const password = firstPopulatedEnv(env, buildPasswordCandidates(secretRef));
    if (!keystoreRecord.exists) {
      throw createProfileError('PROFILE_RESOLUTION_UNAVAILABLE', 'Keystore profile is missing the keystore file at execution time.', {
        resolution,
      });
    }
    if (!password) {
      throw createProfileError('PROFILE_KEYSTORE_LOCKED', 'Keystore profile is locked because no password source is available at execution time.', {
        resolution,
        missingSecrets: buildPasswordCandidates(secretRef),
      });
    }
    const wallet = decryptWalletFromKeystore(keystoreRecord.content, password.value, resolvedPath);
    if (!wallet || !wallet.privateKey) {
      throw createProfileError('PROFILE_KEYSTORE_UNLOCK_FAILED', 'Keystore could not provide a private key.');
    }
    const account = viemRuntime.privateKeyToAccount(wallet.privateKey);
    const walletClient = viemRuntime.createWalletClient({
      account,
      chain: input.chain,
      transport: viemRuntime.http(input.rpcUrl),
    });
    return {
      backend: 'local-keystore',
      account,
      walletClient,
      signerAddress: account.address,
      signerMetadata: {
        backend: 'local-keystore',
        secretSource: resolution.secretSource || null,
        wallet: account.address,
      },
    };
  }

  return {
    id: 'local-keystore',
    resolveProfile,
    materializeSigner,
  };
}

function splitKeystoreInput(input = {}, context = {}) {
  const profile = isPlainObject(input) ? { ...input } : {};
  const mergedContext = isPlainObject(context) ? { ...context } : {};
  const contextKeys = ['env', 'password', 'rpcUrl', 'chainId', 'includeSecretMaterial'];
  for (const key of contextKeys) {
    if (Object.prototype.hasOwnProperty.call(profile, key)) {
      mergedContext[key] = profile[key];
      delete profile[key];
    }
  }
  return {
    profile,
    context: mergedContext,
  };
}

function createLocalKeystoreSigner(options = {}) {
  const backend = createLocalKeystoreSignerBackend(options);
  return {
    resolve: (profile, context = {}) => {
      const normalized = splitKeystoreInput(profile, context);
      return backend.resolveProfile(normalized.profile, normalized.context);
    },
    materializeSigner: (input = {}) => backend.materializeSigner(input),
  };
}

function resolveLocalKeystoreSigner(profile, options = {}) {
  const normalized = splitKeystoreInput(profile, options);
  const env = normalized.context.env && typeof normalized.context.env === 'object'
    ? normalized.context.env
    : options.env;
  return createLocalKeystoreSignerBackend({ env }).resolveProfile(normalized.profile, normalized.context);
}

module.exports = {
  createLocalKeystoreSigner,
  createLocalKeystoreSignerBackend,
  resolveLocalKeystoreSigner,
};
