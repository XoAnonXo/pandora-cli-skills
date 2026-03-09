'use strict';

const { connectPandoraAgentClient } = require('..');

async function main() {
  const client = await connectPandoraAgentClient({
    mode: 'remote',
    url: process.env.PANDORA_MCP_URL || 'http://127.0.0.1:8787/mcp',
    authToken: process.env.PANDORA_MCP_TOKEN || undefined,
  });

  try {
    const tools = await client.listTools();
    console.log(`connected to ${tools.length} tools`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
