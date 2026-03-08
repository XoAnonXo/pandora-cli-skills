function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function createCheck(id, passed, message) {
  return {
    id,
    passed: Boolean(passed),
    message,
  };
}

function finalizeChecks(checks) {
  const normalizedChecks = asArray(checks);
  const failed = normalizedChecks.filter((check) => !check.passed);
  if (failed.length) {
    const error = new Error(failed.map((check) => check.message).join('; '));
    error.checks = normalizedChecks;
    throw error;
  }
  return normalizedChecks;
}

function getErrorEnvelope(error) {
  if (!error) return null;
  if (asObject(error.envelope)) return error.envelope;
  if (asObject(error.details) && asObject(error.details.envelope)) return error.details.envelope;
  if (asObject(error.data) && asObject(error.data.envelope)) return error.data.envelope;
  return null;
}

function getErrorCode(error) {
  const envelope = getErrorEnvelope(error);
  const envelopeError = asObject(envelope && envelope.error);
  if (typeof (envelopeError && envelopeError.code) === 'string' && envelopeError.code.trim()) {
    return envelopeError.code.trim();
  }
  if (typeof error.code === 'string' && error.code.trim()) return error.code.trim();
  if (error.data && typeof error.data.code === 'string' && error.data.code.trim()) return error.data.code.trim();
  if (error.cause && typeof error.cause.code === 'string' && error.cause.code.trim()) return error.cause.code.trim();
  return null;
}

function assertCapabilitiesBootstrap(result) {
  const envelope = result.envelope;
  const documentation = asObject(envelope && envelope.data && envelope.data.documentation);
  const router = asObject(documentation && documentation.router);
  const registryDigest = asObject(envelope && envelope.data && envelope.data.registryDigest);
  const versionCompatibility = asObject(envelope && envelope.data && envelope.data.versionCompatibility);
  const taskRoutes = asArray(router && router.taskRoutes);
  const startHere = asArray(router && router.startHere);
  const checks = [
    createCheck('capabilities.ok', envelope && envelope.ok === true, 'expected ok=true capabilities envelope'),
    createCheck('capabilities.command', envelope && envelope.command === 'capabilities', `expected command=capabilities, received ${envelope && envelope.command}`),
    createCheck('capabilities.documentation', Boolean(documentation), 'expected documentation block'),
    createCheck('capabilities.documentation-content-hash', typeof (documentation && documentation.contentHash) === 'string' && documentation.contentHash.length > 10, 'expected documentation.contentHash'),
    createCheck('capabilities.registry-digest', Boolean(registryDigest && registryDigest.descriptorHash && registryDigest.documentationHash), 'expected registry digest with descriptor/documentation hashes'),
    createCheck('capabilities.command-descriptor-version', typeof (envelope && envelope.data && envelope.data.commandDescriptorVersion) === 'string' && envelope.data.commandDescriptorVersion.length > 0, 'expected commandDescriptorVersion'),
    createCheck('capabilities.version-compatibility', typeof (versionCompatibility && versionCompatibility.commandDescriptorVersion) === 'string' && versionCompatibility.commandDescriptorVersion.length > 0, 'expected versionCompatibility.commandDescriptorVersion'),
    createCheck('capabilities.router-start', startHere.some((route) => route && route.docId === 'agent-quickstart'), 'expected agent-quickstart in documentation.router.startHere'),
    createCheck('capabilities.router-interfaces', taskRoutes.some((route) => route && route.docId === 'agent-interfaces'), 'expected agent-interfaces in documentation.router.taskRoutes'),
    createCheck('capabilities.router-mirror', taskRoutes.some((route) => route && route.docId === 'mirror-operations'), 'expected mirror-operations in documentation.router.taskRoutes'),
  ];
  return finalizeChecks(checks);
}

function assertSchemaBootstrap(result) {
  const envelope = result.envelope;
  const data = asObject(envelope && envelope.data);
  const definitions = asObject(data && data.definitions);
  const commandDescriptors = asObject(data && data.commandDescriptors);
  const checks = [
    createCheck('schema.ok', envelope && envelope.ok === true, 'expected ok=true schema envelope'),
    createCheck('schema.command', envelope && envelope.command === 'schema', `expected command=schema, received ${envelope && envelope.command}`),
    createCheck('schema.scope', data && data.descriptorScope === 'command-surface', `expected command-surface descriptorScope, received ${data && data.descriptorScope}`),
    createCheck('schema.definitions', Boolean(definitions), 'expected schema definitions block'),
    createCheck('schema.skill-doc-index', Boolean(definitions && definitions.SkillDocIndex), 'expected SkillDocIndex definition'),
    createCheck('schema.capabilities-payload', Boolean(definitions && definitions.CapabilitiesPayload), 'expected CapabilitiesPayload definition'),
    createCheck('schema.command-descriptors', Boolean(commandDescriptors), 'expected commandDescriptors map'),
    createCheck('schema.mirror-plan-descriptor', Boolean(commandDescriptors && commandDescriptors['mirror.plan']), 'expected mirror.plan descriptor'),
    createCheck('schema.policy-list-descriptor', Boolean(commandDescriptors && commandDescriptors['policy.list']), 'expected policy.list descriptor'),
    createCheck('schema.operations-get-descriptor', Boolean(commandDescriptors && commandDescriptors['operations.get']), 'expected operations.get descriptor'),
  ];
  return finalizeChecks(checks);
}

function assertScopeDenial(result, scenario) {
  const envelope = getErrorEnvelope(result.error);
  const envelopeError = asObject(envelope && envelope.error);
  const missingScopes = asArray(envelopeError && envelopeError.details && envelopeError.details.missingScopes);
  const recovery = asObject(envelopeError && envelopeError.recovery);
  const hints = asArray(envelopeError && envelopeError.details && envelopeError.details.hints);
  const checks = [
    createCheck('scope-denial.transport-error', result.ok === false && Boolean(result.error), 'expected transport-level error for hidden out-of-scope tool'),
    createCheck('scope-denial.code', getErrorCode(result.error) === 'UNKNOWN_TOOL', `expected UNKNOWN_TOOL, received ${getErrorCode(result.error)}`),
    createCheck(
      'scope-denial.no-scope-leak',
      missingScopes.length === 0,
      'expected out-of-scope remote tool to avoid leaking missingScopes details',
    ),
    createCheck(
      'scope-denial.remediation',
      !recovery && hints.length === 0,
      'expected hidden out-of-scope remote tool to avoid leaking remediation details',
    ),
  ];
  return finalizeChecks(checks);
}

function assertExecuteIntentDenial(result) {
  const envelope = getErrorEnvelope(result.error);
  const envelopeError = asObject(envelope && envelope.error);
  const hints = asArray(envelopeError && envelopeError.details && envelopeError.details.hints);
  const beforeIds = asArray(result && result.runtimeState && result.runtimeState.before && result.runtimeState.before.operationIds);
  const afterIds = asArray(result && result.runtimeState && result.runtimeState.after && result.runtimeState.after.operationIds);
  const checks = [
    createCheck('execute-intent.transport-error', result.ok === false && Boolean(result.error), 'expected transport-level error for execute intent denial'),
    createCheck('execute-intent.code', getErrorCode(result.error) === 'MCP_EXECUTE_INTENT_REQUIRED', `expected MCP_EXECUTE_INTENT_REQUIRED, received ${getErrorCode(result.error)}`),
    createCheck('execute-intent.hints', hints.length > 0, 'expected remediation hints for execute intent denial'),
    createCheck(
      'execute-intent.no-operation-side-effects',
      JSON.stringify(beforeIds) === JSON.stringify(afterIds),
      'expected execute-intent denial before any operation state side effects',
    ),
  ];
  return finalizeChecks(checks);
}

function assertWorkspacePathDenial(result) {
  const envelope = getErrorEnvelope(result.error);
  const envelopeError = asObject(envelope && envelope.error);
  const recovery = asObject(envelopeError && envelopeError.recovery);
  const checks = [
    createCheck('workspace-denial.transport-error', result.ok === false && Boolean(result.error), 'expected transport-level error for workspace path denial'),
    createCheck('workspace-denial.code', getErrorCode(result.error) === 'MCP_FILE_ACCESS_BLOCKED', `expected MCP_FILE_ACCESS_BLOCKED, received ${getErrorCode(result.error)}`),
    createCheck('workspace-denial.recovery', typeof (recovery && recovery.command) === 'string' && recovery.command.length > 0, 'expected recovery command for workspace path denial'),
  ];
  return finalizeChecks(checks);
}

function assertToolsListBootstrap(result) {
  const envelope = result.envelope;
  const data = asObject(envelope && envelope.data);
  const tools = asArray(data && data.tools);
  const byName = new Map(tools.map((tool) => [String(tool && tool.name || ''), asObject(tool) || {}]));
  const helpTool = byName.get('help');
  const mirrorPlanTool = byName.get('mirror.plan');
  const arbitrageTool = byName.get('arbitrage');
  const checks = [
    createCheck('tools-list.ok', envelope && envelope.ok === true, 'expected ok=true tools list envelope'),
    createCheck('tools-list.command', envelope && envelope.command === 'mcp.tools.list', `expected command=mcp.tools.list, received ${envelope && envelope.command}`),
    createCheck('tools-list.items', tools.length >= 50, `expected at least 50 tools, received ${tools.length}`),
    createCheck('tools-list.help', Boolean(helpTool), 'expected help tool in MCP tool list'),
    createCheck('tools-list.mirror-plan', Boolean(mirrorPlanTool), 'expected mirror.plan in MCP tool list'),
    createCheck(
      'tools-list.help-metadata',
      Boolean(helpTool && helpTool.xPandora && Array.isArray(helpTool.policyScopes)),
      'expected normalized xPandora metadata on listed tools',
    ),
    createCheck(
      'tools-list.alias-metadata',
      Boolean(arbitrageTool && arbitrageTool.aliasOf === 'arb.scan' && arbitrageTool.canonicalTool === 'arb.scan'),
      'expected arbitrage alias metadata in tool list',
    ),
  ];
  return finalizeChecks(checks);
}

function assertOperationsEmptyList(result) {
  const envelope = result.envelope;
  const data = asObject(envelope && envelope.data);
  const items = asArray(data && data.items);
  const checks = [
    createCheck('operations-list.ok', envelope && envelope.ok === true, 'expected ok=true operations list envelope'),
    createCheck('operations-list.command', envelope && envelope.command === 'operations.list', `expected command=operations.list, received ${envelope && envelope.command}`),
    createCheck('operations-list.items', Array.isArray(items), 'expected operations.list data.items array'),
    createCheck('operations-list.empty', items.length === 0, 'expected empty operations list in isolated env'),
  ];
  return finalizeChecks(checks);
}

function assertOperationsGetSeeded(result, scenario) {
  const expectedId = String(scenario && scenario.expectedOperationId || '').trim();
  const envelope = result.envelope;
  const checks = [
    createCheck('operations-get.ok', envelope && envelope.ok === true, 'expected ok=true operations get envelope'),
    createCheck('operations-get.command', envelope && envelope.command === 'operations.get', `expected command=operations.get, received ${envelope && envelope.command}`),
    createCheck('operations-get.id', typeof (envelope && envelope.data && envelope.data.operationId) === 'string' && envelope.data.operationId === expectedId, `expected operationId=${expectedId}, received ${envelope && envelope.data && envelope.data.operationId}`),
    createCheck('operations-get.status', typeof (envelope && envelope.data && envelope.data.status) === 'string' && envelope.data.status.length > 0, 'expected operation status'),
    createCheck('operations-get.tool', typeof (envelope && envelope.data && envelope.data.tool) === 'string' && envelope.data.tool.length > 0, 'expected operation tool'),
  ];
  return finalizeChecks(checks);
}

function assertOperationsCancelSeeded(result, scenario) {
  const expectedId = String(scenario && scenario.expectedOperationId || '').trim();
  const envelope = result.envelope;
  const checks = [
    createCheck('operations-cancel.ok', envelope && envelope.ok === true, 'expected ok=true operations cancel envelope'),
    createCheck('operations-cancel.command', envelope && envelope.command === 'operations.cancel', `expected command=operations.cancel, received ${envelope && envelope.command}`),
    createCheck('operations-cancel.id', typeof (envelope && envelope.data && envelope.data.operationId) === 'string' && envelope.data.operationId === expectedId, `expected operationId=${expectedId}, received ${envelope && envelope.data && envelope.data.operationId}`),
    createCheck('operations-cancel.status', typeof (envelope && envelope.data && envelope.data.status) === 'string' && envelope.data.status === 'canceled', `expected canceled status, received ${envelope && envelope.data && envelope.data.status}`),
  ];
  return finalizeChecks(checks);
}

function assertOperationsCloseSeeded(result, scenario) {
  const expectedId = String(scenario && scenario.expectedOperationId || '').trim();
  const envelope = result.envelope;
  const checks = [
    createCheck('operations-close.ok', envelope && envelope.ok === true, 'expected ok=true operations close envelope'),
    createCheck('operations-close.command', envelope && envelope.command === 'operations.close', `expected command=operations.close, received ${envelope && envelope.command}`),
    createCheck('operations-close.id', typeof (envelope && envelope.data && envelope.data.operationId) === 'string' && envelope.data.operationId === expectedId, `expected operationId=${expectedId}, received ${envelope && envelope.data && envelope.data.operationId}`),
    createCheck('operations-close.status', typeof (envelope && envelope.data && envelope.data.status) === 'string' && envelope.data.status === 'closed', `expected closed status, received ${envelope && envelope.data && envelope.data.status}`),
  ];
  return finalizeChecks(checks);
}

const ASSERTIONS = Object.freeze({
  'capabilities-bootstrap': assertCapabilitiesBootstrap,
  'schema-bootstrap': assertSchemaBootstrap,
  'scope-denial': assertScopeDenial,
  'execute-intent-denial': assertExecuteIntentDenial,
  'workspace-path-denial': assertWorkspacePathDenial,
  'tools-list-bootstrap': assertToolsListBootstrap,
  'operations-empty-list': assertOperationsEmptyList,
  'operations-get-seeded': assertOperationsGetSeeded,
  'operations-cancel-seeded': assertOperationsCancelSeeded,
  'operations-close-seeded': assertOperationsCloseSeeded,
});

function getAssertion(id) {
  const assertion = ASSERTIONS[id];
  if (!assertion) {
    throw new Error(`Unknown benchmark assertion: ${id}`);
  }
  return assertion;
}

module.exports = {
  ASSERTIONS,
  getAssertion,
  getErrorCode,
  getErrorEnvelope,
};
