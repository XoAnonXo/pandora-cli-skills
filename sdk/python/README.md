# pandora-agent

Alpha Python SDK for Pandora's agent tool surface.

## Scope
- loads the vendored generated contract catalog from `pandora_agent/generated`
- supports local stdio MCP via `pandora mcp`
- supports remote streamable HTTP MCP via `pandora mcp http`
- exposes one generic client API for tool discovery and tool calls
- exposes policy/profile discovery helpers from generated capability metadata
- exposes package-local artifact helpers for the shipped manifest, bundle, command descriptors, and MCP tool definitions

## Policy/profile inspection
- `load_generated_policy_profiles()` returns the generated policy/profile catalog
- `inspect_generated_command_policy("trade")` returns the resolved scope and profile view for a command
- `PandoraAgentClient.get_policy_profiles()` and `PandoraAgentClient.inspect_command_policy(...)` expose the same helpers through the client

## Generated artifact access
- `load_generated_manifest()` returns the normalized Python-package manifest view for the vendored SDK artifacts
- `get_generated_artifact_path("bundle")` resolves the installed `contract-registry.json` path
- `load_generated_command_descriptors()` and `load_generated_mcp_tool_definitions()` load the packaged descriptor/tool catalogs
