from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from .errors import PandoraSdkError

_GENERATED_DIR = Path(__file__).resolve().parent / 'generated'
_ROOT_GENERATED_DIR = Path(__file__).resolve().parents[2] / 'generated'
_PYTHON_ARTIFACT_KEYS = ('bundle', 'commandDescriptors', 'mcpToolDefinitions')


def _resolve_generated_path(name: str) -> Path:
    artifact_name = str(name).strip()
    local_path = _GENERATED_DIR / artifact_name
    if local_path.is_file():
        return local_path
    root_path = _ROOT_GENERATED_DIR / artifact_name
    if root_path.is_file():
        return root_path
    return local_path


def _load_json(name: str) -> Dict[str, Any]:
    path = _resolve_generated_path(name)
    return json.loads(path.read_text(encoding='utf-8'))


def _load_optional_json(name: str) -> Any:
    path = _resolve_generated_path(name)
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding='utf-8'))


def _as_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    return {}


def _normalize_manifest_artifacts(raw_artifacts: Dict[str, Any]) -> Dict[str, str]:
    normalized: Dict[str, str] = {}
    for artifact_name in _PYTHON_ARTIFACT_KEYS:
        relative_path = raw_artifacts.get(artifact_name)
        if not isinstance(relative_path, str) or not relative_path.strip():
            continue
        candidate = _resolve_generated_path(relative_path)
        if candidate.is_file():
            normalized[artifact_name] = relative_path
    return normalized


def load_generated_contract_registry() -> Dict[str, Any]:
    return _load_json('contract-registry.json')


def load_generated_manifest() -> Dict[str, Any]:
    raw_manifest = _load_json('manifest.json')
    manifest = dict(raw_manifest)
    manifest['artifacts'] = _normalize_manifest_artifacts(_as_dict(raw_manifest.get('artifacts')))
    return manifest


def get_generated_artifact_dir() -> Path:
    return _GENERATED_DIR


def get_generated_artifact_path(name: str) -> Path:
    artifact_name = str(name).strip()
    manifest = load_generated_manifest()
    artifacts = _as_dict(manifest.get('artifacts'))
    relative_path = artifacts.get(artifact_name)
    if not isinstance(relative_path, str) or not relative_path.strip():
        raise PandoraSdkError(
            'PANDORA_SDK_UNKNOWN_GENERATED_ARTIFACT',
            f'Unknown generated artifact for Python SDK package: {name}',
            {'availableArtifacts': sorted(artifacts.keys())},
        )
    path = _resolve_generated_path(relative_path)
    if not path.is_file():
        raise PandoraSdkError(
            'PANDORA_SDK_MISSING_GENERATED_ARTIFACT',
            f'Generated artifact is missing from the Python SDK package: {relative_path}',
            {'artifact': artifact_name, 'path': str(path)},
        )
    return path


def list_generated_artifact_paths() -> Dict[str, str]:
    manifest = load_generated_manifest()
    artifacts = _as_dict(manifest.get('artifacts'))
    resolved: Dict[str, str] = {}
    for artifact_name in sorted(artifacts.keys()):
        resolved[artifact_name] = str(get_generated_artifact_path(artifact_name))
    return resolved


def load_generated_capabilities() -> Dict[str, Any]:
    registry = load_generated_contract_registry()
    return _as_dict(registry.get('capabilities'))


def load_generated_tool_catalog() -> Dict[str, Any]:
    registry = load_generated_contract_registry()
    return _as_dict(registry.get('tools'))


def load_generated_command_descriptors() -> Dict[str, Any]:
    payload = _load_optional_json('command-descriptors.json')
    if isinstance(payload, dict):
        return dict(payload)
    registry = load_generated_contract_registry()
    command_descriptors = _as_dict(registry.get('commandDescriptors'))
    if command_descriptors:
        return command_descriptors
    capabilities = _as_dict(registry.get('capabilities'))
    return _as_dict(capabilities.get('commandDigests'))


def load_generated_mcp_tool_definitions() -> List[Dict[str, Any]]:
    payload = _load_optional_json('mcp-tool-definitions.json')
    if isinstance(payload, list):
        return [dict(item) for item in payload if isinstance(item, dict)]
    tool_catalog = load_generated_tool_catalog()
    definitions: List[Dict[str, Any]] = []
    for tool_name in sorted(tool_catalog.keys()):
        tool = _as_dict(tool_catalog.get(tool_name))
        definition: Dict[str, Any] = {
            'name': str(tool.get('name') or tool_name),
            'description': tool.get('description') if isinstance(tool.get('description'), str) else None,
            'inputSchema': tool.get('inputSchema') if isinstance(tool.get('inputSchema'), dict) else {
                'type': 'object',
                'properties': {},
                'additionalProperties': False,
            },
        }
        if isinstance(tool.get('xPandora'), dict):
            definition['xPandora'] = dict(tool['xPandora'])
        definitions.append(definition)
    return definitions
