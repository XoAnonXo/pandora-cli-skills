const test = require('node:test');
const assert = require('node:assert/strict');

const { createRunExplainCommand } = require('../../cli/lib/explain_command_service.cjs');
const { createErrorRecoveryService } = require('../../cli/lib/error_recovery_service.cjs');
const { buildCommandDescriptors } = require('../../cli/lib/agent_contract_registry.cjs');
const { buildSchemaPayload } = require('../../cli/lib/schema_command_service.cjs');
const { assertSchemaValid } = require('../helpers/json_schema_assert.cjs');

class TestCliError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'TestCliError';
    this.code = code;
    this.details = details;
  }
}

function createHarness(overrides = {}) {
  const calls = [];
  const recoveryService = createErrorRecoveryService({ cliName: 'pandora' });
  const runExplainCommand = createRunExplainCommand({
    CliError: TestCliError,
    includesHelpFlag: (args) => Array.isArray(args) && (args.includes('--help') || args.includes('-h')),
    emitSuccess: (outputMode, command, data) => {
      calls.push({ outputMode, command, data });
    },
    commandHelpPayload: (usage, notes) => (Array.isArray(notes) && notes.length ? { usage, notes } : { usage }),
    getExplanationForError: recoveryService.getExplanationForError,
    readStdin: () => '',
    ...overrides,
  });
  return { calls, runExplainCommand };
}

test('explain returns machine-usable remediation for a canonical error code', async () => {
  const harness = createHarness();

  await harness.runExplainCommand(['RISK_PANIC_ACTIVE'], { outputMode: 'json' });

  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].command, 'explain');
  assert.equal(harness.calls[0].data.input.source, 'positional');
  assert.equal(harness.calls[0].data.error.code, 'RISK_PANIC_ACTIVE');
  assert.equal(harness.calls[0].data.explanation.category, 'risk');
  assert.equal(harness.calls[0].data.explanation.recovery.command, 'pandora risk show');
  assert.ok(
    harness.calls[0].data.nextCommands.some((item) => item.command === 'pandora risk show' && item.canonical === true),
  );
});

test('explain --stdin consumes a Pandora json failure envelope without extra scripting', async () => {
  const harness = createHarness({
    readStdin: () => JSON.stringify({
      ok: false,
      error: {
        code: 'MISSING_REQUIRED_FLAG',
        message: 'Missing value for --id.',
        details: {
          flag: '--id',
        },
      },
    }),
  });

  await harness.runExplainCommand(['--stdin'], { outputMode: 'json' });

  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].data.input.source, 'stdin');
  assert.equal(harness.calls[0].data.input.format, 'error-envelope');
  assert.equal(harness.calls[0].data.error.code, 'MISSING_REQUIRED_FLAG');
  assert.ok(harness.calls[0].data.nextCommands.some((item) => item.command === 'pandora help'));
});

test('explain contract is published with schema-backed machine fields', async () => {
  const harness = createHarness();
  await harness.runExplainCommand(['--code', 'POLYMARKET_PRECHECK_FAILED', '--message', 'Preflight failed'], { outputMode: 'json' });

  const descriptors = buildCommandDescriptors();
  const schemaDocument = buildSchemaPayload();
  const descriptor = descriptors.explain;
  const payload = {
    ...harness.calls[0].data,
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
  };

  assert.ok(descriptor);
  assert.equal(descriptor.dataSchema, '#/definitions/ExplainPayload');
  assert.equal(descriptor.mcpExposed, true);
  assert.equal(descriptor.inputSchema.properties.code.type, 'string');
  assert.equal(descriptor.inputSchema.properties['details-json'].type, 'string');
  assert.equal(descriptor.inputSchema.properties.stdin.type, 'boolean');
  assert.ok(schemaDocument.definitions.ExplainPayload);
  assertSchemaValid(schemaDocument, { $ref: descriptor.dataSchema }, payload, 'explain');
});
