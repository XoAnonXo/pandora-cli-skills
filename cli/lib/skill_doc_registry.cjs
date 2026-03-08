/**
 * Shared registry for retrieval-sized skill and workflow docs.
 *
 * This registry is the machine-readable companion to SKILL.md. It lets
 * capabilities/schema expose the recommended docs for agents and provides a
 * stable surface for doc parity checks.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SKILL_DOC_INDEX_VERSION = '1.0.0';
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const SKILL_DOCS = Object.freeze([
  {
    id: 'capabilities',
    path: 'docs/skills/capabilities.md',
    title: 'Capabilities',
    summary: 'Capability map, canonical command routing, transport status, and PollCategory mapping.',
    audience: 'mixed',
    kind: 'routing',
    featured: true,
    tags: ['discovery', 'routing', 'categories', 'canonical-tools'],
    canonicalTools: ['capabilities', 'schema', 'policy.list', 'profile.list'],
  },
  {
    id: 'agent-quickstart',
    path: 'docs/skills/agent-quickstart.md',
    title: 'Agent Quickstart',
    summary: 'Fastest safe bootstrap for agents across local CLI, stdio MCP, remote MCP HTTP, and SDK consumers.',
    audience: 'agent',
    kind: 'quickstart',
    featured: true,
    tags: ['quickstart', 'mcp', 'sdk', 'policy', 'profile'],
    canonicalTools: ['capabilities', 'schema', 'policy.list', 'profile.list', 'mcp'],
  },
  {
    id: 'agent-interfaces',
    path: 'docs/skills/agent-interfaces.md',
    title: 'Agent Interfaces',
    summary: 'JSON contracts, MCP behavior, remote gateway details, operations, and machine-facing runtime semantics.',
    audience: 'agent',
    kind: 'contract',
    featured: true,
    tags: ['schema', 'mcp', 'operations', 'json', 'gateway'],
    canonicalTools: ['schema', 'capabilities', 'mcp', 'operations.get', 'operations.list'],
  },
  {
    id: 'trading-workflows',
    path: 'docs/skills/trading-workflows.md',
    title: 'Trading Workflows',
    summary: 'Canonical discover -> quote -> buy/sell -> claim workflows, plus arbitrage and fork-safe execution guidance.',
    audience: 'mixed',
    kind: 'workflow',
    featured: true,
    tags: ['trade', 'sell', 'quote', 'claim', 'arb'],
    canonicalTools: ['scan', 'quote', 'trade', 'sell', 'claim', 'arb.scan'],
  },
  {
    id: 'portfolio-closeout',
    path: 'docs/skills/portfolio-closeout.md',
    title: 'Portfolio And Closeout',
    summary: 'Portfolio inspection, history/export, LP removal, claim-all, mirror close, and operation tracking.',
    audience: 'mixed',
    kind: 'workflow',
    featured: true,
    tags: ['portfolio', 'closeout', 'lp', 'history', 'export'],
    canonicalTools: ['portfolio', 'history', 'export', 'claim', 'lp.remove', 'mirror.close'],
  },
  {
    id: 'mirror-operations',
    path: 'docs/skills/mirror-operations.md',
    title: 'Mirror Operations',
    summary: 'Mirror browse/plan/deploy/go/verify/sync/close guidance with timing, validation, and source rules.',
    audience: 'mixed',
    kind: 'workflow',
    featured: true,
    tags: ['mirror', 'deploy', 'validation', 'sync', 'closeout'],
    canonicalTools: ['mirror.browse', 'mirror.plan', 'mirror.deploy', 'mirror.go', 'mirror.verify', 'mirror.sync.once', 'mirror.close'],
  },
  {
    id: 'policy-profiles',
    path: 'docs/skills/policy-profiles.md',
    title: 'Policy And Profiles',
    summary: 'Policy pack and signer-profile discovery, validation, gateway scopes, and preferred secret-handling patterns.',
    audience: 'agent',
    kind: 'workflow',
    featured: true,
    tags: ['policy', 'profiles', 'secrets', 'gateway', 'auth'],
    canonicalTools: [
      'policy.list',
      'policy.get',
      'policy.explain',
      'policy.recommend',
      'policy.lint',
      'profile.list',
      'profile.get',
      'profile.explain',
      'profile.recommend',
      'profile.validate',
    ],
  },
  {
    id: 'recipes',
    path: 'docs/skills/recipes.md',
    title: 'Recipes',
    summary: 'First-party reusable workflows that compile to ordinary Pandora commands with policy/profile validation.',
    audience: 'agent',
    kind: 'workflow',
    featured: true,
    tags: ['recipes', 'workflow', 'operations', 'policy', 'profiles'],
    canonicalTools: ['recipe.list', 'recipe.get', 'recipe.validate', 'recipe.run'],
  },
  {
    id: 'benchmark-overview',
    path: 'docs/benchmarks/README.md',
    title: 'Benchmark Overview',
    summary: 'Public benchmark harness, suite structure, and what the score is intended to prove for agent readiness.',
    audience: 'mixed',
    kind: 'trust',
    featured: false,
    tags: ['benchmarks', 'evals', 'agent-readiness', 'parity'],
    canonicalTools: ['capabilities', 'schema'],
  },
  {
    id: 'benchmark-scenarios',
    path: 'docs/benchmarks/scenario-catalog.md',
    title: 'Benchmark Scenario Catalog',
    summary: 'Scenario-by-scenario catalog for the public agent benchmark suite and its parity groups.',
    audience: 'mixed',
    kind: 'reference',
    featured: false,
    tags: ['benchmarks', 'scenarios', 'parity', 'coverage'],
    canonicalTools: ['capabilities', 'schema'],
  },
  {
    id: 'benchmark-scorecard',
    path: 'docs/benchmarks/scorecard.md',
    title: 'Benchmark Scorecard',
    summary: 'Interpretation guide for benchmark output, weighted scoring, and parity failure groups.',
    audience: 'mixed',
    kind: 'reference',
    featured: false,
    tags: ['benchmarks', 'scorecard', 'metrics', 'quality'],
    canonicalTools: ['capabilities', 'schema'],
  },
  {
    id: 'release-verification',
    path: 'docs/trust/release-verification.md',
    title: 'Release Verification',
    summary: 'Checksum, provenance, SBOM, and cosign verification flow for packaged Pandora releases.',
    audience: 'mixed',
    kind: 'trust',
    featured: false,
    tags: ['release', 'trust', 'sbom', 'attestation', 'cosign'],
    canonicalTools: ['capabilities', 'schema'],
  },
  {
    id: 'security-model',
    path: 'docs/trust/security-model.md',
    title: 'Security Model',
    summary: 'Trust boundaries, mutation controls, secret handling, and release posture for CLI, MCP, gateway, and SDK surfaces.',
    audience: 'mixed',
    kind: 'trust',
    featured: false,
    tags: ['security', 'trust', 'mcp', 'gateway', 'secrets'],
    canonicalTools: ['capabilities', 'schema', 'mcp'],
  },
  {
    id: 'support-matrix',
    path: 'docs/trust/support-matrix.md',
    title: 'Support Matrix',
    summary: 'Support status, guarantees, and limits for local CLI, MCP transports, SDKs, benchmarks, and packaged docs.',
    audience: 'mixed',
    kind: 'trust',
    featured: false,
    tags: ['support', 'transport', 'sdk', 'trust', 'distribution'],
    canonicalTools: ['capabilities', 'schema', 'mcp'],
  },
  {
    id: 'command-reference',
    path: 'docs/skills/command-reference.md',
    title: 'Command Reference',
    summary: 'Human-oriented command and flag reference. Use capabilities/schema for machine authority.',
    audience: 'mixed',
    kind: 'reference',
    featured: true,
    tags: ['reference', 'flags', 'commands'],
    canonicalTools: ['scan', 'quote', 'trade', 'sell', 'mirror.plan', 'sports.create.plan'],
  },
  {
    id: 'legacy-launchers',
    path: 'docs/skills/legacy-launchers.md',
    title: 'Legacy Launchers',
    summary: 'Legacy launch/clone-bet script wrappers and their differences from mirror flows.',
    audience: 'operator',
    kind: 'reference',
    featured: false,
    tags: ['legacy', 'launch', 'clone-bet'],
    canonicalTools: ['launch', 'clone-bet'],
  },
]);

const ROUTER_START_HERE = Object.freeze([
  'capabilities',
  'agent-quickstart',
  'command-reference',
  'trading-workflows',
  'portfolio-closeout',
  'mirror-operations',
  'agent-interfaces',
  'policy-profiles',
  'recipes',
  'benchmark-overview',
  'release-verification',
  'security-model',
  'support-matrix',
  'legacy-launchers',
]);

const ROUTER_TASK_ROUTES = Object.freeze([
  { label: 'Discovery, scanning, and market lookup', docId: 'capabilities' },
  { label: 'First-time agent bootstrap', docId: 'agent-quickstart' },
  { label: 'Exact flags for a command family', docId: 'command-reference' },
  { label: 'Buy/sell/claim/arbitrage workflows', docId: 'trading-workflows' },
  { label: 'Portfolio inspection, LP exits, and closeout', docId: 'portfolio-closeout' },
  { label: 'Mirror deployment, verification, sync, or closeout', docId: 'mirror-operations' },
  { label: 'Agent, MCP, schema, JSON output, or recovery contracts', docId: 'agent-interfaces' },
  { label: 'Policy packs, signer profiles, or gateway scope design', docId: 'policy-profiles' },
  { label: 'Reusable workflows and safe recipe execution', docId: 'recipes' },
  { label: 'Benchmark methodology, scenarios, or scorecards', docId: 'benchmark-overview' },
  { label: 'Benchmark scenario catalog and parity coverage', docId: 'benchmark-scenarios' },
  { label: 'Benchmark weighted scoring and score interpretation', docId: 'benchmark-scorecard' },
  { label: 'Release verification, support matrix, or security posture', docId: 'release-verification' },
  { label: 'Manual market launcher scripts', docId: 'legacy-launchers' },
]);

function sortStrings(values) {
  return Array.from(new Set(Array.isArray(values) ? values : []))
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .sort(compareStableStrings);
}

function compareStableStrings(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function readRelativeFile(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function buildSkillDocsWithHashes() {
  return SKILL_DOCS.map((doc, index) => ({
    id: doc.id,
    path: doc.path,
    title: doc.title,
    summary: doc.summary,
    audience: doc.audience,
    kind: doc.kind,
    featured: Boolean(doc.featured),
    tags: sortStrings(doc.tags),
    canonicalTools: sortStrings(doc.canonicalTools),
    order: index + 1,
    contentHash: hashText(readRelativeFile(doc.path)),
  }));
}

function buildRouterEntries(routeDefinitions, docsById) {
  return routeDefinitions.map((route, index) => {
    const doc = docsById[route.docId];
    if (!doc) {
      throw new Error(`Unknown skill doc route target: ${route.docId}`);
    }

    return {
      label: route.label || doc.title,
      docId: doc.id,
      path: doc.path,
      title: doc.title,
      summary: doc.summary,
      order: index + 1,
    };
  });
}

function buildSkillDocIndex() {
  const docs = buildSkillDocsWithHashes();
  const docsById = Object.fromEntries(docs.map((doc) => [doc.id, doc]));
  const sourceFiles = ['SKILL.md'].concat(docs.map((doc) => doc.path));
  const sourceHashes = sourceFiles.map((relativePath) => ({
    path: relativePath,
    contentHash: hashText(readRelativeFile(relativePath)),
  }));
  const router = {
    title: 'Pandora CLI & Skills',
    path: 'SKILL.md',
    summary: 'Doc router that points agents and operators to the smallest scoped workflow or contract doc.',
    contentHash: sourceHashes.find((entry) => entry.path === 'SKILL.md').contentHash,
    startHere: buildRouterEntries(
      ROUTER_START_HERE.map((docId) => ({ label: docsById[docId].title, docId })),
      docsById,
    ),
    taskRoutes: buildRouterEntries(ROUTER_TASK_ROUTES, docsById),
  };

  return {
    version: SKILL_DOC_INDEX_VERSION,
    contentHash: hashText(JSON.stringify(sourceHashes)),
    sourceFiles,
    router,
    skills: docs,
  };
}

module.exports = {
  SKILL_DOC_INDEX_VERSION,
  buildSkillDocIndex,
};
