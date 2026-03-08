function buildCliError(CliError, message, details = null) {
  return new CliError('INVALID_ARGS', message, details || undefined);
}

function requireFlagValue(args, index, flag, CliError) {
  const value = args[index + 1];
  if (!value || String(value).startsWith('--')) {
    throw buildCliError(CliError, `${flag} requires a value.`, { flag });
  }
  return String(value);
}

function parseStatusCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOperationsFlags(args = [], deps = {}) {
  const { CliError } = deps;
  if (typeof CliError !== 'function') {
    throw new Error('parseOperationsFlags requires deps.CliError');
  }
  const action = String(args[0] || '').trim();
  const rest = args.slice(1);
  const options = {
    action,
    id: null,
    statuses: [],
    tool: null,
    limit: null,
    reason: null,
    file: null,
    expectedOperationHash: null,
  };
  const allowedFlagsByAction = {
    get: new Set(['--id']),
    list: new Set(['--status', '--statuses', '--tool', '--limit']),
    receipt: new Set(['--id']),
    'verify-receipt': new Set(['--id', '--file', '--expected-operation-hash']),
    cancel: new Set(['--id', '--reason']),
    close: new Set(['--id', '--reason']),
  };
  const allowedFlags = allowedFlagsByAction[action];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token) continue;
    if (!String(token).startsWith('--')) {
      throw buildCliError(CliError, `Unknown positional argument: ${token}`);
    }
    if (!allowedFlags || !allowedFlags.has(token)) {
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for operations ${action}: ${token}`, {
        action,
        flag: token,
      });
    }
    if (token === '--id') {
      options.id = requireFlagValue(rest, index, '--id', CliError);
      index += 1;
      continue;
    }
    if (token === '--status' || token === '--statuses') {
      options.statuses = parseStatusCsv(requireFlagValue(rest, index, token, CliError));
      index += 1;
      continue;
    }
    if (token === '--tool') {
      options.tool = requireFlagValue(rest, index, '--tool', CliError);
      index += 1;
      continue;
    }
    if (token === '--limit') {
      const raw = requireFlagValue(rest, index, '--limit', CliError);
      if (!/^\d+$/.test(raw)) {
        throw new CliError('INVALID_FLAG_VALUE', '--limit must be a positive integer.', { flag: '--limit', value: raw });
      }
      const parsed = Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new CliError('INVALID_FLAG_VALUE', '--limit must be a positive integer.', { flag: '--limit', value: raw });
      }
      options.limit = parsed;
      index += 1;
      continue;
    }
    if (token === '--reason') {
      options.reason = requireFlagValue(rest, index, '--reason', CliError);
      index += 1;
      continue;
    }
    if (token === '--file') {
      options.file = requireFlagValue(rest, index, '--file', CliError);
      index += 1;
      continue;
    }
    if (token === '--expected-operation-hash') {
      options.expectedOperationHash = requireFlagValue(rest, index, '--expected-operation-hash', CliError);
      index += 1;
      continue;
    }
    throw new CliError('UNKNOWN_FLAG', `Unknown flag: ${token}`, { flag: token });
  }

  if (!action) {
    throw buildCliError(CliError, 'operations requires subcommand: get|list|receipt|verify-receipt|cancel|close');
  }
  if (!['get', 'list', 'receipt', 'verify-receipt', 'cancel', 'close'].includes(action)) {
    throw buildCliError(CliError, `operations requires subcommand: get|list|receipt|verify-receipt|cancel|close. Received: ${action}`);
  }
  if (['get', 'receipt', 'cancel', 'close'].includes(action) && !options.id) {
    throw new CliError('MISSING_REQUIRED_FLAG', `${action} requires --id.`, { flag: '--id' });
  }
  if (action === 'verify-receipt' && ((!options.id && !options.file) || (options.id && options.file))) {
    throw new CliError(
      'INVALID_ARGS',
      'verify-receipt requires exactly one of --id or --file.',
      { flags: ['--id', '--file'] },
    );
  }

  return options;
}

module.exports = {
  parseOperationsFlags,
};
