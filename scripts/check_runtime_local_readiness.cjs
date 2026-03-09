#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_ENV_PATH = path.join(os.homedir(), '.pandora-cli.env');
const DEFAULT_KEYSTORE_PASSWORD_PATH = path.join(os.homedir(), '.pandora', 'keys', 'dev_keystore_operator.password');

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  let envPath = DEFAULT_ENV_PATH;
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--dotenv-path' || token === '--env-file') {
      const next = args[i + 1];
      if (!next) {
        throw new Error(`${token} requires a value.`);
      }
      envPath = path.resolve(next);
      i += 1;
    }
  }
  return { envPath };
}

function parseDotEnv(content) {
  const env = {};
  for (const line of String(content || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadEnvIntoProcess(envPath) {
  if (!envPath || !fs.existsSync(envPath)) {
    return { envPath, loaded: false, keys: [], fallbackKeys: [] };
  }
  const parsed = parseDotEnv(fs.readFileSync(envPath, 'utf8'));
  const loadedKeys = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
      loadedKeys.push(key);
    }
  }
  const fallbackKeys = [];
  if (
    (process.env.PANDORA_KEYSTORE_PASSWORD === undefined || process.env.PANDORA_KEYSTORE_PASSWORD === '') &&
    (process.env.KEYSTORE_PASSWORD === undefined || process.env.KEYSTORE_PASSWORD === '') &&
    fs.existsSync(DEFAULT_KEYSTORE_PASSWORD_PATH)
  ) {
    const password = String(fs.readFileSync(DEFAULT_KEYSTORE_PASSWORD_PATH, 'utf8')).trim();
    if (password) {
      process.env.PANDORA_KEYSTORE_PASSWORD = password;
      process.env.KEYSTORE_PASSWORD = password;
      fallbackKeys.push('PANDORA_KEYSTORE_PASSWORD', 'KEYSTORE_PASSWORD');
    }
  }
  if ((process.env.PANDORA_PRIVATE_KEY === undefined || process.env.PANDORA_PRIVATE_KEY === '') && process.env.PRIVATE_KEY) {
    process.env.PANDORA_PRIVATE_KEY = process.env.PRIVATE_KEY;
    fallbackKeys.push('PANDORA_PRIVATE_KEY');
  }
  if ((process.env.PANDORA_EXTERNAL_SIGNER_URL === undefined || process.env.PANDORA_EXTERNAL_SIGNER_URL === '') && process.env.EXTERNAL_SIGNER_URL) {
    process.env.PANDORA_EXTERNAL_SIGNER_URL = process.env.EXTERNAL_SIGNER_URL;
    fallbackKeys.push('PANDORA_EXTERNAL_SIGNER_URL');
  }
  return { envPath, loaded: true, keys: loadedKeys.sort(), fallbackKeys: Array.from(new Set(fallbackKeys)).sort() };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const envLoad = loadEnvIntoProcess(options.envPath);
  const { buildCapabilitiesPayloadAsync } = require('../cli/lib/capabilities_command_service.cjs');
  const payload = await buildCapabilitiesPayloadAsync({
    artifactNeutralProfileReadiness: false,
  });
  const certification = payload && payload.certification ? payload.certification.aPlus : null;
  if (!certification) {
    throw new Error('Capabilities payload did not expose certification.aPlus.');
  }
  const output = {
    ...certification,
    helper: {
      command: 'check:final-readiness:runtime-local',
      envFile: envLoad.envPath,
      envFileLoaded: envLoad.loaded,
      envKeysLoaded: envLoad.keys,
      fallbackKeysLoaded: envLoad.fallbackKeys,
    },
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (certification.status !== 'certified') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
