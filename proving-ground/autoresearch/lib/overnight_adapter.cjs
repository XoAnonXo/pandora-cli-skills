const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  createFingerprint,
  normalizeText,
  resolveRepoPath,
} = require('./baton_common.cjs');
const { readYamlFile } = require('./overnight_yaml.cjs');
const { DEFAULT_WINDOW_LINE_CAP, normalizeProposalMode } = require('./overnight_staged.cjs');

const DEFAULT_REPORT_DIR = 'proving-ground/autoresearch/reports/overnight';
const DEFAULT_BRANCH_PREFIX = 'codex/overnight';
const DEFAULT_ATTEMPT_LIMIT = 1;
const DEFAULT_REPAIR_TURNS = 1;
const DEFAULT_MAX_PARALLEL_WORKERS = 1;

function normalizeStagedDefaults(value = {}) {
  const document = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    maxSourceFiles: Math.max(1, Number(document.max_source_files || document.maxSourceFiles) || 1),
    maxTestFiles: Math.max(1, Number(document.max_test_files || document.maxTestFiles) || 1),
    maxCodeBlocks: Math.max(1, Number(document.max_code_blocks || document.maxCodeBlocks) || 1),
    maxTestBlocks: Math.max(1, Number(document.max_test_blocks || document.maxTestBlocks) || 1),
    windowLineCap: Math.max(20, Number(document.window_line_cap || document.windowLineCap) || DEFAULT_WINDOW_LINE_CAP),
  };
}

function normalizeStringList(value, fieldName, options = {}) {
  const required = options.required === true;
  const list = Array.isArray(value)
    ? value.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
  if (required && list.length === 0) {
    throw new Error(`${fieldName} must contain at least one entry`);
  }
  return list;
}

function normalizeRisk(value, fieldName) {
  const risk = normalizeText(value).toLowerCase() || 'guarded';
  if (!['safe', 'guarded', 'manual'].includes(risk)) {
    throw new Error(`${fieldName} must be one of safe, guarded, or manual`);
  }
  return risk;
}

function normalizeCommandList(value, fieldName, options = {}) {
  const commands = normalizeStringList(value, fieldName, options);
  commands.forEach((command) => {
    if (!command) {
      throw new Error(`${fieldName} must not include empty commands`);
    }
  });
  return commands;
}

function globToRegex(pattern) {
  const escaped = String(pattern)
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesPathPattern(filePath, pattern) {
  const normalizedPath = String(filePath || '').split(path.sep).join('/');
  const normalizedPattern = String(pattern || '').split(path.sep).join('/');
  if (!normalizedPattern) {
    return false;
  }
  if (!normalizedPattern.includes('*')) {
    return normalizedPath === normalizedPattern;
  }
  return globToRegex(normalizedPattern).test(normalizedPath);
}

function normalizeModelConfig(value = {}, fallbackProvider) {
  const document = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    provider: normalizeText(document.provider) || fallbackProvider,
    model: normalizeText(document.model),
    apiKeyEnv: normalizeText(document.api_key_env || document.apiKeyEnv),
    baseUrl: normalizeText(document.base_url || document.baseUrl),
    timeoutMs: Number.isFinite(Number(document.timeout_ms || document.timeoutMs))
      ? Math.max(1000, Number(document.timeout_ms || document.timeoutMs))
      : null,
    temperature: Number.isFinite(Number(document.temperature))
      ? Number(document.temperature)
      : null,
    minIntervalMs: Number.isFinite(Number(document.min_interval_ms || document.minIntervalMs))
      ? Math.max(0, Number(document.min_interval_ms || document.minIntervalMs))
      : null,
    rateLimitStateDir: normalizeText(document.rate_limit_state_dir || document.rateLimitStateDir),
  };
}

function normalizeSurface(document, repoRoot, index) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`surfaces[${index}] must be an object`);
  }
  const id = normalizeText(document.id);
  if (!id) {
    throw new Error(`surfaces[${index}].id is required`);
  }
  const paths = normalizeStringList(document.paths, `surfaces[${index}].paths`, { required: true });
  const testPaths = normalizeStringList(document.test_paths || document.testPaths, `surfaces[${index}].test_paths`, { required: true });
  const invariants = normalizeStringList(document.invariants, `surfaces[${index}].invariants`, { required: true });
  const forbiddenPaths = normalizeStringList(document.forbidden_paths || document.forbiddenPaths, `surfaces[${index}].forbidden_paths`);
  const contextPatterns = normalizeStringList(document.context_patterns || document.contextPatterns, `surfaces[${index}].context_patterns`);
  const allowedDependencies = normalizeStringList(document.allowed_dependencies || document.allowedDependencies, `surfaces[${index}].allowed_dependencies`);
  const requiredTestKinds = normalizeStringList(document.required_test_kinds || document.requiredTestKinds, `surfaces[${index}].required_test_kinds`);
  const quickValidation = normalizeCommandList(document.quick_validation || document.quickValidation, `surfaces[${index}].quick_validation`);
  const fullValidation = normalizeCommandList(document.full_validation || document.fullValidation, `surfaces[${index}].full_validation`);

  for (const filePath of paths.concat(testPaths).concat(forbiddenPaths).concat(contextPatterns)) {
    if (filePath.includes('*')) {
      continue;
    }
    resolveRepoPath(repoRoot, filePath);
  }

  return {
    id,
    title: normalizeText(document.title) || id,
    description: normalizeText(document.description),
    paths,
    testPaths,
    invariants,
    risk: normalizeRisk(document.risk, `surfaces[${index}].risk`),
    requiredTestKinds,
    contextPatterns,
    allowedDependencies,
    forbiddenPaths,
    quickValidation,
    fullValidation,
    fingerprint: createFingerprint({
      id,
      paths,
      testPaths,
      invariants,
      risk: normalizeRisk(document.risk, `surfaces[${index}].risk`),
    }),
  };
}

function normalizeAdapterDocument(document, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const repo = document.repo && typeof document.repo === 'object' ? document.repo : {};
  const defaults = document.defaults && typeof document.defaults === 'object' ? document.defaults : {};
  const surfaces = Array.isArray(document.surfaces) ? document.surfaces : [];
  if (surfaces.length === 0) {
    throw new Error('surfaces must contain at least one surface');
  }

  const normalizedSurfaces = surfaces.map((surface, index) => normalizeSurface(surface, repoRoot, index));
  const ids = new Set();
  normalizedSurfaces.forEach((surface) => {
    if (ids.has(surface.id)) {
      throw new Error(`surface id must be unique: ${surface.id}`);
    }
    ids.add(surface.id);
  });

  return {
    schemaVersion: normalizeText(document.schema_version || document.schemaVersion) || '1.0.0',
    repoRoot,
    repo: {
      name: normalizeText(repo.name) || path.basename(repoRoot),
      setup: normalizeText(repo.setup),
      baselineValidation: normalizeCommandList(repo.baseline_validation || repo.baselineValidation, 'repo.baseline_validation', { required: true }),
      finalValidation: normalizeCommandList(repo.final_validation || repo.finalValidation, 'repo.final_validation', { required: true }),
    },
    surfaces: normalizedSurfaces,
    manualOnlyPaths: normalizeStringList(document.manual_only_paths || document.manualOnlyPaths, 'manual_only_paths'),
    sharedPaths: normalizeStringList(document.shared_paths || document.sharedPaths, 'shared_paths'),
    defaults: {
      reportDir: normalizeText(defaults.report_dir || defaults.reportDir) || DEFAULT_REPORT_DIR,
      branchPrefix: normalizeText(defaults.branch_prefix || defaults.branchPrefix) || DEFAULT_BRANCH_PREFIX,
      attemptLimit: Math.max(1, Number(defaults.attempt_limit || defaults.attemptLimit) || DEFAULT_ATTEMPT_LIMIT),
      maxParallelWorkers: Math.max(1, Number(defaults.max_parallel_workers || defaults.maxParallelWorkers) || DEFAULT_MAX_PARALLEL_WORKERS),
      repairTurns: Math.max(0, Number(defaults.repair_turns || defaults.repairTurns) || DEFAULT_REPAIR_TURNS),
      proposalMode: normalizeProposalMode(defaults.proposal_mode || defaults.proposalMode || 'legacy'),
      staged: normalizeStagedDefaults(defaults.staged),
      proposer: normalizeModelConfig(defaults.proposer, 'minimax'),
      audit: normalizeModelConfig(defaults.audit, 'auto'),
    },
  };
}

function loadOvernightAdapter(adapterPath, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const resolvedPath = path.resolve(repoRoot, adapterPath || 'proving-ground/autoresearch/overnight.yaml');
  const loaded = readYamlFile(resolvedPath);
  const adapter = normalizeAdapterDocument(loaded.document, { repoRoot });
  return {
    ...adapter,
    sourcePath: resolvedPath,
  };
}

function findSurface(adapter, surfaceId) {
  return Array.isArray(adapter && adapter.surfaces)
    ? adapter.surfaces.find((surface) => surface.id === surfaceId) || null
    : null;
}

function listTrackedFiles(repoRoot) {
  const output = execFileSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return output
    .split('\n')
    .map((line) => normalizeText(line))
    .filter(Boolean);
}

function resolvePatternMatches(adapter, patterns) {
  const files = listTrackedFiles(adapter.repoRoot);
  const results = [];
  const seen = new Set();
  for (const pattern of normalizeStringList(patterns, 'patterns')) {
    for (const filePath of files) {
      if (!matchesPathPattern(filePath, pattern)) {
        continue;
      }
      if (seen.has(filePath)) {
        continue;
      }
      seen.add(filePath);
      results.push(filePath);
    }
  }
  return results;
}

function isPathAllowedForSurface(adapter, surface, relativePath, options = {}) {
  const normalizedPath = String(relativePath || '').split(path.sep).join('/');
  if (!normalizedPath) {
    return false;
  }
  const candidates = options.includeTests === false
    ? surface.paths.concat(adapter.sharedPaths)
    : surface.paths.concat(surface.testPaths).concat(adapter.sharedPaths);
  return candidates.some((pattern) => matchesPathPattern(normalizedPath, pattern));
}

function isManualOnlyPath(adapter, relativePath) {
  const normalizedPath = String(relativePath || '').split(path.sep).join('/');
  return adapter.manualOnlyPaths.some((pattern) => matchesPathPattern(normalizedPath, pattern));
}

function isForbiddenPath(surface, relativePath) {
  const normalizedPath = String(relativePath || '').split(path.sep).join('/');
  return surface.forbiddenPaths.some((pattern) => matchesPathPattern(normalizedPath, pattern));
}

function buildStarterAdapter(repoRoot) {
  const files = listTrackedFiles(repoRoot);
  const topDirs = Array.from(new Set(files.map((entry) => entry.split('/')[0]).filter(Boolean))).sort();
  const testDirs = topDirs.filter((entry) => /test/i.test(entry));
  return {
    repo: {
      name: path.basename(repoRoot),
      setup: 'npm install',
      baseline_validation: [],
      final_validation: [],
    },
    surfaces: [
      {
        id: 'core',
        title: 'Core Surface',
        description: 'Replace this with the first real mutable area in the repo.',
        paths: [],
        test_paths: [],
        invariants: [
          'Fill in the architectural rules this surface must not break.',
        ],
        risk: 'guarded',
        required_test_kinds: [
          'regression',
        ],
        context_patterns: [],
        allowed_dependencies: [],
        forbidden_paths: [],
      },
    ],
    manual_only_paths: [
      '.github/**',
      'infra/**',
      'migrations/**',
    ],
    shared_paths: [],
    defaults: {
      report_dir: DEFAULT_REPORT_DIR,
      branch_prefix: DEFAULT_BRANCH_PREFIX,
      attempt_limit: DEFAULT_ATTEMPT_LIMIT,
      repair_turns: DEFAULT_REPAIR_TURNS,
      proposal_mode: 'legacy',
      staged: {
        max_source_files: 1,
        max_test_files: 1,
        max_code_blocks: 1,
        max_test_blocks: 1,
        window_line_cap: DEFAULT_WINDOW_LINE_CAP,
      },
      proposer: {
        provider: 'minimax',
        model: 'MiniMax-M2.7-highspeed',
        api_key_env: 'MINIMAX_API_KEY',
      },
      audit: {
        provider: 'auto',
      },
      repo_scan_hint: {
        top_level_dirs: topDirs,
        likely_test_dirs: testDirs,
      },
    },
  };
}

module.exports = {
  buildStarterAdapter,
  findSurface,
  isForbiddenPath,
  isManualOnlyPath,
  isPathAllowedForSurface,
  listTrackedFiles,
  loadOvernightAdapter,
  matchesPathPattern,
  normalizeAdapterDocument,
  resolvePatternMatches,
};
