const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

function collectTargets() {
  const targets = [
    path.join(repoRoot, 'dist'),
    path.join(repoRoot, 'output'),
  ];

  for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith('.pandora-policy-profile-mcp-')) continue;
    targets.push(path.join(repoRoot, entry.name));
  }

  return Array.from(new Set(targets));
}

function toRelative(targetPath) {
  return path.relative(repoRoot, targetPath) || '.';
}

function main() {
  const removed = [];
  for (const targetPath of collectTargets()) {
    if (!fs.existsSync(targetPath)) continue;
    removed.push(toRelative(targetPath));
    if (!dryRun) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
  }

  if (!removed.length) {
    console.log('No local artifacts found.');
    return;
  }

  for (const target of removed) {
    console.log(`${dryRun ? 'Would remove' : 'Removed'} ${target}`);
  }
}

main();
