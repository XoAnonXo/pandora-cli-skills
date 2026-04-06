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
  const baseProtocolOptions = {
    packageVersion,
    cliPath: options.cliPath,
    asyncExecution: true,
  };
  const httpGateway = createRunMcpHttpGateway({
    packageVersion,
    cliPath: options.cliPath,
    protocolOptions: baseProtocolOptions,
  });

  async function runMcpServer(args, context) {
    const mcpArgs = Array.isArray(args) ? args : [];
    const isHttpGateway = mcpArgs[0] === 'http';
    const compactMode = mcpArgs.includes('--compact-tools') || mcpArgs.includes('--code-mode');
    const wantsHelp = mcpArgs.includes('--help') || mcpArgs.includes('-h');
    if (wantsHelp) {
      if (context && context.outputMode === 'json') {
        const usageEnvelope = {
          ok: true,
          command: 'mcp.help',
          data: {
            usage: 'pandora mcp [--compact-tools|--code-mode] | pandora mcp http [--compact-tools|--code-mode] [--host <host>] [--port <port>] [--public-base-url <url>] [--auth-token <token>|--auth-token-file <path>|--auth-tokens-file <path>] [--auth-scopes <csv>] [--bootstrap-path <path>] [--schema-path <path>] [--tools-path <path>]',
            notes: [
              'pandora mcp runs an MCP stdio server.',
              'pandora mcp http runs a remote streamable HTTP MCP gateway.',
              '--compact-tools / --code-mode exposes only search and execute over MCP for reduced tool-list token cost.',
              'Use gateway:auth:read to inspect configured principals and gateway:auth:write to rotate or revoke bearer tokens remotely.',
              '--auth-tokens-file enables multi-principal rotation and durable revocation without restarting the gateway.',
              'If no auth token is provided, the gateway generates one and stores it in ~/.pandora/mcp-http/auth-token.',
            ],
          },
        };
        process.stdout.write(`${JSON.stringify(usageEnvelope, null, 2)}\n`);
      } else {
        // eslint-disable-next-line no-console
        console.log('Usage: pandora mcp\n       pandora mcp [--compact-tools|--code-mode]\n       pandora mcp http [--compact-tools|--code-mode] [--host <host>] [--port <port>] [--public-base-url <url>] [--auth-token <token>|--auth-token-file <path>|--auth-tokens-file <path>] [--auth-scopes <csv>] [--bootstrap-path <path>] [--schema-path <path>] [--tools-path <path>]\nRuns Pandora as an MCP stdio server or remote streamable HTTP gateway.\nThe HTTP gateway exposes /auth, /bootstrap, /capabilities, /schema, /tools, /mcp, and /operations.\n--compact-tools / --code-mode exposes only search and execute over MCP for reduced tool-list token cost.\nUse gateway:auth:read to inspect principals and gateway:auth:write to rotate or revoke tokens remotely.\n--auth-tokens-file enables multi-principal rotation and durable revocation without restarting the gateway.\nIf no auth token is provided, the HTTP gateway generates one and stores it in ~/.pandora/mcp-http/auth-token.');
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

    const protocol = createMcpProtocolService({
      ...baseProtocolOptions,
      compactMode,
    });
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
