const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const pkg = require('../../package.json');
const { createIsolatedPandoraEnv } = require('../helpers/contract_parity_assertions.cjs');
const {
  createTempDir,
  removeDir,
  run,
  ensureExitCode,
  parseJsonStdout,
} = require('../helpers/sdk_consumer_runner.cjs');

function havePython() {
  const probe = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  return probe.status === 0;
}

function readPythonPackageVersion() {
  const pyprojectText = fs.readFileSync(
    path.join(__dirname, '..', '..', 'sdk', 'python', 'pyproject.toml'),
    'utf8',
  );
  const match = pyprojectText.match(/^\s*version\s*=\s*"([^"\n]+)"\s*$/m);
  assert.ok(match, 'sdk/python/pyproject.toml is missing [project].version');
  return match[1];
}

function runPython(code, env = {}) {
  return spawnSync('python3', ['-c', code], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ...env },
  });
}

test('python sdk local client can call capabilities over stdio MCP', async (t) => {
  if (!havePython()) {
    t.skip('python3 not available');
    return;
  }
  const script = [
    "import sys",
    "sys.path.insert(0, 'sdk/python')",
    "from pandora_agent import create_local_pandora_agent_client",
    "client = create_local_pandora_agent_client(command='node', args=['cli/pandora.cjs', 'mcp'])",
    "client.connect()",
    "envelope = client.call_tool('capabilities')",
    "client.close()",
    "print(envelope['command'], envelope['ok'], envelope['data']['summary']['totalCommands'])",
  ].join('\n');
  const result = runPython(script);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /capabilities True \d+/);
});

test('python sdk exposes bootstrap helper for cold-agent startup', async (t) => {
  if (!havePython()) {
    t.skip('python3 not available');
    return;
  }
  const script = [
    "import sys",
    "sys.path.insert(0, 'sdk/python')",
    "from pandora_agent import create_local_pandora_agent_client",
    "client = create_local_pandora_agent_client(command='node', args=['cli/pandora.cjs', 'mcp'])",
    "client.connect()",
    "bootstrap = client.get_bootstrap()",
    "client.close()",
    "print(len(bootstrap['canonicalTools']) > 0, 'bootstrap' in bootstrap['recommendedBootstrapFlow'])",
  ].join('\n');
  const result = runPython(script);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /True True/);
});

test('python sdk generated helpers expose normalized package manifest and catalog override support', async (t) => {
  if (!havePython()) {
    t.skip('python3 not available');
    return;
  }
  const script = [
    "import sys",
    "sys.path.insert(0, 'sdk/python')",
    "from pandora_agent import create_local_pandora_agent_client, get_generated_artifact_path, list_generated_artifact_paths, load_generated_manifest",
    "manifest = load_generated_manifest()",
    "artifacts = list_generated_artifact_paths()",
    "client = create_local_pandora_agent_client(catalog={'capabilities': {'commandDigests': {'trade': {'policyScopes': ['trade:write'], 'requiresSecrets': True}}}, 'tools': {}})",
    "print(manifest['package']['name'], sorted(manifest['artifacts'].keys()), get_generated_artifact_path('bundle').name, client.get_command_descriptors()['trade']['requiresSecrets'])",
  ].join('\n');
  const result = runPython(script);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /pandora-agent \['bundle', 'commandDescriptors', 'mcpToolDefinitions'\] contract-registry\.json True/);
});

test('standalone python sdk installs into an isolated target and stays usable for consumers', async (t) => {
  if (!havePython()) {
    t.skip('python3 not available');
    return;
  }

  const tempRoot = createTempDir('pandora-py-sdk-consumer-');
  const installTarget = path.join(tempRoot, 'site');
  const runtimeDir = path.join(tempRoot, 'runtime');
  t.after(() => removeDir(tempRoot));

  const installResult = run('python3', ['-m', 'pip', 'install', '--no-deps', '--target', installTarget, './sdk/python'], {
    cwd: process.cwd(),
    timeoutMs: 240_000,
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
    },
  });
  ensureExitCode(installResult, 0, 'pip install --target ./sdk/python');

  const runtimeEnv = {
    ...process.env,
    ...createIsolatedPandoraEnv(runtimeDir),
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONPATH: installTarget,
  };
  const script = [
    "import json, os",
    "from importlib import metadata",
    "from pandora_agent import create_local_pandora_agent_client, load_generated_manifest, load_generated_contract_registry",
    "manifest = load_generated_manifest()",
    "registry = load_generated_contract_registry()",
    "client = create_local_pandora_agent_client(command='node', args=['cli/pandora.cjs', 'mcp'], cwd='/Users/mac/Desktop/pandora-market-setup-shareable', env=dict(os.environ))",
    "client.connect()",
    "envelope = client.call_tool('capabilities')",
    "descriptors = client.get_command_descriptors()",
    "client.close()",
    "print(json.dumps({",
    "  'installedVersion': metadata.version('pandora-agent'),",
    "  'manifestVersion': manifest['packageVersion'],",
    "  'contractPackageVersion': manifest['contractPackageVersion'],",
    "  'toolCount': len((registry or {}).get('tools', {})),",
    "  'tradePolicyScopes': descriptors['trade']['policyScopes'],",
    "  'command': envelope['command'],",
    "  'ok': envelope['ok'],",
    "  'policyStatus': envelope['data']['policyProfiles']['policyPacks']['status']",
    "}))",
  ].join('\n');
  const consumerRun = run('python3', ['-c', script], {
    cwd: process.cwd(),
    env: runtimeEnv,
    timeoutMs: 120_000,
  });
  ensureExitCode(consumerRun, 0, 'standalone python sdk consumer run');
  const payload = parseJsonStdout(consumerRun, 'standalone python sdk consumer run');

  assert.equal(payload.installedVersion, readPythonPackageVersion());
  assert.equal(payload.manifestVersion, readPythonPackageVersion());
  assert.equal(payload.contractPackageVersion, pkg.version);
  assert.ok(payload.toolCount > 0);
  assert.equal(payload.command, 'capabilities');
  assert.equal(payload.ok, true);
  assert.equal(payload.policyStatus, 'alpha');
  assert.ok(Array.isArray(payload.tradePolicyScopes));
  assert.ok(payload.tradePolicyScopes.includes('secrets:use'));
});

test('python sdk allows forward-compatible unknown tools and raises on failure envelopes', async (t) => {
  if (!havePython()) {
    t.skip('python3 not available');
    return;
  }
  const script = [
    "import sys",
    "sys.path.insert(0, 'sdk/python')",
    "from pandora_agent.client import PandoraAgentClient",
    "from pandora_agent.errors import PandoraSdkError",
    "class Backend:",
    "    def connect(self): pass",
    "    def close(self): pass",
    "    def list_tools(self): return []",
    "    def call_tool(self, name, args=None):",
    "        if name == 'future.tool':",
    "            return {'structuredContent': {'ok': True, 'command': name, 'data': {'echo': True}}}",
    "        return {'structuredContent': {'ok': False, 'error': {'code': 'NOPE', 'message': 'failed'}}}",
    "client = PandoraAgentClient(Backend(), catalog={'tools': {}})",
    "ok = client.call_tool('future.tool')",
    "print(ok['command'], ok['ok'])",
    "try:",
    "    client.call_tool('broken.tool')",
    "except PandoraSdkError as error:",
    "    print(error.code, str(error))",
  ].join('\n');
  const result = runPython(script);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /future\.tool True/);
  assert.match(result.stdout, /NOPE failed/);
});

test('python sdk wraps invalid JSON text results in a stable sdk error', async (t) => {
  if (!havePython()) {
    t.skip('python3 not available');
    return;
  }
  const script = [
    "import sys",
    "sys.path.insert(0, 'sdk/python')",
    "from pandora_agent.backends import normalize_tool_envelope",
    "from pandora_agent.errors import PandoraSdkError",
    "try:",
    "    normalize_tool_envelope({'content': [{'type': 'text', 'text': 'not-json'}]})",
    "except PandoraSdkError as error:",
    "    print(error.code)",
  ].join('\n');
  const result = runPython(script);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout.trim(), /^PANDORA_SDK_INVALID_TOOL_RESULT$/);
});

test('python sdk rejects non-object JSON tool payloads', async (t) => {
  if (!havePython()) {
    t.skip('python3 not available');
    return;
  }
  const script = [
    "import sys",
    "sys.path.insert(0, 'sdk/python')",
    "from pandora_agent.backends import normalize_tool_envelope",
    "from pandora_agent.errors import PandoraSdkError",
    "try:",
    "    normalize_tool_envelope({'content': [{'type': 'text', 'text': '[1,2,3]'}]})",
    "except PandoraSdkError as error:",
    "    print(error.code)",
  ].join('\n');
  const result = runPython(script);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout.trim(), /^PANDORA_SDK_INVALID_TOOL_RESULT$/);
});

test('python sdk remote client can call capabilities over HTTP MCP', async (t) => {
  if (!havePython()) {
    t.skip('python3 not available');
    return;
  }
  const port = 8799;
  const gateway = spawn('node', ['cli/pandora.cjs', 'mcp', 'http', '--host', '127.0.0.1', '--port', String(port), '--auth-token', 'sdkpy'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const script = [
    "import sys",
    "sys.path.insert(0, 'sdk/python')",
    "from pandora_agent import create_remote_pandora_agent_client",
    `client = create_remote_pandora_agent_client(url='http://127.0.0.1:${port}/mcp', auth_token='sdkpy')`,
    "client.connect()",
    "envelope = client.call_tool('capabilities')",
    "client.close()",
    "print(envelope['command'], envelope['ok'], envelope['data']['summary']['totalCommands'])",
  ].join('; ');
  const result = runPython(script);
  gateway.kill('SIGTERM');
  await new Promise((resolve) => gateway.once('close', resolve));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /capabilities True \d+/);
});

test('python sdk generated policy profiles match capabilities from local and remote MCP', async (t) => {
  if (!havePython()) {
    t.skip('python3 not available');
    return;
  }
  const port = 8800;
  const gateway = spawn('node', ['cli/pandora.cjs', 'mcp', 'http', '--host', '127.0.0.1', '--port', String(port), '--auth-token', 'sdkpy'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const script = [
    "import json, sys",
    "sys.path.insert(0, 'sdk/python')",
    "from pandora_agent import create_local_pandora_agent_client, create_remote_pandora_agent_client, load_generated_capabilities",
    "generated = load_generated_capabilities()['policyProfiles']",
    "local = create_local_pandora_agent_client(command='node', args=['cli/pandora.cjs', 'mcp'])",
    "local.connect()",
    "local_caps = local.call_tool('capabilities')['data']['policyProfiles']",
    "local.close()",
    `remote = create_remote_pandora_agent_client(url='http://127.0.0.1:${port}/mcp', auth_token='sdkpy')`,
    "remote.connect()",
    "remote_caps = remote.call_tool('capabilities')['data']['policyProfiles']",
    "remote.close()",
    "print(json.dumps([generated == local_caps, generated == remote_caps]))",
  ].join('; ');
  const result = runPython(script);
  gateway.kill('SIGTERM');
  await new Promise((resolve) => gateway.once('close', resolve));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout.trim(), /^\[true, true\]$/);
});

test('python sdk list_tools normalizes runtime xPandora metadata for consumers', async (t) => {
  if (!havePython()) {
    t.skip('python3 not available');
    return;
  }
  const script = [
    "import sys",
    "sys.path.insert(0, 'sdk/python')",
    "from pandora_agent.client import PandoraAgentClient",
    "catalog = {'commandDescriptors': {'capabilities': {'canonicalTool': 'capabilities', 'policyScopes': ['capabilities:read'], 'supportsRemote': True, 'remoteEligible': True}}, 'tools': {}}",
    "class Backend:",
    "    def connect(self): pass",
    "    def close(self): pass",
    "    def list_tools(self):",
    "        return [{'name': 'capabilities', 'description': 'Capabilities', 'inputSchema': {}}]",
    "    def call_tool(self, name, args=None):",
    "        raise AssertionError('call_tool should not be used')",
    "client = PandoraAgentClient(Backend(), catalog=catalog)",
    "tool = client.list_tools()[0]",
    "print(tool['name'], tool['supportsRemote'], tool['remoteEligible'], tool['policyScopes'], tool['xPandora']['canonicalTool'])",
  ].join('\n');
  const result = runPython(script);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /capabilities True True \['capabilities:read'\] capabilities/);
});

test('python sdk rejects conflicting auth_token and Authorization headers', async (t) => {
  if (!havePython()) {
    t.skip('python3 not available');
    return;
  }
  const script = [
    "import sys",
    "sys.path.insert(0, 'sdk/python')",
    "from pandora_agent import create_remote_pandora_agent_client",
    "from pandora_agent.errors import PandoraSdkError",
    "try:",
    "    create_remote_pandora_agent_client(url='http://127.0.0.1:9999/mcp', auth_token='one', headers={'authorization': 'Bearer two'})",
    "except PandoraSdkError as error:",
    "    print(error.code)",
  ].join('\n');
  const result = runPython(script);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout.trim(), /^PANDORA_SDK_INVALID_REMOTE_CONFIG$/);
});
