'use strict';

const fs = require('fs');

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunExplainCommand requires deps.${name}()`);
  }
  return deps[name];
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function looksLikeErrorCode(text) {
  const normalized = normalizeOptionalString(text);
  if (!normalized) return false;
  if (/\s/.test(normalized)) return false;
  return /^[A-Za-z][A-Za-z0-9_:-]*$/.test(normalized)
    && (/[A-Z]/.test(normalized) || /[_:-]/.test(normalized));
}

function extractJsonErrorLike(parsed) {
  if (parsed && parsed.ok === false && parsed.error && typeof parsed.error === 'object' && !Array.isArray(parsed.error)) {
    return {
      format: 'error-envelope',
      errorLike: parsed.error,
    };
  }
  if (parsed && parsed.error && typeof parsed.error === 'object' && !Array.isArray(parsed.error) && !parsed.code) {
    return {
      format: 'error-object',
      errorLike: parsed.error,
    };
  }
  return {
    format: 'json-object',
    errorLike: parsed,
  };
}

function parseJsonObject(text, CliError, sourceLabel) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new CliError('INVALID_FLAG_VALUE', `${sourceLabel} must be a JSON object.`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError('INVALID_FLAG_VALUE', `${sourceLabel} must be valid JSON.`, {
      value: text,
      source: sourceLabel,
    });
  }
}

function parseExplainFlags(args, CliError) {
  const options = {
    code: null,
    message: null,
    detailsJson: null,
    stdin: false,
    positionals: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--stdin') {
      options.stdin = true;
      continue;
    }
    if (token === '--code' || token === '--message' || token === '--details-json') {
      const next = args[index + 1];
      if (next === undefined) {
        throw new CliError('MISSING_FLAG_VALUE', `${token} requires a value.`);
      }
      if (token === '--code') options.code = next;
      if (token === '--message') options.message = next;
      if (token === '--details-json') options.detailsJson = next;
      index += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      continue;
    }
    if (String(token).startsWith('-')) {
      throw new CliError('UNKNOWN_FLAG', `Unknown flag: ${token}`);
    }
    options.positionals.push(token);
  }

  return options;
}

function readExplainInput(options, deps) {
  const { CliError, readStdin } = deps;
  const hasPositional = options.positionals.length > 0;
  const hasFlagCode = normalizeOptionalString(options.code) !== null;
  const hasFlagContext = normalizeOptionalString(options.message) !== null || normalizeOptionalString(options.detailsJson) !== null;

  const sourceCount = [options.stdin, hasPositional, hasFlagCode].filter(Boolean).length;
  if (sourceCount === 0) {
    throw new CliError('INVALID_ARGS', 'explain requires an error selector. Use explain <error-code>, --code <code>, or --stdin.');
  }
  if (sourceCount > 1) {
    throw new CliError('INVALID_ARGS', 'Choose exactly one explain input source: positional error, --code, or --stdin.');
  }
  if (hasFlagContext && !hasFlagCode) {
    throw new CliError('INVALID_ARGS', '--message and --details-json require --code.');
  }

  if (options.stdin) {
    const raw = normalizeOptionalString(readStdin());
    if (!raw) {
      throw new CliError('INVALID_ARGS', 'No stdin payload received for explain --stdin.');
    }
    if (raw.startsWith('{')) {
      const parsed = parseJsonObject(raw, CliError, '--stdin');
      const extracted = extractJsonErrorLike(parsed);
      return {
        input: {
          source: 'stdin',
          format: extracted.format,
        },
        errorLike: extracted.errorLike,
      };
    }
    return {
      input: {
        source: 'stdin',
        format: looksLikeErrorCode(raw) ? 'error-code' : 'message',
      },
      errorLike: looksLikeErrorCode(raw)
        ? { code: raw }
        : { message: raw },
    };
  }

  if (hasPositional) {
    const raw = options.positionals.join(' ').trim();
    if (raw.startsWith('{')) {
      const parsed = parseJsonObject(raw, CliError, 'positional error payload');
      const extracted = extractJsonErrorLike(parsed);
      return {
        input: {
          source: 'positional',
          format: extracted.format,
        },
        errorLike: extracted.errorLike,
      };
    }
    return {
      input: {
        source: 'positional',
        format: looksLikeErrorCode(raw) ? 'error-code' : 'message',
      },
      errorLike: looksLikeErrorCode(raw)
        ? { code: raw }
        : { message: raw },
    };
  }

  return {
    input: {
      source: 'flags',
      format: 'error-code',
    },
    errorLike: {
      code: normalizeOptionalString(options.code),
      message: normalizeOptionalString(options.message),
      details: options.detailsJson ? parseJsonObject(options.detailsJson, CliError, '--details-json') : {},
    },
  };
}

function buildNextCommands(explanation) {
  const commands = [];
  const seen = new Set();

  const recovery = explanation && explanation.recovery && typeof explanation.recovery === 'object'
    ? explanation.recovery
    : null;
  if (recovery && typeof recovery.command === 'string' && recovery.command.trim()) {
    const key = recovery.command.trim();
    seen.add(key);
    commands.push({
      command: key,
      action: recovery.action || null,
      retryable: recovery.retryable === true,
      canonical: true,
      source: 'recovery',
    });
  }

  for (const remediation of Array.isArray(explanation && explanation.remediation) ? explanation.remediation : []) {
    const command = normalizeOptionalString(remediation && remediation.command);
    if (!command || seen.has(command)) continue;
    seen.add(command);
    commands.push({
      command,
      action: normalizeOptionalString(remediation.action),
      retryable: remediation && remediation.retryable === true,
      canonical: remediation ? remediation.canonical !== false : true,
      source: normalizeOptionalString(remediation && remediation.type) || 'remediation',
    });
  }

  return commands;
}

function buildExplainPayload(input, explanation) {
  return {
    input,
    error: {
      code: explanation.code,
      normalizedCode: explanation.normalizedCode,
      message: explanation.message,
      details: explanation.details,
    },
    explanation: {
      recognized: explanation.recognized,
      category: explanation.category,
      summary: explanation.summary,
      retryable: explanation.retryable,
      recovery: explanation.recovery || null,
      remediation: Array.isArray(explanation.remediation) ? explanation.remediation : [],
      diagnostics: Array.isArray(explanation.diagnostics) ? explanation.diagnostics : [],
    },
    nextCommands: buildNextCommands(explanation),
  };
}

function renderExplainTable(payload) {
  const error = payload && payload.error ? payload.error : {};
  const explanation = payload && payload.explanation ? payload.explanation : {};
  const nextCommands = Array.isArray(payload && payload.nextCommands) ? payload.nextCommands : [];

  // eslint-disable-next-line no-console
  console.log(`${error.normalizedCode || error.code || '-'}  ${explanation.category || 'unknown'}  ${explanation.recognized ? 'recognized' : 'generic'}`);
  if (explanation.summary) {
    // eslint-disable-next-line no-console
    console.log(`summary: ${explanation.summary}`);
  }
  if (error.message) {
    // eslint-disable-next-line no-console
    console.log(`message: ${error.message}`);
  }
  for (const diagnostic of Array.isArray(explanation.diagnostics) ? explanation.diagnostics : []) {
    // eslint-disable-next-line no-console
    console.log(`diagnostic: ${typeof diagnostic === 'string' ? diagnostic : JSON.stringify(diagnostic)}`);
  }
  for (const command of nextCommands) {
    const action = command.action ? ` (${command.action})` : '';
    // eslint-disable-next-line no-console
    console.log(`next: ${command.command}${action}`);
  }
}

function createRunExplainCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const getExplanationForError = requireDep(deps, 'getExplanationForError');
  const readStdin = typeof deps.readStdin === 'function' ? deps.readStdin : () => fs.readFileSync(0, 'utf8');

  return async function runExplainCommand(args, context) {
    const usage = 'pandora [--output table|json] explain <error-code>|--code <code> [--message <text>] [--details-json <json>] [--stdin]';
    const notes = [
      '`--code` is the canonical machine input for agents and MCP clients.',
      '`--stdin` accepts a raw error object or a full Pandora `--output json` failure envelope.',
      'Next commands prefer canonical tool surfaces instead of compatibility aliases.',
    ];

    if (!Array.isArray(args) || args.length === 0 || includesHelpFlag(args)) {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'explain.help', commandHelpPayload(usage, notes));
      } else {
        // eslint-disable-next-line no-console
        console.log(`Usage: ${usage}`);
        // eslint-disable-next-line no-console
        console.log('');
        // eslint-disable-next-line no-console
        console.log('Notes:');
        for (const note of notes) {
          // eslint-disable-next-line no-console
          console.log(`- ${note}`);
        }
      }
      return;
    }

    const options = parseExplainFlags(args, CliError);
    const request = readExplainInput(options, { CliError, readStdin });
    const explanation = getExplanationForError(request.errorLike);
    const payload = buildExplainPayload(request.input, explanation);

    emitSuccess(context.outputMode, 'explain', payload, renderExplainTable);
  };
}

module.exports = {
  createRunExplainCommand,
};
