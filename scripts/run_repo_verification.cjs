#!/usr/bin/env node

const path = require('path');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const BUILD_STEP = Object.freeze({
  label: 'build',
  command: NPM_COMMAND,
  args: ['run', 'build'],
});

const POST_BUILD_STEPS = Object.freeze([
  { label: 'check:docs', command: NPM_COMMAND, args: ['run', 'check:docs'] },
  { label: 'check:anthropic-skill', command: NPM_COMMAND, args: ['run', 'check:anthropic-skill'] },
  { label: 'check:secret-scan', command: NPM_COMMAND, args: ['run', 'check:secret-scan'] },
  { label: 'check:sdk-contracts', command: NPM_COMMAND, args: ['run', 'check:sdk-contracts'] },
  { label: 'check:sdk-standalone', command: NPM_COMMAND, args: ['run', 'check:sdk-standalone'] },
]);

function runStep(step, children) {
  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: ROOT_DIR,
      env: process.env,
      shell: process.platform === 'win32',
      stdio: 'inherit',
      windowsHide: true,
    });

    children.push(child);

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const reason = signal
        ? `${step.label} terminated with signal ${signal}`
        : `${step.label} exited with status ${code}`;
      reject(new Error(reason));
    });
  });
}

async function main() {
  const children = [];
  try {
    await runStep(BUILD_STEP, children);
    await Promise.all(POST_BUILD_STEPS.map((step) => runStep(step, children)));
  } catch (error) {
    for (const child of children) {
      if (!child.killed) {
        try {
          child.kill('SIGTERM');
        } catch {
          // best effort
        }
      }
    }
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
