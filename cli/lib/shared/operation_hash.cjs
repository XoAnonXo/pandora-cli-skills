const crypto = require('crypto');

function stableStringify(value) {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeOperationDescriptor(input = {}) {
  const descriptor = input && typeof input === 'object' ? input : {};
  return {
    command: String(descriptor.command || descriptor.tool || '').trim() || null,
    action: String(descriptor.action || '').trim() || null,
    target: descriptor.target === undefined ? null : descriptor.target,
    request: descriptor.request === undefined
      ? (descriptor.payload && typeof descriptor.payload === 'object' ? descriptor.payload : {})
      : descriptor.request,
    context: descriptor.context === undefined ? null : descriptor.context,
    metadata: descriptor.metadata === undefined ? null : descriptor.metadata,
    policyPack: String(descriptor.policyPack || '').trim() || null,
    profile: String(descriptor.profile || '').trim() || null,
    environment: String(descriptor.environment || '').trim() || null,
    mode: String(descriptor.mode || '').trim() || null,
    scope: String(descriptor.scope || '').trim() || 'local',
  };
}

function buildOperationHash(input = {}, options = {}) {
  const payload = {
    namespace: String(options.namespace || '').trim() || null,
    operation: normalizeOperationDescriptor(input),
  };
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function computeOperationHash(input = {}, options = {}) {
  return buildOperationHash(input, options);
}

function normalizeOperationHash(rawHash, options = {}) {
  if (rawHash === undefined || rawHash === null || rawHash === '') {
    if (options.allowNull) return null;
    throw new Error('Operation hash is required.');
  }
  const normalized = String(rawHash).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`Invalid operation hash: ${rawHash}`);
  }
  return normalized;
}

function slugifyPrefix(value) {
  return String(value || 'op')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'op';
}

function buildOperationId(seed = {}, options = {}) {
  const operationHash = normalizeOperationHash(seed.operationHash || options.operationHash || buildOperationHash(seed));
  const prefix = slugifyPrefix(options.prefix || seed.command || seed.tool || 'op');
  return `${prefix}-${operationHash.slice(0, 16)}`;
}

function generateOperationId(prefix = 'op') {
  return `${slugifyPrefix(prefix)}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeOperationId(rawId, options = {}) {
  if (rawId === undefined || rawId === null || rawId === '') {
    if (options.allowNull) return null;
    throw new Error('Operation id is required.');
  }
  const normalized = String(rawId)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) {
    throw new Error(`Invalid operation id: ${rawId}`);
  }
  return normalized;
}

module.exports = {
  stableStringify,
  normalizeOperationDescriptor,
  buildOperationHash,
  computeOperationHash,
  normalizeOperationHash,
  buildOperationId,
  generateOperationId,
  normalizeOperationId,
};
