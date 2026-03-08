#!/usr/bin/env node

const path = require('path');
const { buildStandaloneSdkReleaseArtifacts } = require('./sdk_release_helpers.cjs');

function parseArgs(argv) {
  const options = {
    json: false,
    outDir: path.join('dist', 'release', 'sdk'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--out-dir') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--out-dir requires a value');
      }
      options.outDir = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = buildStandaloneSdkReleaseArtifacts({ outDir: options.outDir });

  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      outDir: result.outDir,
      manifestPath: result.manifestPath,
      checksumPath: result.checksumPath,
      summary: result.summary,
    }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Standalone SDK release artifacts built.
Output: ${result.outDir}
Manifest: ${path.basename(result.manifestPath)}
Checksums: ${path.basename(result.checksumPath)}
TypeScript tarball: ${result.summary.artifacts.typescript.tarball}
Python wheel: ${result.summary.artifacts.python.wheel}
Python sdist: ${result.summary.artifacts.python.sdist}
`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
  process.exit(1);
}
