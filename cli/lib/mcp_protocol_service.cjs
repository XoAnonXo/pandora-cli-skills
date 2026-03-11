const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
  ErrorCode,
} = require('@modelcontextprotocol/sdk/types.js');

const { createMcpToolRegistry } = require('./mcp_tool_registry.cjs');
const { createCommandExecutorService } = require('./command_executor_service.cjs');

const COMPACT_SEARCH_TOOL_NAME = 'search';
const COMPACT_EXECUTE_TOOL_NAME = 'execute';
const COMPACT_TOOL_NAMES = new Set([COMPACT_SEARCH_TOOL_NAME, COMPACT_EXECUTE_TOOL_NAME]);
const COMPACT_TOOL_SCHEMA_VERSION = '1.0.0';

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

function summarizeToolResultText(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return 'Pandora tool result. See structuredContent for details.';
  }

  const command = typeof envelope.command === 'string' && envelope.command.trim()
    ? envelope.command.trim()
    : 'tool';
  if (envelope.ok === true) {
    if (
      envelope.data
      && typeof envelope.data === 'object'
      && !Array.isArray(envelope.data)
      && Number.isInteger(envelope.data.matchCount)
      && command === 'mcp.search'
    ) {
      return `pandora:${command}: ${envelope.data.matchCount} matches. See structuredContent for details.`;
    }
    if (
      envelope.data
      && typeof envelope.data === 'object'
      && !Array.isArray(envelope.data)
      && Number.isInteger(envelope.data.executedCalls)
      && command === 'mcp.execute'
    ) {
      return `pandora:${command}: ${envelope.data.executedCalls} calls, ${envelope.data.failed || 0} failed. See structuredContent for details.`;
    }
    return `pandora:${command}: ok. See structuredContent for details.`;
  }

  const code = envelope.error && envelope.error.code ? String(envelope.error.code) : 'MCP_TOOL_FAILED';
  const message = envelope.error && envelope.error.message ? String(envelope.error.message) : 'Tool execution failed.';
  return `pandora:${command}: error ${code} - ${message}`;
}

function asToolResult(envelope, options = {}) {
  const text = typeof options.text === 'string' && options.text.trim()
    ? options.text.trim()
    : summarizeToolResultText(envelope);
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
    structuredContent: envelope,
    isError: envelope && envelope.ok === false,
  };
}

function normalizeCompactModeOption(value) {
  return value === true || value === 'compact' || value === 'code';
}

function compactModeEnabled(defaultCompactMode, runtime = {}) {
  if (Object.prototype.hasOwnProperty.call(runtime, 'compactMode')) {
    return normalizeCompactModeOption(runtime.compactMode);
  }
  return normalizeCompactModeOption(defaultCompactMode);
}

function normalizeSearchTokens(value) {
  return Array.from(new Set(
    String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9._:-]+/g)
      .map((token) => token.trim())
      .filter(Boolean),
  ));
}

function buildCompactToolDescriptor(name, description, inputSchema) {
  const summary = description.replace(/\s+/g, ' ').trim();
  const xPandora = {
    canonicalTool: name,
    canonicalName: name,
    canonicalUsage: name === COMPACT_SEARCH_TOOL_NAME
      ? 'search query=<text> [limit=<n>] [includeSchema=true]'
      : 'execute calls=[{name, arguments}] [stopOnError=true] [resultMode=summary|full]',
    command: ['mcp', name],
    compatibilityAlias: false,
    aliasOf: null,
    preferred: true,
    remoteEligible: true,
    supportsRemote: true,
    mcpExposed: true,
    mcpMutating: false,
    mutating: false,
    requiresSecrets: false,
    policyScopes: [],
    riskLevel: 'low',
    idempotency: name === COMPACT_SEARCH_TOOL_NAME ? 'idempotent' : 'mixed',
    compactMode: true,
    virtualTool: true,
    summary,
  };

  return {
    name,
    description: summary,
    inputSchema: {
      ...inputSchema,
      xPandora,
    },
    xPandora,
  };
}

const COMPACT_TOOL_DESCRIPTORS = Object.freeze([
  buildCompactToolDescriptor(
    COMPACT_SEARCH_TOOL_NAME,
    'Search the Pandora command catalog in compact mode. Use this first to find the right hidden command, required arguments, and safety constraints before execute.',
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'Natural-language or keyword query over Pandora tool names, descriptions, scopes, and usage.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 25,
          description: 'Maximum number of matches to return. Defaults to 8.',
        },
        includeSchema: {
          type: 'boolean',
          description: 'Include the full input schema for matched tools. Use only when you need exact argument shapes.',
        },
        includeAliases: {
          type: 'boolean',
          description: 'Include hidden compatibility aliases in the search corpus.',
        },
      },
      required: ['query'],
    },
  ),
  buildCompactToolDescriptor(
    COMPACT_EXECUTE_TOOL_NAME,
    'Execute one or more Pandora commands by canonical tool name inside compact mode. This batches calls in one MCP round trip while still enforcing the underlying tool scopes and execution guardrails.',
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        calls: {
          type: 'array',
          minItems: 1,
          maxItems: 25,
          description: 'Ordered batch of Pandora tool calls to run.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: {
                type: 'string',
                description: 'Canonical Pandora tool name returned by search.',
              },
              arguments: {
                type: 'object',
                description: 'Arguments object to pass to the target tool.',
              },
            },
            required: ['name'],
          },
        },
        stopOnError: {
          type: 'boolean',
          description: 'Stop the batch after the first failed call. Defaults to true.',
        },
        resultMode: {
          type: 'string',
          enum: ['summary', 'full'],
          description: 'Return compact per-call summaries or full structured envelopes. Defaults to full.',
        },
      },
      required: ['calls'],
    },
  ),
]);

function describeCompactTool(toolName) {
  return COMPACT_TOOL_DESCRIPTORS.find((descriptor) => descriptor.name === toolName) || null;
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
  const defaultCompactMode = normalizeCompactModeOption(options.compactMode);

  function listRegistryTools(runtime = {}, listOptions = {}) {
    const tools = registry.listTools({
      includeCompatibilityAliases: Boolean(listOptions && listOptions.includeCompatibilityAliases),
    });
    if (typeof runtime.filterToolDescriptor !== 'function') {
      return tools;
    }
    return tools.filter((descriptor) =>
      runtime.filterToolDescriptor(
        descriptor && descriptor.name ? descriptor.name : '',
        descriptor,
      ));
  }

  function listTools(runtime = {}) {
    if (compactModeEnabled(defaultCompactMode, runtime) && runtime.allowHiddenToolAccess !== true) {
      if (typeof runtime.filterToolDescriptor !== 'function') {
        return COMPACT_TOOL_DESCRIPTORS.slice();
      }
      return COMPACT_TOOL_DESCRIPTORS.filter((descriptor) =>
        runtime.filterToolDescriptor(descriptor.name, descriptor)
      );
    }
    return listRegistryTools(runtime, {
      includeCompatibilityAliases: Boolean(runtime && runtime.includeCompatibilityAliases),
    });
  }

  function resolveRegistryDescriptor(toolName, runtime = {}) {
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

  function resolveVisibleDescriptor(toolName, runtime = {}) {
    if (compactModeEnabled(defaultCompactMode, runtime) && runtime.allowHiddenToolAccess !== true) {
      return describeCompactTool(String(toolName || '').trim());
    }
    return resolveRegistryDescriptor(toolName, runtime);
  }

  async function callRegistryTool(params = {}, runtime = {}) {
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
    const descriptor = resolveRegistryDescriptor(toolName, runtime);
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

  function searchCompactTools(params = {}, runtime = {}) {
    const query = String(params.query || '').trim();
    if (!query) {
      throw new McpError(ErrorCode.InvalidParams, 'search requires params.query.');
    }

    const includeSchema = params.includeSchema === true;
    const includeAliases = params.includeAliases === true;
    const limit = Number.isInteger(params.limit)
      ? Math.max(1, Math.min(25, params.limit))
      : 8;
    const queryLower = query.toLowerCase();
    const tokens = normalizeSearchTokens(query);
    const candidates = listRegistryTools(runtime, {
      includeCompatibilityAliases: includeAliases,
    });

    const ranked = candidates
      .map((descriptor) => {
        const metadata = descriptor && descriptor.xPandora && typeof descriptor.xPandora === 'object'
          ? descriptor.xPandora
          : (descriptor && descriptor.inputSchema && descriptor.inputSchema.xPandora && typeof descriptor.inputSchema.xPandora === 'object'
            ? descriptor.inputSchema.xPandora
            : {});
        const haystack = [
          descriptor.name,
          descriptor.description,
          metadata.summary,
          metadata.canonicalUsage,
          Array.isArray(metadata.command) ? metadata.command.join(' ') : '',
          Array.isArray(metadata.policyScopes) ? metadata.policyScopes.join(' ') : '',
          metadata.recommendedPreflightTool || '',
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        let score = 0;
        if (descriptor.name === query) score += 200;
        if (String(descriptor.name || '').toLowerCase().includes(queryLower)) score += 80;
        if (haystack.includes(queryLower)) score += 30;
        for (const token of tokens) {
          if (String(descriptor.name || '').toLowerCase().includes(token)) score += 25;
          if (String(descriptor.description || '').toLowerCase().includes(token)) score += 12;
          if (haystack.includes(token)) score += 5;
        }
        if (metadata.compatibilityAlias === true) score -= 40;
        return { descriptor, metadata, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        const a = String(left.descriptor && left.descriptor.name || '');
        const b = String(right.descriptor && right.descriptor.name || '');
        return a < b ? -1 : a > b ? 1 : 0;
      })
      .slice(0, limit)
      .map(({ descriptor, metadata, score }) => ({
        name: descriptor.name,
        description: descriptor.description,
        score,
        mutating: Boolean(metadata.mutating),
        requiresSecrets: Boolean(metadata.requiresSecrets),
        policyScopes: Array.isArray(metadata.policyScopes) ? metadata.policyScopes.slice() : [],
        requiredArguments: Array.isArray(descriptor.inputSchema && descriptor.inputSchema.required)
          ? descriptor.inputSchema.required.slice()
          : [],
        recommendedPreflightTool: metadata.recommendedPreflightTool || null,
        safeEquivalent: metadata.safeEquivalent || null,
        canonicalUsage: metadata.canonicalUsage || null,
        ...(includeSchema ? { inputSchema: descriptor.inputSchema } : {}),
      }));

    const envelope = {
      ok: true,
      command: 'mcp.search',
      data: {
        schemaVersion: COMPACT_TOOL_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        mode: 'compact',
        query,
        includeSchema,
        includeAliases,
        matchCount: ranked.length,
        searchedToolCount: candidates.length,
        matches: ranked,
      },
    };

    return asToolResult(envelope);
  }

  async function executeCompactBatch(params = {}, runtime = {}) {
    if (!Array.isArray(params.calls) || params.calls.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'execute requires params.calls to be a non-empty array.');
    }
    if (params.calls.length > 25) {
      throw new McpError(ErrorCode.InvalidParams, 'execute supports at most 25 calls per batch.');
    }
    const stopOnError = params.stopOnError !== false;
    const resultMode = params.resultMode === 'summary' ? 'summary' : 'full';
    const results = [];
    let failed = 0;
    let stoppedEarly = false;

    for (let index = 0; index < params.calls.length; index += 1) {
      const entry = params.calls[index];
      const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
      const argumentsObject = entry && entry.arguments !== undefined ? entry.arguments : {};
      if (!name) {
        const envelope = asCliErrorEnvelope({
          code: 'MCP_INVALID_ARGUMENTS',
          message: `execute.calls[${index}].name must be a non-empty string.`,
          details: { index, path: `calls.${index}.name` },
        });
        failed += 1;
        results.push({
          index,
          name: null,
          result: resultMode === 'summary'
            ? { ok: false, command: null, error: envelope.error }
            : envelope,
        });
        if (stopOnError) {
          stoppedEarly = true;
          break;
        }
        continue;
      }

      if (COMPACT_TOOL_NAMES.has(name)) {
        const envelope = asCliErrorEnvelope({
          code: 'MCP_COMPACT_RECURSION_BLOCKED',
          message: `execute cannot recursively call compact tool: ${name}`,
          details: { index, toolName: name },
        });
        failed += 1;
        results.push({
          index,
          name,
          result: resultMode === 'summary'
            ? { ok: false, command: name, error: envelope.error }
            : envelope,
        });
        if (stopOnError) {
          stoppedEarly = true;
          break;
        }
        continue;
      }

      let envelope;
      try {
        const callResult = await callRegistryTool({
          name,
          arguments: argumentsObject,
        }, {
          ...runtime,
          allowHiddenToolAccess: true,
        });
        envelope = callResult && callResult.structuredContent
          ? callResult.structuredContent
          : asCliErrorEnvelope({
              code: 'MCP_TOOL_FAILED',
              message: `Compact execute did not receive structured content for ${name}.`,
              details: { index, toolName: name },
            });
      } catch (error) {
        envelope = asCliErrorEnvelope(error);
      }

      if (envelope.ok === false) {
        failed += 1;
      }

      results.push({
        index,
        name,
        result: resultMode === 'summary'
          ? {
              ok: envelope.ok === true,
              command: envelope.command || name,
              ...(envelope.ok === false ? { error: envelope.error } : {}),
            }
          : envelope,
      });

      if (envelope.ok === false && stopOnError) {
        stoppedEarly = true;
        break;
      }
    }

    const succeeded = results.length - failed;
    const envelope = {
      ok: failed === 0,
      command: 'mcp.execute',
      data: {
        schemaVersion: COMPACT_TOOL_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        mode: 'compact',
        resultMode,
        stopOnError,
        requestedCalls: params.calls.length,
        executedCalls: results.length,
        succeeded,
        failed,
        stoppedEarly,
        results,
      },
    };

    return asToolResult(envelope);
  }

  async function callTool(params = {}, runtime = {}) {
    const toolName = String(params.name || '').trim();
    if (compactModeEnabled(defaultCompactMode, runtime) && runtime.allowHiddenToolAccess !== true) {
      if (toolName === COMPACT_SEARCH_TOOL_NAME) {
        return searchCompactTools(params.arguments && typeof params.arguments === 'object' ? params.arguments : {}, runtime);
      }
      if (toolName === COMPACT_EXECUTE_TOOL_NAME) {
        return executeCompactBatch(params.arguments && typeof params.arguments === 'object' ? params.arguments : {}, runtime);
      }
      const missing = new Error(`Unknown MCP tool: ${toolName}`);
      missing.code = 'UNKNOWN_TOOL';
      throw missing;
    }
    return callRegistryTool(params, runtime);
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
    compactModeEnabled: (runtime = {}) => compactModeEnabled(defaultCompactMode, runtime),
  };
}

module.exports = {
  createMcpProtocolService,
  asCliErrorEnvelope,
  asToolResult,
};
