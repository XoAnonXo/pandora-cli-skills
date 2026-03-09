#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_ROOT = path.join(REPO_ROOT, 'dist');
const BUNDLE_NAME = 'pandora-skill';
const BUNDLE_ROOT = path.join(DIST_ROOT, BUNDLE_NAME);
const SOURCE_SKILL = path.join(REPO_ROOT, 'anthropic-skill-src', 'SKILL.md');
const ZIP_PATH = path.join(DIST_ROOT, `${BUNDLE_NAME}.zip`);

const SOURCE_DOCS = [
  'docs/skills/capabilities.md',
  'docs/skills/agent-quickstart.md',
  'docs/skills/agent-interfaces.md',
  'docs/skills/command-reference.md',
  'docs/skills/trading-workflows.md',
  'docs/skills/portfolio-closeout.md',
  'docs/skills/mirror-operations.md',
  'docs/skills/policy-profiles.md',
  'docs/skills/recipes.md',
  'docs/skills/legacy-launchers.md',
  'docs/trust/release-verification.md',
  'docs/trust/release-bundle-playbook.md',
  'docs/trust/security-model.md',
  'docs/trust/support-matrix.md',
  'docs/trust/operator-deployment.md',
  'docs/trust/final-readiness-signoff.md',
  'docs/benchmarks/README.md',
  'docs/benchmarks/scenario-catalog.md',
  'docs/benchmarks/scorecard.md',
  'references/creation-script.md',
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(sourcePath, destinationPath) {
  ensureDir(path.dirname(destinationPath));
  fs.copyFileSync(sourcePath, destinationPath);
}

function removePath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function relativePath(value) {
  return path.relative(REPO_ROOT, value).split(path.sep).join('/');
}

function destinationRelativePath(sourceRelativePath) {
  if (sourceRelativePath === 'docs/benchmarks/README.md') {
    return 'references/benchmarks/benchmark-overview.md';
  }
  if (sourceRelativePath.startsWith('docs/skills/')) {
    return `references/skills/${path.basename(sourceRelativePath)}`;
  }
  if (sourceRelativePath.startsWith('docs/trust/')) {
    return `references/trust/${path.basename(sourceRelativePath)}`;
  }
  if (sourceRelativePath.startsWith('docs/benchmarks/')) {
    return `references/benchmarks/${path.basename(sourceRelativePath)}`;
  }
  if (sourceRelativePath.startsWith('references/')) {
    return `references/${path.basename(sourceRelativePath)}`;
  }
  throw new Error(`Unsupported source doc path: ${sourceRelativePath}`);
}

function rewriteCopiedMarkdown(sourceRelativePath, text) {
  let next = String(text);
  if (sourceRelativePath === 'docs/skills/capabilities.md') {
    next = next.replace(/\.\.\/benchmarks\/README\.md/g, '../benchmarks/benchmark-overview.md');
  }
  if (sourceRelativePath === 'docs/benchmarks/scenario-catalog.md') {
    next = next.replace(/README\.md/g, 'benchmark-overview.md');
  }
  return next;
}

function maybeZipBundle() {
  const zipCheck = spawnSync('zip', ['-v'], { encoding: 'utf8' });
  if (zipCheck.error || zipCheck.status !== 0) {
    return { created: false, reason: 'zip command unavailable' };
  }

  removePath(ZIP_PATH);
  const result = spawnSync('zip', ['-qr', ZIP_PATH, BUNDLE_NAME], {
    cwd: DIST_ROOT,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    const message = result.error ? result.error.message : result.stderr || 'zip command failed';
    throw new Error(`Failed to create ${relativePath(ZIP_PATH)}: ${message}`);
  }
  return { created: true, reason: null };
}

function main() {
  ensureDir(DIST_ROOT);
  removePath(BUNDLE_ROOT);
  removePath(ZIP_PATH);
  ensureDir(BUNDLE_ROOT);

  copyFile(SOURCE_SKILL, path.join(BUNDLE_ROOT, 'SKILL.md'));

  for (const sourceRelative of SOURCE_DOCS) {
    const sourcePath = path.join(REPO_ROOT, sourceRelative);
    const destinationRelative = destinationRelativePath(sourceRelative);
    const destinationPath = path.join(BUNDLE_ROOT, destinationRelative);
    const raw = fs.readFileSync(sourcePath, 'utf8');
    const rewritten = rewriteCopiedMarkdown(sourceRelative, raw);
    ensureDir(path.dirname(destinationPath));
    fs.writeFileSync(destinationPath, rewritten);
  }

  const zipResult = maybeZipBundle();

  const summary = {
    ok: true,
    bundleRoot: relativePath(BUNDLE_ROOT),
    zipPath: zipResult.created ? relativePath(ZIP_PATH) : null,
    zipCreated: zipResult.created,
    filesCopied: SOURCE_DOCS.length + 1,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`build_anthropic_skill_bundle failed: ${error.message}\n`);
  process.exit(1);
}
