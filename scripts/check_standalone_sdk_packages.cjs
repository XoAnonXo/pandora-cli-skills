#!/usr/bin/env node

const {
  runStandaloneSdkSourceChecks,
  runStandaloneSdkArtifactChecks,
} = require('./release/sdk_release_helpers.cjs');

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    sourceOnly: argv.includes('--source-only'),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = runStandaloneSdkSourceChecks();
  const artifactChecks = options.sourceOnly ? null : runStandaloneSdkArtifactChecks();
  const output = {
    ok: true,
    pythonRuntime: [result.pythonRuntime.command].concat(result.pythonRuntime.prefixArgs || []).join(' '),
    typescriptPack: result.typescriptPack,
    typescriptSmoke: result.typescriptSmoke,
    pythonSmoke: result.pythonSmoke,
    packageLocalTypescriptTests: result.packageLocalTypescriptTests,
    packageLocalPythonTests: result.packageLocalPythonTests,
    artifactChecks,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Standalone SDK checks passed.
TypeScript tarball: ${result.typescriptPack.filename} (${result.typescriptPack.fileCount} files)
TypeScript smoke: ${result.typescriptSmoke.toolCount} tools, descriptor ${result.typescriptSmoke.commandDescriptorVersion}
Python smoke: ${result.pythonSmoke.toolCount} tools, ${result.pythonSmoke.artifactCount} generated artifacts
Package-local TS tests: ok
Package-local Python tests: ok
${artifactChecks ? `Built artifact TS install smoke: ${artifactChecks.summary.artifacts.typescript.installedSmoke.toolCount} tools, typecheck ok
Built artifact Python wheel smoke: ${artifactChecks.summary.artifacts.python.installedWheelSmoke.toolCount} tools
Built artifact Python sdist smoke: ${artifactChecks.summary.artifacts.python.installedSdistSmoke.toolCount} tools
` : ''}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
  process.exit(1);
}
