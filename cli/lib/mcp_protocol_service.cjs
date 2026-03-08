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

  function listTools(runtime = {}) {
    const tools = registry.listTools();
    if (typeof runtime.filterToolDescriptor !== 'function') {
      return tools;
    }
    return tools.filter((descriptor) =>
      runtime.filterToolDescriptor(
        descriptor && descriptor.name ? descriptor.name : '',
        descriptor,
      ));
  }

  function resolveVisibleDescriptor(toolName, runtime = {}) {
    const descriptor = registry.describeTool(toolName);
    if (!descriptor) return null;
    if (typeof runtime.filterToolDescriptor === 'function') {
      const allowed = runtime.filterToolDescriptor(
        descriptor && descriptor.name ? descriptor.name : '',
        descriptor,
      );
      if (!allowed) return null;
    }
    return descriptor;
  }

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
    const descriptor = resolveVisibleDescriptor(toolName, runtime);
    if (!descriptor) {
      const missing = new Error(`Unknown MCP tool: ${toolName}`);
      missing.code = 'UNKNOWN_TOOL';
      throw missing;
    }
    if (typeof runtime.assertToolAllowed === 'function') {
      runtime.assertToolAllowed(toolName, descriptor, toolArgs);
    }
    const invocation = registry.prepareInvocation(toolName, toolArgs);
    const runtimeEnv =
      typeof runtime.buildInvocationEnv === 'function'
        ? runtime.buildInvocationEnv(toolName, descriptor, toolArgs)
        : undefined;
    const execution = await executeCommand(invocation.argv, {
      env: {
        ...(invocation.env && typeof invocation.env === 'object' ? invocation.env : {}),
        ...(runtimeEnv && typeof runtimeEnv === 'object' ? runtimeEnv : {}),
      },
    });
    return asToolResult(execution.envelope);
  }

  function attachHandlers(server, runtime = {}) {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: listTools(runtime),
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
    listTools,
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
