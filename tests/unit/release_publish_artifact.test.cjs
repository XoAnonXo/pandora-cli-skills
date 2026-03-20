'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const packHelper = require('../../scripts/release/pack_release_tarball.cjs');
const publishHelper = require('../../scripts/release/publish_release_tarball.cjs');

test('release tarball helper resolves the default packaged tarball path', () => {
  const tarballPath = publishHelper.resolveTarballPath({});
  assert.equal(
    tarballPath,
    path.join(ROOT, 'dist', 'release', 'npm', packHelper.expectedTarballName()),
  );
});

test('release publish helper builds tarball publish args with provenance by default', () => {
  const args = publishHelper.buildPublishArgs({
    tarballPath: '/tmp/pandora-cli-skills-9.9.9.tgz',
    access: 'public',
    provenance: true,
    tag: 'latest',
    registry: 'https://registry.npmjs.org/',
    dryRun: true,
  });

  assert.deepEqual(args, [
    'publish',
    '/tmp/pandora-cli-skills-9.9.9.tgz',
    '--access',
    'public',
    '--provenance',
    '--tag',
    'latest',
    '--registry',
    'https://registry.npmjs.org/',
    '--dry-run',
  ]);
});

test('release tarball helper parses dry-run and custom destination flags', () => {
  const parsed = packHelper.parseArgs(['--dry-run', '--json', '--pack-destination', 'tmp/release']);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.json, true);
  assert.equal(parsed.destination, path.join(ROOT, 'tmp', 'release'));
});

test('release tarball helper extracts JSON from lifecycle-mixed npm pack output', () => {
  const payload = packHelper.extractPackJson([
    '> pandora-cli-skills@1.1.121 prepack',
    '> npm run prepare:publish-manifest',
    '',
    'Prepared publish-safe package.json manifest.',
    '[',
    '  {',
    '    "filename": "pandora-cli-skills-1.1.121.tgz"',
    '  }',
    ']',
  ].join('\n'));

  assert.equal(payload.trim(), '[\n  {\n    "filename": "pandora-cli-skills-1.1.121.tgz"\n  }\n]');
});
