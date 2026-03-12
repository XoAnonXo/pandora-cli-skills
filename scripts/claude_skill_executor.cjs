#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

function buildScenarioPrompt(payload) {
  const scenario = payload && typeof payload === 'object' ? payload : {};
  const request = String(scenario.userPrompt || scenario.prompt || '').trim();
  if (!request) return '';
  return `${request}\n\nRespond in plain text.`;
}

function main() {
  const stdin = readStdin().trim();
  if (!stdin) {
    throw new Error('Expected scenario JSON on stdin.');
  }
  const payload = JSON.parse(stdin);
  const defaultBundleRoot = path.resolve(process.cwd(), 'dist', 'pandora-skill');
  const bundleRoot = String(process.env.PANDORA_SKILL_BUNDLE_ROOT || defaultBundleRoot).trim();
  if (!fs.existsSync(bundleRoot)) {
    throw new Error(`Skill bundle root does not exist: ${bundleRoot}`);
  }

  const claudePath = String(process.env.PANDORA_CLAUDE_BIN || 'claude').trim();
  const model = String(process.env.PANDORA_SKILL_EXECUTOR_MODEL || '').trim();
  const prompt = buildScenarioPrompt(payload);
  const args = [
    '-p',
    '--output-format', 'json',
    '--permission-mode', 'dontAsk',
    '--plugin-dir', bundleRoot,
  ];
  if (model) {
    args.push('--model', model);
  }

  const result = spawnSync(claudePath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    input: prompt,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }
  if ((result.status === null ? 1 : result.status) !== 0) {
    process.stderr.write(String(result.stderr || result.stdout || '').trim());
    process.exit(result.status === null ? 1 : result.status);
  }

  const stdout = String(result.stdout || '').trim();
  if (!stdout) {
    throw new Error('Claude executor returned empty stdout.');
  }
  const parsed = JSON.parse(stdout);
  const response = {
    responseText: String(parsed.result || '').trim(),
    sessionId: parsed.session_id || null,
    durationMs: parsed.duration_ms || null,
    totalCostUsd: parsed.total_cost_usd || null,
    modelUsage: parsed.modelUsage || null,
    stopReason: parsed.stop_reason || null,
    raw: parsed,
  };
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exit(1);
}
