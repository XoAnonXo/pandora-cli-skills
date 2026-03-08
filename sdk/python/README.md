# thisispandora-agent

`thisispandora-agent` is the standalone Python SDK for Pandora's agent-facing contract and MCP execution surfaces.

It is intended to work as a normal installed Python package:
- it ships its own generated contract artifacts inside `pandora_agent/generated`
- it can execute against local stdio MCP via `pandora mcp`
- it can execute against operator-hosted remote MCP HTTP via `pandora mcp http`
- it exposes package-local helpers for the vendored manifest, contract registry, command descriptors, and MCP tool definitions
- it exposes first-class bootstrap helpers so cold agents can start from Pandora's canonical bootstrap contract

## What this package is for

Use `thisispandora-agent` when Python code needs to:
- inspect the shipped Pandora command and tool catalog without shelling out
- inspect policy scopes and signer-profile metadata before choosing tools
- connect to a local Pandora process over stdio MCP
- connect to a remote Pandora MCP HTTP gateway with a bearer token

## Prerequisites

The Python package does not bundle the Pandora CLI runtime itself.

- For local stdio execution, the `pandora` CLI must be installed and available on `PATH`, or you must pass an explicit `command=...`.
- For remote execution, an operator must already be running `pandora mcp http ...` and provide the `/mcp` URL plus a bearer token if auth is enabled.

## Installation

Current validated install paths:

Preferred for external consumers:

```bash
pip install /path/to/downloaded/pandora_agent-<version>-py3-none-any.whl
```

Maintainer and repository-checkout flows:

```bash
pip install ./sdk/python
```

Or from a locally built release artifact produced by the repository release flow:

```bash
pip install dist/release/sdk/python/*.whl
```

Use the signed GitHub release wheel or sdist when working outside the repository. Use the repo path only when you intentionally want an in-tree checkout. Public PyPI publication is not claimed by this README until a release explicitly says so.

Vendored equivalent inside the Pandora CLI package:

```bash
PYTHONPATH=/path/to/pandora-cli-skills/sdk/python python
```

## Quickstart

### Local stdio MCP

Cold agents should start with `bootstrap`, not with low-level `capabilities` or `schema` calls.

```python
from pandora_agent import create_local_pandora_agent_client

with create_local_pandora_agent_client(command="pandora") as client:
    bootstrap = client.get_bootstrap()
    print(len(bootstrap["canonicalTools"]), bootstrap["recommendedBootstrapFlow"][0])
```

### Remote MCP HTTP

```python
from pandora_agent import PandoraSdkError, PandoraToolCallError, create_remote_pandora_agent_client

with create_remote_pandora_agent_client(
    url="http://127.0.0.1:8787/mcp",
    auth_token="replace-me",
) as client:
    try:
        bootstrap = client.get_bootstrap()
        print(bootstrap["canonicalTools"][0])
    except PandoraToolCallError as error:
        print(error.code, error.details)
    except PandoraSdkError as error:
        print(error.code, error.details)
```

### Package-local contract inspection

```python
from pandora_agent import (
    inspect_generated_command_policy,
    load_generated_command_descriptors,
    load_generated_manifest,
)

manifest = load_generated_manifest()
trade_descriptor = load_generated_command_descriptors()["trade"]
trade_policy = inspect_generated_command_policy("trade")

print(manifest["packageVersion"])
print(trade_descriptor["canonicalTool"])
print(trade_policy.policy_scopes)
```

## Main API surface

### Client constructors

- `create_local_pandora_agent_client(...)`
- `create_remote_pandora_agent_client(...)`
- `PandoraAgentClient(...)`

`PandoraAgentClient` supports context-manager usage, so installed consumers can write `with ... as client:` and avoid manual teardown.

### Generated artifact helpers

- `load_generated_manifest()`
- `load_generated_contract_registry()`
- `load_generated_capabilities()`
- `load_generated_command_descriptors()`
- `load_generated_mcp_tool_definitions()`
- `get_generated_artifact_path(...)`
- `list_generated_artifact_paths()`

### Policy/profile helpers

- `load_generated_policy_profiles()`
- `inspect_generated_command_policy(command_name)`
- `PandoraAgentClient.get_policy_profiles()`
- `PandoraAgentClient.inspect_command_policy(command_name)`

## Error semantics

The SDK raises:

- `PandoraSdkError` for SDK, transport, protocol, process, or HTTP failures
- `PandoraToolCallError` for Pandora tool failure envelopes

Tool-call normalization is intentionally specific:

- when Pandora returns a structured tool error with its own stable code, `PandoraToolCallError.code` preserves that Pandora code directly
- examples: `FORBIDDEN`, `UNKNOWN_TOOL`, `MCP_INVALID_ARGUMENTS`
- the generic wrapper code `PANDORA_SDK_TOOL_ERROR` is only used when a tool failure envelope does not include a stable Pandora error code

`PandoraSdkError.to_dict()` and `PandoraToolCallError.to_dict()` are safe to log or serialize for debugging. `PandoraToolCallError` also keeps the normalized `envelope` and raw MCP `result` payload when available.

## Transport notes

### Local stdio

- starts `pandora mcp`
- keeps one subprocess per client instance
- requires `connect()` before use unless you use the context-manager form

### Remote HTTP

- talks to the streamable HTTP MCP endpoint at `/mcp`
- supports bearer-token auth via `auth_token=...`
- preserves gateway-provided MCP session headers when the server emits them
- surfaces HTTP and gateway-side JSON errors as `PandoraSdkError`

## Examples

Repository examples are kept under:

- `sdk/python/examples/local_stdio.py`
- `sdk/python/examples/remote_http.py`

They are source-tree examples, not installed package files in the wheel.

## Current boundaries

This package is intentionally standalone at runtime, but the repository and the Pandora CLI package also vendor matching copies and share some integration boundaries:

- the vendored generated JSON artifacts are still produced by the shared contract generator in the main repo
- package versioning and release or publish automation outside `sdk/python/**` are still controlled by shared repo release work
- the Pandora CLI package also carries a vendored copy under `sdk/python` for in-tree consumers and parity checks

That means the installed package is self-contained at runtime, but artifact refresh and coordinated release automation still depend on the repo-level generator and release lanes.
