'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { BUILTIN_RECIPES } = require('./shared/recipe_builtin_packs.cjs');
const { normalizeRecipeManifest } = require('./shared/recipe_schema.cjs');

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function createRecipeError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function createRecipeRegistryService(options = {}) {
  const builtins = BUILTIN_RECIPES.map((recipe) => normalizeRecipeManifest(recipe, { createError: createRecipeError }));
  const builtinMap = new Map(builtins.map((recipe) => [recipe.id, recipe]));

  function summarize(recipe, source = 'builtin', filePath = null) {
    return {
      id: recipe.id,
      version: recipe.version,
      displayName: recipe.displayName,
      description: recipe.description,
      tool: recipe.tool,
      tags: recipe.tags,
      defaultPolicy: recipe.defaultPolicy,
      defaultProfile: recipe.defaultProfile,
      safeByDefault: recipe.safeByDefault,
      operationExpected: recipe.operationExpected,
      supportsRemote: recipe.supportsRemote,
      firstParty: recipe.firstParty,
      source,
      filePath,
    };
  }

  function listRecipes() {
    return {
      count: builtins.length,
      builtinCount: builtins.length,
      userCount: 0,
      items: builtins.map((recipe) => summarize(recipe)),
      errors: [],
    };
  }

  function getRecipe(id) {
    const normalizedId = normalizeText(id);
    if (!normalizedId) return null;
    const recipe = builtinMap.get(normalizedId) || null;
    if (!recipe) return null;
    return {
      recipe,
      summary: summarize(recipe),
      source: 'builtin',
      filePath: null,
    };
  }

  function validateRecipeFile(filePath) {
    const resolved = path.resolve(String(filePath || ''));
    let document;
    try {
      document = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    } catch (error) {
      throw createRecipeError('RECIPE_FILE_INVALID', `Unable to read recipe file: ${resolved}`, {
        filePath: resolved,
        cause: error.message,
      });
    }
    const recipe = {
      ...normalizeRecipeManifest(document, { createError: createRecipeError }),
      firstParty: false,
    };
    return {
      ok: true,
      filePath: resolved,
      item: summarize(recipe, 'file', resolved),
      recipe,
    };
  }

  return {
    listRecipes,
    getRecipe,
    validateRecipeFile,
  };
}

module.exports = {
  createRecipeRegistryService,
  createRecipeError,
};
