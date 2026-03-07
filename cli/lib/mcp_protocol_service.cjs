const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
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

function createMcpProtocolService(options = {}) {
  const packageVersion =
    typeof options.packageVersion === 'string' && options.packageVersion.trim()
      ? options.packageVersion.trim()
      : '0.0.0';
  const remoteTransportActive = Boolean(options.remoteTransportActive);
  const registry = options.registry || createMcpToolRegistry({
    remoteTransportActive,
    remoteOnly: remoteTransportActive,
  });
  const executor = options.executor || createCommandExecutorService({
    cliPath: options.cliPath,
    defaultTimeoutMs: 60_000,
  });
  const executeCommand = options.asyncExecution
    ? executor.executeJsonCommandAsync.bind(executor)
    : async (...args) => executor.executeJsonCommand(...args);

  async function callTool(params = {}, runtime = {}) {
    const toolName = String(params.name || '').trim();
    if (!toolName) {
      throw new McpError(ErrorCode.InvalidParams, 'tools/call requires params.name.');
    }

    const hasArguments = Object.prototype.hasOwnProperty.call(params, 'arguments');
    if (
      hasArguments
      && (
        !params.arguments
        || typeof params.arguments !== 'object'
        || Array.isArray(params.arguments)
      )
    ) {
      throw new McpError(ErrorCode.InvalidParams, 'tools/call requires params.arguments to be an object when provided.');
    }

    const toolArgs = hasArguments ? params.arguments : {};
    if (typeof runtime.assertToolAllowed === 'function') {
      runtime.assertToolAllowed(toolName, registry.describeTool(toolName), toolArgs);
    }
    const invocation = registry.prepareInvocation(toolName, toolArgs);
    const execution = await executeCommand(invocation.argv, {
      env: invocation.env,
    });
    return asToolResult(execution.envelope);
  }

  function attachHandlers(server, runtime = {}) {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: registry.listTools(),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const params = request && request.params ? request.params : {};
        return await callTool(params, runtime);
      } catch (err) {
        if (err instanceof McpError) throw err;
        return asToolResult(asCliErrorEnvelope(err));
      }
    });
    return server;
  }

  function createServer(runtime = {}) {
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
    return attachHandlers(server, runtime);
  }

  return {
    listTools: registry.listTools,
    describeTool: registry.describeTool,
    callTool,
    createServer,
    attachHandlers,
    asCliErrorEnvelope,
    asToolResult,
  };
}

module.exports = {
  createMcpProtocolService,
  asCliErrorEnvelope,
  asToolResult,
};
