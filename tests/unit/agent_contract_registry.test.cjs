const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { buildCommandDescriptors, buildMcpToolDefinitions } = require('../../cli/lib/agent_contract_registry.cjs');

const CLI_ROOT = path.resolve(__dirname, '../../cli');
const EXCLUDED_FILES = new Set([
  path.resolve(CLI_ROOT, 'lib/agent_contract_registry.cjs'),
  path.resolve(CLI_ROOT, 'lib/schema_command_service.cjs'),
]);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (entry.isFile() && full.endsWith('.cjs') && !EXCLUDED_FILES.has(full)) {
      files.push(full);
    }
  }
  return files;
}

function collectEmittedHelpCommands() {
  const emitted = new Set();
  for (const file of walk(CLI_ROOT)) {
    const text = fs.readFileSync(file, 'utf8');
    const regex = /emitSuccess\([\s\S]{0,200}?["']([a-z0-9.-]+\.help)["']/g;
    let match;
    while ((match = regex.exec(text))) {
      emitted.add(match[1]);
    }
  }
  return emitted;
}

test('shared agent contract registry covers all MCP tools with canonical metadata', () => {
  const descriptors = buildCommandDescriptors();
  const mcpTools = buildMcpToolDefinitions();

  for (const tool of mcpTools) {
    const descriptor = descriptors[tool.name];
    assert.ok(descriptor, `missing descriptor for ${tool.name}`);
    assert.equal(descriptor.mcpExposed, true, `descriptor should mark ${tool.name} as MCP-exposed`);
    assert.equal(descriptor.canonicalTool, tool.canonicalTool, `canonicalTool mismatch for ${tool.name}`);
    assert.equal(descriptor.aliasOf, tool.aliasOf || null, `aliasOf mismatch for ${tool.name}`);
    assert.equal(descriptor.preferred, tool.preferred !== false, `preferred mismatch for ${tool.name}`);
    assert.equal(descriptor.mcpMutating, Boolean(tool.mutating), `mcpMutating mismatch for ${tool.name}`);
    assert.equal(
      descriptor.mcpLongRunningBlocked,
      Boolean(tool.longRunningBlocked),
      `mcpLongRunningBlocked mismatch for ${tool.name}`,
    );
    assert.equal(typeof descriptor.inputSchema, 'object', `missing inputSchema for ${tool.name}`);
  }
});

test('shared agent contract registry declares every emitted help command', () => {
  const descriptors = buildCommandDescriptors();
  const declaredHelps = new Set();
  for (const descriptor of Object.values(descriptors)) {
    for (const emit of descriptor.emits || []) {
      if (String(emit).endsWith('.help') || emit === 'help') {
        declaredHelps.add(String(emit));
      }
    }
  }

  const emittedHelps = collectEmittedHelpCommands();
  for (const helpCommand of emittedHelps) {
    assert.ok(declaredHelps.has(helpCommand), `missing emitted help contract for ${helpCommand}`);
  }
});
