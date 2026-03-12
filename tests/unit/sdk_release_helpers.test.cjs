'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { runStandaloneSdkArtifactChecks } = require('../../scripts/release/sdk_release_helpers.cjs');

test('standalone sdk artifact checks ignore inherited npm dry-run mode', () => {
  const previousDryRun = Object.prototype.hasOwnProperty.call(process.env, 'npm_config_dry_run')
    ? process.env.npm_config_dry_run
    : undefined;
  process.env.npm_config_dry_run = 'true';

  try {
    const result = runStandaloneSdkArtifactChecks();
    assert.match(result.summary.artifacts.typescript.tarball, /\.tgz$/);
    assert.match(result.summary.artifacts.python.wheel, /\.whl$/);
    assert.match(result.summary.artifacts.python.sdist, /\.tar\.gz$/);
  } finally {
    if (previousDryRun === undefined) {
      delete process.env.npm_config_dry_run;
    } else {
      process.env.npm_config_dry_run = previousDryRun;
    }
  }
});
