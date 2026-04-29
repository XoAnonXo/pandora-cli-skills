/**
 * Create CLI output helpers for success/error envelopes and table output.
 * @param {{defaultSchemaVersion?: string, CliError: Function}} [options]
 * @returns {{emitFailure: (outputMode: 'table'|'json', error: any) => void, emitSuccess: (outputMode: 'table'|'json', command: string, data: any, tableRenderer?: Function) => void}}
 */
function createCliOutputService(options = {}) {
  const defaultSchemaVersion =
    typeof options.defaultSchemaVersion === 'string' && options.defaultSchemaVersion.trim()
      ? options.defaultSchemaVersion.trim()
      : '1.0.0';
  const CliError = options.CliError;
  const getRecoveryForError = typeof options.getRecoveryForError === 'function' ? options.getRecoveryForError : null;

  if (typeof CliError !== 'function') {
    throw new Error('createCliOutputService requires CliError class.');
  }

  let failureAlreadyEmitted = false;
  const COMPACT_JSON_COMMANDS = new Set(['bootstrap', 'capabilities', 'schema']);

  function useCompactJson(outputMode, command) {
    if (outputMode !== 'json') return false;
    return process.env.PANDORA_DAEMON_LOG_JSONL === '1' || COMPACT_JSON_COMMANDS.has(command);
  }

  function serializeJson(payload, options = {}) {
    const compact = options.compact === true;
    return compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 2);
  }

  function emitJson(payload, options = {}) {
    console.log(serializeJson(payload, options));
  }

  function writeAndExit(stream, text, exitCode) {
    const output = text.endsWith('\n') ? text : `${text}\n`;
    try {
      stream.write(output, () => {
        process.exit(exitCode);
      });
    } catch {
      process.exit(exitCode);
    }
  }

  function formatErrorValue(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value.message === 'string') return value.message;

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function toErrorEnvelope(error) {
    if (error instanceof CliError) {
      const envelope = {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
        },
      };
      if (error.details !== undefined) {
        envelope.error.details = error.details;
      }
      if (getRecoveryForError) {
        const recovery = getRecoveryForError({
          code: error.code,
          message: error.message,
          details: error.details,
        });
        if (recovery) {
          envelope.error.recovery = recovery;
        }
      }
      return envelope;
    }

    const fallback = {
      ok: false,
      error: {
        code: 'UNEXPECTED_ERROR',
        message: formatErrorValue(error && error.message ? error.message : error),
      },
    };
    if (getRecoveryForError) {
      const recovery = getRecoveryForError({
        code: 'UNEXPECTED_ERROR',
        message: fallback.error.message,
      });
      if (recovery) {
        fallback.error.recovery = recovery;
      }
    }
    return fallback;
  }

  function attachJsonMetadata(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    const payload = { ...data };
    if (typeof payload.schemaVersion !== 'string' || !payload.schemaVersion.trim()) {
      payload.schemaVersion = defaultSchemaVersion;
    }
    if (typeof payload.generatedAt !== 'string' || Number.isNaN(Date.parse(payload.generatedAt))) {
      payload.generatedAt = new Date().toISOString();
    }
    return payload;
  }

  function emitFailure(outputMode, error) {
    if (failureAlreadyEmitted) {
      process.exit(error instanceof CliError ? error.exitCode : 1);
    }
    failureAlreadyEmitted = true;

    const envelope = toErrorEnvelope(error);
    const exitCode = error instanceof CliError ? error.exitCode : 1;

    if (outputMode === 'json') {
      writeAndExit(process.stdout, serializeJson(envelope, { compact: useCompactJson(outputMode) }), exitCode);
      return;
    } else {
      const lines = [`[${envelope.error.code}] ${envelope.error.message}`];
      if (envelope.error.details && Array.isArray(envelope.error.details.errors) && envelope.error.details.errors.length) {
        for (const err of envelope.error.details.errors) {
          lines.push(`- ${formatErrorValue(err)}`);
        }
      }
      if (envelope.error.details && Array.isArray(envelope.error.details.hints) && envelope.error.details.hints.length) {
        for (const hint of envelope.error.details.hints) {
          lines.push(`Hint: ${hint}`);
        }
      }
      if (
        envelope.error.details &&
        !Array.isArray(envelope.error.details.errors) &&
        !Array.isArray(envelope.error.details.hints)
      ) {
        try {
          lines.push(`Details: ${JSON.stringify(envelope.error.details)}`);
        } catch {
          lines.push(`Details: ${String(envelope.error.details)}`);
        }
      }
      if (envelope.error.recovery && envelope.error.recovery.command) {
        lines.push(`Next: ${envelope.error.recovery.command}`);
      }
      writeAndExit(process.stderr, lines.join('\n'), exitCode);
      return;
    }
  }

  function emitSuccess(outputMode, command, data, tableRenderer) {
    if (outputMode === 'json') {
      emitJson(
        { ok: true, command, data: attachJsonMetadata(data) },
        { compact: useCompactJson(outputMode, command) },
      );
      return;
    }

    if (typeof tableRenderer === 'function') {
      tableRenderer(data);
      return;
    }

    console.log('Done.');
  }

  return {
    emitFailure,
    emitSuccess,
  };
}

/** Public CLI output service factory export. */
module.exports = {
  createCliOutputService,
};
