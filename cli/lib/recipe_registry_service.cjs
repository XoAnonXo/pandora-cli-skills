'use strict';

const fs = require('node:fs');
const os = require('node:os');
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

function compareStableStrings(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function defaultRecipeDir(env = process.env) {
  const configured = normalizeText(env.PANDORA_RECIPE_DIR || env.PANDORA_RECIPES_DIR);
  if (configured) return configured;
  return path.join(os.homedir(), '.pandora', 'recipes');
}

function resolveRecipeDir(rootDir, env = process.env) {
  return path.resolve(expandHome(rootDir || defaultRecipeDir(env)));
}

function createRecipeRegistryService(options = {}) {
  const builtins = BUILTIN_RECIPES.map((recipe) => normalizeRecipeManifest(recipe, { createError: createRecipeError }));
  const builtinMap = new Map(builtins.map((recipe) => [recipe.id, recipe]));
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const rootDir = options.rootDir || null;

  function summarize(recipe, origin = 'builtin', filePath = null) {
    return {
      id: recipe.id,
      version: recipe.version,
      displayName: recipe.displayName,
      description: recipe.description,
      summary: recipe.summary || recipe.description,
      tool: recipe.tool,
      tags: recipe.tags,
      defaultPolicy: recipe.defaultPolicy,
      defaultProfile: recipe.defaultProfile,
      approvalStatus: recipe.approvalStatus,
      riskLevel: recipe.riskLevel,
      mutating: recipe.mutating,
      safeByDefault: recipe.safeByDefault,
      operationExpected: recipe.operationExpected,
      supportsRemote: recipe.supportsRemote,
      source: recipe.source,
      origin,
      filePath,
      docs: recipe.docs || null,
      benchmark: recipe.benchmark || null,
    };
  }

  function matchesFilter(actual, expected) {
    if (!expected || expected === 'all') return true;
    return String(actual || '').trim() === expected;
  }

  function listStoredRecipeFiles() {
    const dir = resolveRecipeDir(rootDir, env);
    if (!fs.existsSync(dir)) {
      return { dir, files: [] };
    }
    const files = fs.readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => path.join(dir, name))
      .sort(compareStableStrings);
    return { dir, files };
  }

  function loadStoredRecipes() {
    const { dir, files } = listStoredRecipeFiles();
    const items = [];
    const errors = [];
    const seenIds = new Set();
    for (const filePath of files) {
      let document;
      try {
        document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        errors.push({
          filePath,
          code: 'RECIPE_FILE_INVALID',
          message: `Unable to read recipe file: ${filePath}`,
          details: { cause: error && error.message ? error.message : String(error) },
        });
        continue;
      }
      let recipe;
      try {
        recipe = {
          ...normalizeRecipeManifest(document, { createError: createRecipeError }),
          source: 'user',
          approvalStatus: 'unreviewed',
          firstParty: false,
        };
      } catch (error) {
        errors.push({
          filePath,
          code: error && error.code ? error.code : 'RECIPE_MANIFEST_INVALID',
          message: error && error.message ? error.message : `Invalid recipe manifest: ${filePath}`,
          details: error && error.details ? error.details : null,
        });
        continue;
      }
      if (builtinMap.has(recipe.id) || seenIds.has(recipe.id)) {
        errors.push({
          filePath,
          code: 'RECIPE_ID_CONFLICT',
          message: `Stored recipe id conflicts with an existing recipe: ${recipe.id}`,
          details: { id: recipe.id },
        });
        continue;
      }
      seenIds.add(recipe.id);
      items.push({
        recipe,
        summary: summarize(recipe, 'file', filePath),
        source: recipe.source,
        origin: 'file',
        filePath,
      });
    }
    return { dir, items, errors };
  }

  function listRecipes(filters = {}) {
    const stored = loadStoredRecipes();
    const allRecipes = [
      ...builtins.map((recipe) => ({ recipe, summary: summarize(recipe), origin: 'builtin' })),
      ...stored.items,
    ];
    const items = allRecipes
      .filter(({ recipe }) =>
        matchesFilter(recipe.source, filters.source)
        && matchesFilter(recipe.approvalStatus, filters.approvalStatus)
        && matchesFilter(recipe.riskLevel, filters.riskLevel))
      .map((entry) => entry.summary || summarize(entry.recipe, entry.origin, entry.filePath || null));
    const sourceCounts = {
      'first-party': items.filter((item) => item.source === 'first-party').length,
      user: items.filter((item) => item.source === 'user').length,
    };
    const approvalStatusCounts = {
      approved: items.filter((item) => item.approvalStatus === 'approved').length,
      unreviewed: items.filter((item) => item.approvalStatus === 'unreviewed').length,
      experimental: items.filter((item) => item.approvalStatus === 'experimental').length,
      deprecated: items.filter((item) => item.approvalStatus === 'deprecated').length,
    };
    const riskLevelCounts = {
      'read-only': items.filter((item) => item.riskLevel === 'read-only').length,
      paper: items.filter((item) => item.riskLevel === 'paper').length,
      'dry-run': items.filter((item) => item.riskLevel === 'dry-run').length,
      live: items.filter((item) => item.riskLevel === 'live').length,
    };
    return {
      count: items.length,
      builtinCount: items.filter((item) => item.origin === 'builtin').length,
      userCount: sourceCounts.user,
      safeByDefaultCount: items.filter((item) => item.safeByDefault).length,
      operationExpectedCount: items.filter((item) => item.operationExpected).length,
      sourceCounts,
      approvalStatusCounts,
      riskLevelCounts,
      appliedFilters: {
        source: normalizeText(filters.source || 'all') || 'all',
        approvalStatus: normalizeText(filters.approvalStatus || 'all') || 'all',
        riskLevel: normalizeText(filters.riskLevel || 'all') || 'all',
      },
      items,
      recipeDir: stored.dir,
      errors: stored.errors,
    };
  }

  function getRecipe(id) {
    const normalizedId = normalizeText(id);
    if (!normalizedId) return null;
    const recipe = builtinMap.get(normalizedId) || null;
    if (recipe) {
      return {
        recipe,
        summary: summarize(recipe),
        source: recipe.source,
        origin: 'builtin',
        filePath: null,
      };
    }
    const stored = loadStoredRecipes();
    const entry = stored.items.find((item) => item.recipe.id === normalizedId) || null;
    if (!entry) return null;
    return {
      recipe: entry.recipe,
      summary: entry.summary,
      source: entry.source,
      origin: entry.origin,
      filePath: entry.filePath,
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
      source: 'user',
      approvalStatus: 'unreviewed',
      firstParty: false,
    };
    return {
      ok: true,
      filePath: resolved,
      item: summarize(recipe, 'file', resolved),
      recipe,
      source: recipe.source,
      origin: 'file',
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
