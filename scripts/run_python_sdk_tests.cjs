#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');

function candidates() {
  return [
    process.env.PANDORA_PYTHON || null,
    'python3',
    'python',
    process.platform === 'win32' ? 'py' : null,
  ].filter(Boolean);
}

function probe(command) {
  const args = command === 'py' ? ['-3', '--version'] : ['--version'];
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0;
}

function findPython() {
  for (const command of candidates()) {
    if (probe(command)) return command;
  }
  return null;
}

const python = findPython();
if (!python) {
  console.error('Python runtime not found for sdk/python tests.');
  process.exit(1);
}

const args = python === 'py'
  ? ['-3', '-m', 'unittest', 'discover', '-s', path.join('sdk', 'python', 'tests')]
  : ['-m', 'unittest', 'discover', '-s', path.join('sdk', 'python', 'tests')];

const result = spawnSync(python, args, {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    PYTHONPATH: [
      path.join(rootDir, 'sdk', 'python'),
      process.env.PYTHONPATH || '',
    ].filter(Boolean).join(path.delimiter),
    PYTHONDONTWRITEBYTECODE: '1',
  },
});

process.exit(result.status === null ? 1 : result.status);
