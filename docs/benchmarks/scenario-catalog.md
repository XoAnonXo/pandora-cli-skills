# Scenario Catalog

## Core suite
- `cli-capabilities-bootstrap`
- `mcp-stdio-capabilities`
- `mcp-http-capabilities`
- `mcp-http-scope-denial`
- `mcp-stdio-execute-intent-denial`
- `mcp-http-execute-intent-denial`
- `mcp-stdio-workspace-denial`
- `mcp-http-workspace-denial`
- `cli-schema-bootstrap`
- `mcp-stdio-schema-bootstrap`
- `mcp-http-schema-bootstrap`
- `cli-operations-empty-list`
- `cli-operations-get-seeded`
- `mcp-stdio-operations-get-seeded`
- `mcp-http-operations-get-seeded`
- `mcp-stdio-list-tools-bootstrap`
- `mcp-http-list-tools-bootstrap`
- `cli-operations-cancel-seeded`
- `cli-operations-close-seeded`

## Focus
The core suite validates:
- bootstrap discoverability
- capabilities/schema/tool-list parity across transports
- authorization denial quality
- execute-intent safety and no-side-effect denial behavior
- workspace path safety
- empty-state operation stability
- seeded operation record parity across transports
- operation lifecycle transitions for `get`, `cancel`, and `close`

## Parity groups
- `capabilities-bootstrap`
- `schema-bootstrap`
- `operations-get-seeded`
- `execute-intent-denial`
- `workspace-path-denial`
- `tools-list-bootstrap`
