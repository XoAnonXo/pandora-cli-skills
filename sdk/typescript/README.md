# @thisispandora/agent-sdk

Standalone alpha TypeScript/Node SDK for Pandora's MCP tool interface and generated contract catalog.

## Status and delivery
- primary package identity: `@thisispandora/agent-sdk`
- generated artifacts ship package-locally under `@thisispandora/agent-sdk/generated`
- current external distribution path: signed GitHub release asset tarball for the tagged Pandora release
- repository checkout path: `sdk/typescript` is for maintainers and in-tree development only
- the Pandora CLI package also vendors a matching copy under `sdk/typescript` and `pandora-cli-skills/sdk/typescript` for parity and in-tree consumers
- public npm publication is not claimed by this README until a release explicitly says so

## What it exposes
- local stdio MCP execution via `pandora mcp`
- remote streamable HTTP MCP execution via `pandora mcp http`
- one generic client surface for tool discovery and tool calls
- first-class bootstrap helpers so cold agents can start from Pandora's canonical bootstrap contract
- generated catalog helpers for policy/profile and contract inspection
- both CommonJS and native Node ESM entrypoints

## Install and access

Current validated install paths:

Preferred for external consumers:

```bash
npm install /path/to/downloaded/thisispandora-agent-sdk-<version>.tgz
```

Maintainer and repository-checkout flows:

```bash
npm install ./sdk/typescript
```

Or build a local tarball from source:

```bash
npm pack ./sdk/typescript
```

Use the signed GitHub release tarball when working outside the repository. Use the repo path only when you intentionally want an in-tree checkout.

Node `>=18` is required.

Useful package subpaths:

```text
@thisispandora/agent-sdk
@thisispandora/agent-sdk/generated
@thisispandora/agent-sdk/generated/manifest
@thisispandora/agent-sdk/generated/command-descriptors
@thisispandora/agent-sdk/generated/mcp-tool-definitions
@thisispandora/agent-sdk/generated/contract-registry
```

Native ESM is supported for the root package and the generated subpaths above.

Vendored equivalent inside the Pandora CLI package:
- `pandora-cli-skills/sdk/typescript`
- `pandora-cli-skills/sdk/generated`

## Quick start

Cold agents should start with `bootstrap`, not with low-level `capabilities` or `schema` calls.

```js
const {
  connectPandoraAgentClient,
  loadGeneratedManifest,
} = require('@thisispandora/agent-sdk');

async function main() {
  const client = await connectPandoraAgentClient({
    command: 'pandora',
    args: ['mcp'],
  });

  try {
    const bootstrap = await client.getBootstrap();
    const manifest = loadGeneratedManifest();
    console.log(bootstrap.recommendedBootstrapFlow[0], manifest.commandDescriptorVersion);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

### Native ESM quick start

```js
import { connectPandoraAgentClient, loadGeneratedManifest } from '@thisispandora/agent-sdk';

const client = await connectPandoraAgentClient({
  command: 'pandora',
  args: ['mcp'],
});

try {
  const bootstrap = await client.getBootstrap();
  const manifest = loadGeneratedManifest();
  console.log(bootstrap.recommendedBootstrapFlow[0], manifest.commandDescriptorVersion);
} finally {
  await client.close();
}
```

## Local vs remote backends

Use the generic client factory when you want one entrypoint:

```js
const {
  createPandoraAgentClient,
} = require('@thisispandora/agent-sdk');

const localClient = createPandoraAgentClient({
  command: 'pandora',
  args: ['mcp'],
});

const remoteClient = createPandoraAgentClient({
  mode: 'remote',
  url: 'http://127.0.0.1:8787/mcp',
  authToken: process.env.PANDORA_MCP_TOKEN,
});
```

Backend mapping:
- local backend:
  - start `pandora mcp`
  - connect over stdio on the same machine
  - no bearer token is involved
- remote backend:
  - intentionally host `pandora mcp http ...`
  - connect to the `/mcp` endpoint with a bearer token
  - signer material, if any, stays on the gateway runtime

## Generated catalog access

The root entrypoint already exports the generated helpers:

```js
const {
  loadGeneratedContractRegistry,
  loadGeneratedCapabilities,
  inspectToolPolicySurface,
} = require('@thisispandora/agent-sdk');

const registry = loadGeneratedContractRegistry();
const capabilities = loadGeneratedCapabilities();
const trade = inspectToolPolicySurface('trade', registry);

console.log(capabilities.commandDescriptorVersion);
console.log(trade.policyScopes);
```

If you want the canonical bootstrap payload directly:

```js
const { connectPandoraAgentClient } = require('@thisispandora/agent-sdk');

async function main() {
  const client = await connectPandoraAgentClient({
    mode: 'remote',
    url: 'http://127.0.0.1:8787/mcp',
    authToken: process.env.PANDORA_MCP_TOKEN,
  });

  try {
    const bootstrap = await client.getBootstrap();
    console.log(bootstrap.canonicalTools.length);
  } finally {
    await client.close();
  }
}
```

If you want the raw generated bundle:

```js
const generated = require('@thisispandora/agent-sdk/generated');

console.log(generated.manifest.packageVersion);
console.log(Object.keys(generated.contractRegistry.tools).length);
```

Native ESM can also import those generated subpaths directly:

```js
import manifest from '@thisispandora/agent-sdk/generated/manifest';
import contractRegistry from '@thisispandora/agent-sdk/generated/contract-registry';

console.log(manifest.packageVersion);
console.log(Object.keys(contractRegistry.tools).length);
```

## Error handling

```js
const {
  PandoraSdkError,
  PandoraToolCallError,
} = require('@thisispandora/agent-sdk');

try {
  // tool call
} catch (error) {
  if (error instanceof PandoraToolCallError) {
    console.error(error.code, error.toolName, error.toolError);
  } else if (error instanceof PandoraSdkError) {
    console.error(error.code, error.details);
  } else {
    throw error;
  }
}
```

## Current boundaries
- this SDK does not bundle the Pandora CLI itself; local stdio usage still needs a `pandora` executable or an explicit `command`/`args` pair
- remote HTTP usage still requires an operator-hosted `pandora mcp http` gateway and any required bearer token
- repository checkouts can regenerate the vendored bundle with `npm run generate:sdk-contracts`
- the Pandora CLI package vendors a matching copy under `sdk/typescript`, but the standalone package is the primary SDK product surface
