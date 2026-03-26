#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function readPackageJson() {
  return JSON.parse(readUtf8('package.json'));
}

function gitTracked(relativePath) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', relativePath], {
      cwd: ROOT_DIR,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function checkIgnoreRule(errors) {
  const gitignore = readUtf8('.gitignore');
  if (!gitignore.split(/\r?\n/).includes('/*.tgz')) {
    errors.push('Missing root tarball ignore rule in .gitignore: expected `/*.tgz`.');
  }
}

function checkTrackedReleaseArtifact(errors) {
  const artifactPath = 'pandora-market-setup-1.0.0.tgz';
  if (gitTracked(artifactPath)) {
    errors.push(`Tracked release artifact must stay out of source control: ${artifactPath}.`);
  }
}

function checkUnusedDependencyPolicy(errors) {
  const pkg = readPackageJson();
  const devDependencies = pkg.devDependencies || {};
  if (Object.prototype.hasOwnProperty.call(devDependencies, 'playwright-core')) {
    errors.push(
      'Unused root devDependency detected: `playwright-core`. ' +
      'Re-add it only when repo code or tests import it.'
    );
  }
}

function checkReleaseInfraReferences(errors) {
  const releaseWorkflow = readUtf8('.github/workflows/release.yml');
  const expectedInvocation = 'node scripts/build_benchmark_publication_manifest.cjs';
  if (!releaseWorkflow.includes(expectedInvocation)) {
    errors.push(
      'Release workflow lost the benchmark publication manifest step: ' +
      '`scripts/build_benchmark_publication_manifest.cjs` must stay wired.'
    );
  }
}

function main() {
  const errors = [];
  checkIgnoreRule(errors);
  checkTrackedReleaseArtifact(errors);
  checkUnusedDependencyPolicy(errors);
  checkReleaseInfraReferences(errors);

  if (errors.length > 0) {
    process.stderr.write(`${errors.join('\n')}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        checks: [
          'root-tarball-ignore',
          'tracked-release-artifact',
          'unused-root-dev-dependencies',
          'release-infra-script-reference',
        ],
      },
      null,
      2
    )}\n`
  );
}

main();
