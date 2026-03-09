#!/usr/bin/env node

const { buildCapabilitiesPayloadAsync } = require('../cli/lib/capabilities_command_service.cjs');

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  return {
    runtimeLocalReadiness: !args.includes('--artifact-neutral'),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const payload = await buildCapabilitiesPayloadAsync({
    artifactNeutralProfileReadiness: !options.runtimeLocalReadiness,
  });
  const certification = payload && payload.certification ? payload.certification.aPlus : null;

  if (!certification) {
    throw new Error('Capabilities payload did not expose certification.aPlus.');
  }

  process.stdout.write(`${JSON.stringify(certification, null, 2)}\n`);

  if (certification.status !== 'certified') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
