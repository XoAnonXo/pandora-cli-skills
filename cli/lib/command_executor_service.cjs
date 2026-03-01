const path = require('path');
const { spawnSync } = require('child_process');

/**
 * Normalize unknown error-ish values into a loggable message string.
 * @param {*} value
 * @returns {string}
 */
function coerceErrorMessage(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.message === 'string') return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Parse a candidate JSON envelope from raw process output.
 * Accepts only objects that include a boolean `ok` field.
 * @param {string} text
 * @returns {object|null}
 */
function parseEnvelopeCandidate(text) {
  const candidate = String(text || '').trim();
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object' && typeof parsed.ok === 'boolean') {
      return parsed;
    }
  } catch {
    // continue with extraction path
  }
  return null;
}

/**
 * Extract the last syntactically valid top-level JSON object from text.
 * Useful when diagnostics/noise precede the structured CLI envelope.
 * @param {string} text
 * @returns {object|null}
 */
function extractLastJsonObject(text) {
  const source = String(text || '');
  if (!source) return null;

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let last = null;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        last = source.slice(start, i + 1);
      }
    }
  }

  return parseEnvelopeCandidate(last);
}

/**
 * Parse a CLI JSON envelope from stdout/stderr with robust fallbacks.
 * @param {string} stdout
 * @param {string} stderr
 * @returns {object|null}
 */
function parseEnvelopeFromOutput(stdout, stderr) {
  const candidates = [stdout, stderr, `${stdout || ''}\n${stderr || ''}`];
  for (const candidate of candidates) {
    const direct = parseEnvelopeCandidate(candidate);
    if (direct) return direct;
    const extracted = extractLastJsonObject(candidate);
    if (extracted) return extracted;
  }
  return null;
}

/**
 * @typedef {object} ExecutorEnvelope
 * @property {boolean} ok
 * @property {string} [command]
 * @property {object} [data]
 * @property {{code: string, message: string, details?: object}} [error]
 */

/**
 * @typedef {object} ExecuteJsonCommandResult
 * @property {boolean} ok
 * @property {number} exitCode
 * @property {string} stdout
 * @property {string} stderr
 * @property {ExecutorEnvelope} envelope
 */

/**
 * Build a child-process command executor for JSON-mode CLI invocations.
 * The executor always prepends `--output json` and normalizes failures into an envelope shape.
 * @param {{cliPath?: string, defaultTimeoutMs?: number, env?: object}} [options]
 * @returns {{
 *   executeJsonCommand: (commandArgs: string[], runtime?: {timeoutMs?: number, env?: object}) => ExecuteJsonCommandResult,
 *   coerceErrorMessage: (value: *) => string
 * }}
 */
function createCommandExecutorService(options = {}) {
  const cliPath =
    typeof options.cliPath === 'string' && options.cliPath.trim()
      ? options.cliPath.trim()
      : path.resolve(__dirname, '..', 'pandora.cjs');
  const defaultTimeoutMs = Number.isFinite(options.defaultTimeoutMs) ? Math.max(1_000, Math.trunc(options.defaultTimeoutMs)) : 60_000;
  const baseEnv = options.env && typeof options.env === 'object' ? options.env : process.env;

  /**
   * Execute the CLI synchronously and parse the envelope from process output.
   * @param {string[]} commandArgs
   * @param {{timeoutMs?: number, env?: object}} [runtime]
   * @returns {ExecuteJsonCommandResult}
   */
  function executeJsonCommand(commandArgs, runtime = {}) {
    const timeoutMs = Number.isFinite(runtime.timeoutMs)
      ? Math.max(1_000, Math.trunc(runtime.timeoutMs))
      : defaultTimeoutMs;
    const env = runtime.env && typeof runtime.env === 'object' ? runtime.env : baseEnv;
    const argv = ['--output', 'json', ...commandArgs];

    const result = spawnSync(process.execPath, [cliPath, ...argv], {
      encoding: 'utf8',
      env,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error && result.error.code === 'ETIMEDOUT') {
      return {
        ok: false,
        exitCode: 1,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        envelope: {
          ok: false,
          error: {
            code: 'COMMAND_TIMEOUT',
            message: `Command timed out after ${timeoutMs}ms.`,
            details: { commandArgs, timeoutMs },
          },
        },
      };
    }

    if (result.error) {
      return {
        ok: false,
        exitCode: typeof result.status === 'number' ? result.status : 1,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        envelope: {
          ok: false,
          error: {
            code: 'COMMAND_EXEC_FAILED',
            message: result.error.message || 'CLI command execution failed.',
            details: {
              commandArgs,
              code: result.error.code || null,
              signal: result.signal || null,
            },
          },
        },
      };
    }

    const envelope = parseEnvelopeFromOutput(result.stdout, result.stderr);
    if (!envelope) {
      return {
        ok: false,
        exitCode: typeof result.status === 'number' ? result.status : 1,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        envelope: {
          ok: false,
          error: {
            code: 'COMMAND_OUTPUT_PARSE_FAILED',
            message: 'CLI command returned non-JSON output.',
            details: {
              commandArgs,
              stdout: String(result.stdout || '').slice(0, 10_000),
              stderr: String(result.stderr || '').slice(0, 10_000),
            },
          },
        },
      };
    }

    return {
      ok: envelope && envelope.ok === true,
      exitCode: typeof result.status === 'number' ? result.status : 1,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      envelope,
    };
  }

  return {
    executeJsonCommand,
    coerceErrorMessage,
  };
}

module.exports = {
  createCommandExecutorService,
};
