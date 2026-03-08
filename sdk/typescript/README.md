# @pandora/agent-sdk

Alpha TypeScript/Node SDK for Pandora's agent tool surface.

## Scope
- loads the vendored generated contract catalog from `sdk/typescript/generated`
- supports local stdio MCP via `pandora mcp`
- supports remote streamable HTTP MCP via `pandora mcp http`
- exposes one generic client API for tool discovery and tool calls

## Example

```js
const {
  createLocalPandoraAgentClient,
  createRemotePandoraAgentClient,
  getPolicyProfileCapabilities,
  inspectPolicyScope,
} = require('./index.js');

async function main() {
  const local = createLocalPandoraAgentClient();
  await local.connect();
  const capabilities = await local.callTool('capabilities');
  const policyProfiles = local.getPolicyProfileCapabilities();
  await local.close();

  const remote = createRemotePandoraAgentClient({
    url: 'http://127.0.0.1:8787/mcp',
    authToken: process.env.PANDORA_MCP_TOKEN,
  });
  await remote.connect();
  const tools = await remote.listTools();
  await remote.close();

  console.log(capabilities.ok, tools.length, policyProfiles.policyPacks.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

## Policy/Profile Discovery

The SDK exposes generated capability helpers for the policy/profile area so consumers can inspect what is already declared in the contract bundle and what is still planned.

```js
const {
  createLocalPandoraAgentClient,
  getPolicyProfileCapabilities,
  listPolicyScopes,
  inspectPolicyScope,
  inspectToolPolicySurface,
} = require('./index.js');

const policyProfiles = getPolicyProfileCapabilities();
console.log(policyProfiles.policyPacks.supported, policyProfiles.policyPacks.status);

console.log(listPolicyScopes());
console.log(inspectPolicyScope('operations:read'));
console.log(inspectToolPolicySurface('trade'));

async function main() {
  const client = createLocalPandoraAgentClient();
  await client.connect();
  try {
    console.log(client.getPolicyProfileCapabilities());
    console.log(client.listSignerProfileCommands());
  } finally {
    await client.close();
  }
}
```
