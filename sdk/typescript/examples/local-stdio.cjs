'use strict';

const { connectPandoraAgentClient } = require('..');

async function main() {
  const client = await connectPandoraAgentClient({
    command: 'pandora',
    args: ['mcp'],
  });

  try {
    const capabilities = await client.callTool('capabilities');
    console.log(capabilities.command, capabilities.data.summary.totalCommands);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
