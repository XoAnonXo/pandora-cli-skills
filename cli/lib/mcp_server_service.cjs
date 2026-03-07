const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
  ErrorCode,
} = require('@modelcontextprotocol/sdk/types.js');

const { createMcpToolRegistry } = require('./mcp_tool_registry.cjs');
const { createCommandExecutorService } = require('./command_executor_service.cjs');

function coerceErrorMessage(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.message === 'string') return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asCliErrorEnvelope(error) {
  const code = error && error.code ? String(error.code) : 'MCP_TOOL_FAILED';
  const envelope = {
    ok: false,
    error: {
      code,
      message: coerceErrorMessage(error),
    },
  };
  if (error && error.details !== undefined) {
    envelope.error.details = error.details;
  }
  return envelope;
}

function asToolResult(envelope) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(envelope, null, 2),
      },
    ],
    structuredContent: envelope,
    isError: envelope && envelope.ok === false,
  };
}

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
  const registry = createMcpToolRegistry();
  const executor = createCommandExecutorService({
    cliPath: options.cliPath,
    defaultTimeoutMs: 60_000,
  });

  async function runMcpServer(args, context) {
    const mcpArgs = Array.isArray(args) ? args : [];
    if (mcpArgs.includes('--help') || mcpArgs.includes('-h')) {
      if (context && context.outputMode === 'json') {
        const usageEnvelope = {
          ok: true,
          command: 'mcp.help',
          data: {
            usage: 'pandora mcp',
            notes: [
              'Runs an MCP stdio server.',
              'Do not pass --output json to this command in normal MCP operation.',
            ],
          },
        };
        process.stdout.write(`${JSON.stringify(usageEnvelope, null, 2)}\n`);
      } else {
        // eslint-disable-next-line no-console
        console.log('Usage: pandora mcp');
        // eslint-disable-next-line no-console
        console.log('Runs Pandora as an MCP stdio server.');
      }
      return;
    }

    if (context && context.outputMode === 'json') {
      throw new Error('pandora mcp must be run without --output json because MCP uses raw stdio transport.');
    }

    const server = new Server(
      {
        name: 'pandora-cli-skills',
        version: packageVersion,
      },
      {
        capabilities: {
          tools: { listChanged: false },
        },
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: registry.listTools(),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const params = request && request.params ? request.params : {};
        const toolName = String(params.name || '').trim();
        if (!toolName) {
          throw new McpError(ErrorCode.InvalidParams, 'tools/call requires params.name.');
        }

        const toolArgs = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
        const invocation = registry.prepareInvocation(toolName, toolArgs);
        const execution = executor.executeJsonCommand(invocation.argv, {
          env: invocation.env,
        });
        return asToolResult(execution.envelope);
      } catch (err) {
        if (err instanceof McpError) throw err;
        return asToolResult(asCliErrorEnvelope(err));
      }
    });

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
