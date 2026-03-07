const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pkg = require(path.resolve(__dirname, '..', '..', 'package.json'));

test('package exposes pandora bin entrypoint', () => {
  assert.equal(pkg.name, 'pandora-cli-skills');
  assert.equal(pkg.bin.pandora, 'cli/pandora.cjs');
  assert.ok(pkg.scripts['test:smoke']);
  assert.ok(pkg.files.includes('cli/pandora.cjs'));
  assert.ok(pkg.files.includes('cli/lib/**'));
  assert.ok(pkg.files.includes('scripts/create_market_launcher.ts'));
  assert.ok(pkg.files.includes('scripts/create_polymarket_clone_and_bet.ts'));
  assert.ok(pkg.files.includes('docs/skills/**'));
});

test('doc router and scoped skills are present on disk', () => {
  const root = path.resolve(__dirname, '..', '..');
  const skillPath = path.join(root, 'SKILL.md');
  const commandReferencePath = path.join(root, 'docs', 'skills', 'command-reference.md');
  const capabilitiesPath = path.join(root, 'docs', 'skills', 'capabilities.md');
  const agentInterfacesPath = path.join(root, 'docs', 'skills', 'agent-interfaces.md');

  assert.equal(fs.existsSync(skillPath), true);
  assert.equal(fs.existsSync(commandReferencePath), true);
  assert.equal(fs.existsSync(capabilitiesPath), true);
  assert.equal(fs.existsSync(agentInterfacesPath), true);

  const skillText = fs.readFileSync(skillPath, 'utf8');
  const commandReferenceText = fs.readFileSync(commandReferencePath, 'utf8');
  const capabilitiesText = fs.readFileSync(capabilitiesPath, 'utf8');
  const agentInterfacesText = fs.readFileSync(agentInterfacesPath, 'utf8');
  assert.match(skillText, /pandora --output json capabilities/);
  assert.match(skillText, /docs\/skills\/command-reference\.md/);
  assert.match(skillText, /pandora mcp/);
  assert.match(commandReferenceText, /High-value command routing reference/);
  assert.match(commandReferenceText, /pandora --output json schema/);
  assert.match(commandReferenceText, /compact digest, not the full contract surface/i);
  assert.match(commandReferenceText, /pandora mcp/);
  assert.match(commandReferenceText, /sports create run/);
  assert.match(commandReferenceText, /agentPreflight/);
  assert.match(commandReferenceText, /--category/);
  assert.match(commandReferenceText, /--polymarket-rpc-url/);
  assert.match(capabilitiesText, /Agent-native integration/);
  assert.match(capabilitiesText, /capabilities/);
  assert.match(agentInterfacesText, /odds\.record/);
  assert.match(agentInterfacesText, /sports sync run\|start/);
});
