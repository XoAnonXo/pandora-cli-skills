const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const { createMcpProtocolService } = require('./mcp_protocol_service.cjs');
const { createRunMcpHttpGateway } = require('./mcp_http_gateway_service.cjs');

/**
 * Create the MCP stdio server runner for `pandora mcp`.
 * @param {{packageVersion?: string, cliPath?: string}} [options]
 * @returns {{runMcpServer: (args: string[], context: {outputMode: 'table'|'json'}) => Promise<void>}}
 */
function createRunMcpServer(options = {}) {
  const packageVersion =
    typeof options.packageVersion === 'string' && options.packageVersion.trim()
      ? options.packageVersion.trim()
      : '0.0.0';
  const protocolOptions = {
    packageVersion,
    cliPath: options.cliPath,
    asyncExecution: true,
  };
  const protocol = createMcpProtocolService(protocolOptions);
  const httpGateway = createRunMcpHttpGateway({
    packageVersion,
    cliPath: options.cliPath,
    protocolOptions,
  });

  async function runMcpServer(args, context) {
    const mcpArgs = Array.isArray(args) ? args : [];
    const isHttpGateway = mcpArgs[0] === 'http';
    const wantsHelp = mcpArgs.includes('--help') || mcpArgs.includes('-h');
    if (wantsHelp) {
      if (context && context.outputMode === 'json') {
        const usageEnvelope = {
          ok: true,
          command: 'mcp.help',
          data: {
            usage: 'pandora mcp | pandora mcp http [--host <host>] [--port <port>] [--public-base-url <url>] [--auth-token <token>|--auth-token-file <path>] [--auth-scopes <csv>]',
            notes: [
              'pandora mcp runs an MCP stdio server.',
              'pandora mcp http runs a remote streamable HTTP MCP gateway.',
              'If no auth token is provided, the gateway generates one and stores it in ~/.pandora/mcp-http/auth-token.',
              'Do not pass --output json to this command in normal MCP operation.',
            ],
          },
        };
        process.stdout.write(`${JSON.stringify(usageEnvelope, null, 2)}\n`);
      } else {
        // eslint-disable-next-line no-console
        console.log('Usage: pandora mcp');
        // eslint-disable-next-line no-console
        console.log('       pandora mcp http [--host <host>] [--port <port>] [--public-base-url <url>] [--auth-token <token>|--auth-token-file <path>] [--auth-scopes <csv>]');
        // eslint-disable-next-line no-console
        console.log('Runs Pandora as an MCP stdio server or remote streamable HTTP gateway.');
        // eslint-disable-next-line no-console
        console.log('If no auth token is provided, the HTTP gateway generates one and stores it in ~/.pandora/mcp-http/auth-token.');
      }
      return;
    }

    if (isHttpGateway) {
      await httpGateway.runMcpHttpGateway(mcpArgs.slice(1), context);
      return;
    }

    if (context && context.outputMode === 'json') {
      throw new Error('pandora mcp must be run without --output json because MCP uses raw stdio transport.');
    }

    const server = protocol.createServer();

    const transport = new StdioServerTransport(process.stdin, process.stdout);
    await server.connect(transport);

    await new Promise((resolve, reject) => {
      transport.onclose = () => resolve();
      transport.onerror = (error) => reject(error);
      server.onclose = () => resolve();
    });
  }

  return {
    runMcpServer,
  };
}

module.exports = {
  createRunMcpServer,
};
