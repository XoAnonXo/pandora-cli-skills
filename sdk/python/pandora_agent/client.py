from __future__ import annotations

from typing import Any, Dict, List, Optional

from .backends import (
    BasePandoraBackend,
    HttpPandoraBackend,
    StdioPandoraBackend,
    _normalize_runtime_tool_definition,
    normalize_tool_envelope,
)
from .catalog import load_generated_command_descriptors, load_generated_contract_registry, load_generated_manifest
from .errors import PandoraSdkError
from .policies import CommandPolicyInspection, PolicyProfileFamily, PolicyProfiles


def _as_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    return {}


class PandoraAgentClient:
    def __init__(self, backend: BasePandoraBackend, catalog: Optional[Dict[str, Any]] = None):
        self.backend = backend
        self.catalog = catalog or load_generated_contract_registry()
        self._tools = dict(self.catalog.get('tools', {}))
        self._policy_profiles: Optional[PolicyProfiles] = None

    def connect(self) -> 'PandoraAgentClient':
        self.backend.connect()
        return self

    def close(self) -> None:
        self.backend.close()

    def get_manifest(self) -> Dict[str, Any]:
        return load_generated_manifest()

    def get_catalog(self) -> Dict[str, Any]:
        return self.catalog

    def get_capabilities(self) -> Dict[str, Any]:
        return _as_dict(self.catalog.get('capabilities'))

    def get_command_descriptors(self) -> Dict[str, Any]:
        command_descriptors = _as_dict(self.catalog.get('commandDescriptors'))
        if command_descriptors:
            return command_descriptors
        capabilities = _as_dict(self.catalog.get('capabilities'))
        compact_digests = _as_dict(capabilities.get('commandDigests'))
        if compact_digests:
            return compact_digests
        return load_generated_command_descriptors()

    def get_tool_catalog(self) -> Dict[str, Any]:
        return dict(self._tools)

    def get_policy_profiles(self) -> PolicyProfiles:
        if self._policy_profiles is None:
            self._policy_profiles = PolicyProfiles.from_contract_registry(self.catalog)
        return self._policy_profiles

    def list_policy_profile_families(self) -> List[PolicyProfileFamily]:
        return self.get_policy_profiles().list_families()

    def get_policy_profile_family(self, name: str) -> Optional[PolicyProfileFamily]:
        return self.get_policy_profiles().get_family(name)

    def require_policy_profile_family(self, name: str) -> PolicyProfileFamily:
        return self.get_policy_profiles().require_family(name)

    def inspect_command_policy(self, command_name: str) -> CommandPolicyInspection:
        return self.get_policy_profiles().inspect_command(command_name)

    def list_generated_tools(self) -> List[str]:
        return sorted(self._tools.keys())

    def get_tool(self, name: str) -> Optional[Dict[str, Any]]:
        return self._tools.get(str(name).strip())

    def require_tool(self, name: str) -> Dict[str, Any]:
        tool = self.get_tool(name)
        if tool is None:
            raise PandoraSdkError('PANDORA_SDK_UNKNOWN_TOOL', f'Unknown Pandora tool: {name}')
        return tool

    def list_tools(self) -> List[Dict[str, Any]]:
        tools = self.backend.list_tools()
        return [_normalize_runtime_tool_definition(tool, self.catalog) for tool in tools]

    def call_tool_raw(self, name: str, args: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        # Allow forward-compatible tool invocation against a newer runtime even if
        # the vendored catalog does not yet know about the tool.
        return self.backend.call_tool(name, args or {})

    def call_tool(self, name: str, args: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return normalize_tool_envelope(self.call_tool_raw(name, args or {}))


def create_local_pandora_agent_client(**kwargs: Any) -> PandoraAgentClient:
    catalog = kwargs.pop('catalog', None)
    return PandoraAgentClient(StdioPandoraBackend(**kwargs), catalog=catalog)


def create_remote_pandora_agent_client(**kwargs: Any) -> PandoraAgentClient:
    catalog = kwargs.pop('catalog', None)
    return PandoraAgentClient(HttpPandoraBackend(**kwargs), catalog=catalog)
