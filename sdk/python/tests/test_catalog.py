from __future__ import annotations

import json
import re
import unittest

PYPROJECT_VERSION_RE = re.compile(r'^\s*version\s*=\s*"([^"\n]+)"\s*$', re.MULTILINE)

from pandora_agent import (
    __version__,
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
from pandora_agent.errors import PandoraSdkError


class _DummyBackend:
    def connect(self) -> None:
        return None

    def close(self) -> None:
        return None

    def list_tools(self):  # pragma: no cover - helper only
        return []

    def call_tool(self, name, args=None):  # pragma: no cover - helper only
        raise AssertionError('call_tool should not be used in catalog tests')

class GeneratedCatalogTests(unittest.TestCase):
    def test_python_manifest_lists_only_shipped_artifacts(self) -> None:
        manifest = load_generated_manifest()

        self.assertEqual(
            manifest['artifacts'],
            {
                'bundle': 'contract-registry.json',
                'commandDescriptors': 'command-descriptors.json',
                'mcpToolDefinitions': 'mcp-tool-definitions.json',
            },
        )
        self.assertRegex(manifest['packageVersion'], r'^\d+\.\d+\.\d+')
        self.assertEqual(
            manifest['package'],
            {
                'artifactSubpaths': {
                    'bundle': 'pandora_agent/generated/contract-registry.json',
                    'commandDescriptors': 'pandora_agent/generated/command-descriptors.json',
                    'manifest': 'pandora_agent/generated/manifest.json',
                    'mcpToolDefinitions': 'pandora_agent/generated/mcp-tool-definitions.json',
                },
                'format': 'python',
                'module': 'pandora_agent',
                'name': 'thisispandora-agent',
                'sourceProjectPath': 'sdk/python/pyproject.toml',
                'version': manifest['packageVersion'],
            },
        )
        self.assertEqual(__version__, manifest['packageVersion'])

        artifact_dir = get_generated_artifact_dir()
        self.assertTrue(artifact_dir.is_dir())

        artifact_paths = list_generated_artifact_paths()
        self.assertEqual(
            sorted(artifact_paths.keys()),
            ['bundle', 'commandDescriptors', 'mcpToolDefinitions'],
        )
        self.assertTrue(get_generated_artifact_path('bundle').is_file())
        self.assertTrue(get_generated_artifact_path('commandDescriptors').is_file())
        self.assertTrue(get_generated_artifact_path('mcpToolDefinitions').is_file())

        with self.assertRaises(PandoraSdkError):
            get_generated_artifact_path('types')

    def test_command_descriptors_fall_back_to_compact_digests(self) -> None:
        from pandora_agent.client import PandoraAgentClient

        client = PandoraAgentClient(
            backend=_DummyBackend(),
            catalog={
                'capabilities': {
                    'commandDigests': {
                        'trade': {
                            'summary': 'Execute a trade.',
                            'policyScopes': ['trade:write'],
                            'requiresSecrets': True,
                        }
                    }
                }
            },
        )

        self.assertEqual(client.get_command_descriptors()['trade']['policyScopes'], ['trade:write'])

    def test_package_local_catalog_helpers_resolve_generated_data(self) -> None:
        registry = load_generated_contract_registry()
        command_descriptors = load_generated_command_descriptors()
        capabilities = load_generated_capabilities()
        tool_catalog = load_generated_tool_catalog()
        mcp_tool_definitions = load_generated_mcp_tool_definitions()

        self.assertEqual(command_descriptors, registry['commandDescriptors'])
        self.assertEqual(capabilities, registry['capabilities'])
        self.assertEqual(tool_catalog, registry['tools'])

        names = [tool['name'] for tool in mcp_tool_definitions]
        self.assertIn('help', names)
        self.assertIn('trade', names)
        help_tool = next(tool for tool in mcp_tool_definitions if tool['name'] == 'help')
        self.assertIn('inputSchema', help_tool)
        self.assertNotIn('commandDescriptor', help_tool)


if __name__ == '__main__':
    unittest.main()
