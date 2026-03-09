'use strict';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeKebab(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const normalized = text
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
  return normalized;
}

function normalizeInputDefinition(input, index, createError) {
  if (!isPlainObject(input)) {
    throw createError('RECIPE_INPUT_INVALID', `Recipe input at index ${index} must be an object.`, { index });
  }
  const key = normalizeKebab(input.key || input.name);
  if (!key || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
    throw createError('RECIPE_INPUT_INVALID', `Recipe input at index ${index} must define a kebab-case key.`, {
      index,
      key: input.key || input.name || null,
    });
  }
  const type = normalizeText(input.type || 'string');
  if (!['string', 'number', 'integer', 'boolean'].includes(type)) {
    throw createError('RECIPE_INPUT_INVALID', `Recipe input ${key} has unsupported type: ${type}.`, {
      index,
      key,
      type,
    });
  }
  return {
    key,
    type,
    description: normalizeText(input.description) || null,
    required: input.required !== false,
    defaultValue: Object.prototype.hasOwnProperty.call(input, 'defaultValue') ? input.defaultValue : null,
  };
}

function normalizeCommandTemplate(template, createError) {
  if (!Array.isArray(template) || !template.length) {
    throw createError('RECIPE_COMMAND_TEMPLATE_INVALID', 'Recipe commandTemplate must be a non-empty array of tokens.');
  }
  const normalized = template.map((token, index) => {
    const text = normalizeText(token);
    if (!text) {
      throw createError('RECIPE_COMMAND_TEMPLATE_INVALID', `Recipe commandTemplate token at index ${index} must be a non-empty string.`, {
        index,
      });
    }
    return text;
  });
  if (normalized[0] === 'pandora') {
    normalized.shift();
  }
  if (!normalized.length) {
    throw createError('RECIPE_COMMAND_TEMPLATE_INVALID', 'Recipe commandTemplate must contain a pandora subcommand.');
  }
  return normalized;
}

function normalizeRecipeManifest(manifest, options = {}) {
  const createError = typeof options.createError === 'function'
    ? options.createError
    : (code, message, details) => {
      const error = new Error(message);
      error.code = code;
      error.details = details || undefined;
      return error;
    };

  if (!isPlainObject(manifest)) {
    throw createError('RECIPE_MANIFEST_INVALID', 'Recipe manifest must be a JSON object.');
  }

  const schemaVersion = normalizeText(manifest.schemaVersion || '1.0.0');
  const kind = normalizeText(manifest.kind || 'recipe');
  if (kind !== 'recipe') {
    throw createError('RECIPE_MANIFEST_INVALID', `Recipe kind must be \"recipe\". Received: ${kind || '<empty>'}.`, {
      kind,
    });
  }

  const id = normalizeKebab(manifest.id);
  if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(id)) {
    throw createError('RECIPE_ID_INVALID', 'Recipe id must be kebab-case and may use dot-separated namespaces.', {
      id: manifest.id || null,
    });
  }

  const displayName = normalizeText(manifest.displayName);
  if (!displayName) {
    throw createError('RECIPE_MANIFEST_INVALID', 'Recipe displayName is required.', { id });
  }

  const description = normalizeText(manifest.description);
  if (!description) {
    throw createError('RECIPE_MANIFEST_INVALID', 'Recipe description is required.', { id });
  }

  const commandTemplate = normalizeCommandTemplate(manifest.commandTemplate, createError);
  const tool = normalizeText(manifest.tool || commandTemplate.slice(0, 2).join('.').replace(/\s+/g, '.'));
  if (!tool) {
    throw createError('RECIPE_MANIFEST_INVALID', 'Recipe tool is required.', { id });
  }

  const inputs = (Array.isArray(manifest.inputs) ? manifest.inputs : []).map((input, index) =>
    normalizeInputDefinition(input, index, createError),
  );
  const inputKeys = new Set();
  for (const input of inputs) {
    if (inputKeys.has(input.key)) {
      throw createError('RECIPE_INPUT_INVALID', `Duplicate recipe input key: ${input.key}.`, { id, key: input.key });
    }
    inputKeys.add(input.key);
  }

  const defaultPolicy = normalizeText(manifest.defaultPolicy || null);
  const defaultProfile = normalizeText(manifest.defaultProfile || null);
  const tags = Array.from(new Set((Array.isArray(manifest.tags) ? manifest.tags : [])
    .map((entry) => normalizeKebab(entry))
    .filter(Boolean)));

  const execution = isPlainObject(manifest.execution) ? manifest.execution : {};

  return {
    schemaVersion,
    kind,
    id,
    version: normalizeText(manifest.version || '1.0.0') || '1.0.0',
    displayName,
    description,
    tool,
    commandTemplate,
    inputs,
    tags,
    defaultPolicy,
    defaultProfile,
    safeByDefault: execution.safeByDefault !== false,
    operationExpected: execution.operationExpected !== false,
    mutating: execution.mutating === true,
    supportsRemote: execution.supportsRemote !== false,
    firstParty: manifest.firstParty === true,
    benchmark: normalizeText(manifest.benchmark || null),
    docs: normalizeText(manifest.docs || null),
  };
}

module.exports = {
  normalizeRecipeManifest,
};
