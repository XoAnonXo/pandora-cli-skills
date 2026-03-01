const fs = require('fs');

function createModelInputError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

function parseSportsModelInput(raw, sourceLabel = 'model input') {
  let payload;
  try {
    payload = JSON.parse(String(raw || ''));
  } catch {
    throw createModelInputError('INVALID_FLAG_VALUE', `${sourceLabel} must be valid JSON.`);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createModelInputError('INVALID_FLAG_VALUE', `${sourceLabel} must be a JSON object.`);
  }

  const probability = Number(payload.probability);
  if (!Number.isFinite(probability) || probability < 0.01 || probability > 0.99) {
    throw createModelInputError(
      'INVALID_FLAG_VALUE',
      `${sourceLabel} probability must be within [0.01, 0.99].`,
      { probability: payload.probability },
    );
  }

  const confidence = String(payload.confidence || '').trim();
  if (!confidence) {
    throw createModelInputError('INVALID_FLAG_VALUE', `${sourceLabel} requires confidence.`);
  }

  const source = String(payload.source || '').trim();
  if (!source) {
    throw createModelInputError('INVALID_FLAG_VALUE', `${sourceLabel} requires source.`);
  }

  return {
    probability,
    confidence,
    source,
  };
}

function loadSportsModelInput(options = {}) {
  if (options.modelFile && options.modelStdin) {
    throw createModelInputError('INVALID_ARGS', 'Use either --model-file or --model-stdin, not both.');
  }

  if (!options.modelFile && !options.modelStdin) {
    return null;
  }

  if (options.modelFile) {
    const modelFile = String(options.modelFile);
    let text;
    try {
      text = fs.readFileSync(modelFile, 'utf8');
    } catch (err) {
      throw createModelInputError('INVALID_FLAG_VALUE', `Failed to read --model-file ${modelFile}.`, {
        cause: err && err.message ? err.message : String(err),
        modelFile,
      });
    }
    return {
      ...parseSportsModelInput(text, '--model-file'),
      inputMode: 'file',
      modelFile,
    };
  }

  let text;
  try {
    text = fs.readFileSync(0, 'utf8');
  } catch (err) {
    throw createModelInputError('INVALID_FLAG_VALUE', 'Failed to read --model-stdin from stdin.', {
      cause: err && err.message ? err.message : String(err),
    });
  }
  if (!String(text || '').trim()) {
    throw createModelInputError('INVALID_FLAG_VALUE', '--model-stdin requires a JSON payload on stdin.');
  }

  return {
    ...parseSportsModelInput(text, '--model-stdin'),
    inputMode: 'stdin',
  };
}

module.exports = {
  parseSportsModelInput,
  loadSportsModelInput,
};
