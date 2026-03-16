#!/usr/bin/env node
'use strict';

const { execSync } = require('node:child_process');
const fs = require('node:fs');

function run(cmd) {
  return execSync(cmd, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 64,
  });
}

function hasBinaryData(buffer) {
  return buffer.includes(0x00);
}

const workspacePatterns = [
  {
    label: 'assigned private keys in tracked files',
    regexes: [
      /\bPRIVATE_KEY\b\s*[:=]\s*0x[0-9a-fA-F]{64}\b/,
      /\bPANDORA_PRIVATE_KEY\b\s*[:=]\s*0x[0-9a-fA-F]{64}\b/,
      /\bDEPLOYER_PRIVATE_KEY\b\s*[:=]\s*0x[0-9a-fA-F]{64}\b/,
      /\bPOLYMARKET_PRIVATE_KEY\b\s*[:=]\s*0x[0-9a-fA-F]{64}\b/,
    ],
    exclusions: [/^tests\//, /^output\//, /^website\/coverage\//],
  },
  {
    label: 'GitHub token-like secrets',
    regexes: [
      /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
      /\bghs_[A-Za-z0-9]{36,}\b/g,
      /\bgho_[A-Za-z0-9]{36,}\b/g,
      /\bghr_[A-Za-z0-9]{36,}\b/g,
    ],
    exclusions: [/^output\//],
  },
  {
    label: 'provider token-like secrets',
    regexes: [
      /\bsk_live_[A-Za-z0-9]{20,}\b/g,
      /\bsk_test_[A-Za-z0-9]{20,}\b/g,
      /\bAKIA[0-9A-Z]{16}\b/g,
      /\bxoxb-[0-9]{10,}-[0-9]+-[A-Za-z0-9]+\b/g,
    ],
    exclusions: [/^output\//],
  },
];

const historyPatterns = [
  '\\bPRIVATE_KEY\\s*[:=]\\s*0x[0-9a-fA-F]{64}\\b',
  '\\bPANDORA_PRIVATE_KEY\\s*[:=]\\s*0x[0-9a-fA-F]{64}\\b',
  '\\bDEPLOYER_PRIVATE_KEY\\s*[:=]\\s*0x[0-9a-fA-F]{64}\\b',
  '\\bPOLYMARKET_PRIVATE_KEY\\s*[:=]\\s*0x[0-9a-fA-F]{64}\\b',
  'gh[pousr]_[A-Za-z0-9]{36,}',
  'ghs_[A-Za-z0-9]{36,}',
  'gho_[A-Za-z0-9]{36,}',
  'ghr_[A-Za-z0-9]{36,}',
  'sk_live_[A-Za-z0-9]{20,}',
  'sk_test_[A-Za-z0-9]{20,}',
  'AKIA[0-9A-Z]{16}',
  'xoxb-[0-9]{10,}-[0-9]+-[A-Za-z0-9]+',
];

const findings = [];

const tracked = run('git ls-files').trim().split('\n').filter(Boolean);

for (const file of tracked) {
  if (!file || file === '.github/workflows/ci.yml') {
    continue;
  }
  try {
    const content = fs.readFileSync(file);
    if (hasBinaryData(content)) {
      continue;
    }
    const text = content.toString('utf8');

    for (const rule of workspacePatterns) {
      if (rule.exclusions.some((pattern) => pattern.test(file))) {
        continue;
      }

      for (const regex of rule.regexes) {
        if (regex.test(text)) {
          findings.push({
            type: 'working-tree',
            file,
            reason: rule.label,
            sample: text.match(regex)[0],
          });
        }
      }
    }
  } catch (error) {
    throw new Error(`Unable to read tracked file ${file}: ${error.message}`);
  }
}

const historyFindings = [];
for (const pattern of historyPatterns) {
  const command = `git log --all -G ${JSON.stringify(pattern)} --pretty=format:%H`;
  const output = run(command).trim();
  if (!output) {
    continue;
  }
  const commitHashes = Array.from(new Set(output.split('\n').filter(Boolean)));
  if (commitHashes.length > 0) {
    historyFindings.push({ pattern, commits: commitHashes });
  }
}

if (findings.length === 0 && historyFindings.length === 0) {
  process.stdout.write('Secret scan passed: no committed or tracked secret patterns found.\n');
  process.exit(0);
}

if (historyFindings.length > 0) {
  process.stdout.write('History scan failures (committed history contains matching secrets):\n');
  for (const entry of historyFindings) {
    process.stdout.write(`  pattern: ${entry.pattern}\n`);
    process.stdout.write(`    commits: ${entry.commits.join(', ')}\n`);
  }
  process.stdout.write('\n');
}

if (findings.length > 0) {
  process.stdout.write('Working-tree tracked-file scan failures:\n');
  for (const hit of findings) {
    process.stdout.write(`  ${hit.file}: ${hit.reason} (${hit.sample})\n`);
  }
  process.stdout.write('\n');
}

process.stdout.write('Secret scan failed.\n');
process.exit(1);
