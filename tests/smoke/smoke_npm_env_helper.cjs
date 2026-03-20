'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const EMPTY_NPMRC_PATH = path.join(os.tmpdir(), 'pandora-public-smoke.npmrc');
const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org/';

function ensureEmptyUserConfig() {
  if (!fs.existsSync(EMPTY_NPMRC_PATH)) {
    fs.writeFileSync(EMPTY_NPMRC_PATH, '# pandora smoke test npm config\n', 'utf8');
  }
  return EMPTY_NPMRC_PATH;
}

function buildPublicNpmEnv(baseEnv = process.env) {
  const env = {
    ...baseEnv,
    npm_config_registry: PUBLIC_NPM_REGISTRY,
    NPM_CONFIG_REGISTRY: PUBLIC_NPM_REGISTRY,
    npm_config_userconfig: ensureEmptyUserConfig(),
    NPM_CONFIG_USERCONFIG: ensureEmptyUserConfig(),
  };

  delete env.NODE_AUTH_TOKEN;
  delete env.NPM_TOKEN;

  for (const key of Object.keys(env)) {
    if (/^npm_config_.*auth/i.test(key) || /^NPM_CONFIG_.*AUTH/i.test(key)) {
      delete env[key];
    }
  }

  return env;
}

module.exports = {
  EMPTY_NPMRC_PATH,
  PUBLIC_NPM_REGISTRY,
  buildPublicNpmEnv,
};
