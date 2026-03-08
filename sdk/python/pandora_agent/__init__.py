from importlib import metadata as _importlib_metadata

from .catalog import (
    get_generated_artifact_dir,
    get_generated_artifact_path,
    list_generated_artifact_paths,
    load_generated_capabilities,
    load_generated_command_descriptors,
    load_generated_contract_registry,
    load_generated_manifest,
    load_generated_mcp_tool_definitions,
    load_generated_tool_catalog,
)
from .client import PandoraAgentClient, create_local_pandora_agent_client, create_remote_pandora_agent_client
from .errors import PandoraSdkError, PandoraToolCallError
from .policies import (
    CommandPolicyInspection,
    PolicyProfileFamily,
    PolicyProfiles,
    inspect_generated_command_policy,
    load_generated_policy_profiles,
)

try:
    __version__ = _importlib_metadata.version('thisispandora-agent')
except _importlib_metadata.PackageNotFoundError:  # pragma: no cover - source-tree fallback
    __version__ = str(load_generated_manifest().get('packageVersion') or '0.0.0')

__all__ = [
    'CommandPolicyInspection',
    'PandoraAgentClient',
    'PandoraSdkError',
    'PandoraToolCallError',
    'PolicyProfileFamily',
    'PolicyProfiles',
    '__version__',
    'create_local_pandora_agent_client',
    'create_remote_pandora_agent_client',
    'get_generated_artifact_dir',
    'get_generated_artifact_path',
    'inspect_generated_command_policy',
    'list_generated_artifact_paths',
    'load_generated_capabilities',
    'load_generated_command_descriptors',
    'load_generated_contract_registry',
    'load_generated_manifest',
    'load_generated_mcp_tool_definitions',
    'load_generated_policy_profiles',
    'load_generated_tool_catalog',
]
