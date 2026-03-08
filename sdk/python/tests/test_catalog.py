from __future__ import annotations

import json
import re
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

REPO_ROOT = Path(__file__).resolve().parents[3]
PYPROJECT_VERSION_RE = re.compile(r'^\s*version\s*=\s*"([^"\n]+)"\s*$', re.MULTILINE)

from pandora_agent import (
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


def _read_python_package_version() -> str:
    pyproject_text = (REPO_ROOT / 'sdk' / 'python' / 'pyproject.toml').read_text(encoding='utf-8')
    match = PYPROJECT_VERSION_RE.search(pyproject_text)
    if not match:
        raise AssertionError('sdk/python/pyproject.toml is missing [project].version')
    return match.group(1)


def _read_root_package_version() -> str:
    package_json = json.loads((REPO_ROOT / 'package.json').read_text(encoding='utf-8'))
    return str(package_json['version'])


def _read_typescript_package_version() -> str:
    package_json = json.loads((REPO_ROOT / 'sdk' / 'typescript' / 'package.json').read_text(encoding='utf-8'))
    return str(package_json['version'])


def _build_manifest_versions() -> dict[str, str]:
    script = """
const { buildGeneratedArtifactFiles } = require('./scripts/lib/agent_contract_sdk_export.cjs');
const pkg = require('./package.json');
const typescriptPkg = require('./sdk/typescript/package.json');
const files = buildGeneratedArtifactFiles({
  packageVersion: pkg.version,
  typescriptPackageVersion: typescriptPkg.version,
  pythonPackageVersion: process.argv[1],
});
const manifests = {};
for (const file of files) {
  if (!file.relativePath.endsWith('/manifest.json')) continue;
  manifests[file.relativePath] = JSON.parse(file.content).packageVersion;
}
process.stdout.write(JSON.stringify(manifests));
"""
    result = subprocess.run(
        ['node', '-e', script, _read_python_package_version()],
        cwd=str(REPO_ROOT),
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


class GeneratedCatalogTests(unittest.TestCase):
    def test_generator_emits_surface_specific_manifest_package_versions(self) -> None:
        manifests = _build_manifest_versions()

        self.assertEqual(manifests['sdk/generated/manifest.json'], _read_root_package_version())
        self.assertEqual(manifests['sdk/typescript/generated/manifest.json'], _read_typescript_package_version())
        self.assertEqual(manifests['sdk/python/pandora_agent/generated/manifest.json'], _read_python_package_version())
        typescript_manifest = json.loads((REPO_ROOT / 'sdk' / 'typescript' / 'generated' / 'manifest.json').read_text(encoding='utf-8'))
        python_manifest = json.loads((REPO_ROOT / 'sdk' / 'python' / 'pandora_agent' / 'generated' / 'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(
            typescript_manifest['backends']['packagedClients']['notes'],
            [
                'This generated manifest describes the standalone TypeScript SDK alpha package surface.',
                'The standalone TypeScript SDK package ships its own generated contract artifacts and client entrypoints only.',
            ],
        )
        self.assertEqual(
            python_manifest['backends']['packagedClients']['notes'],
            [
                'This generated manifest describes the standalone Python SDK alpha package surface.',
                'The standalone Python SDK package ships its own generated contract artifacts and client modules only.',
            ],
        )

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
                'format': 'python',
                'generatedDir': 'generated',
                'module': 'pandora_agent',
                'name': 'pandora-agent',
            },
        )

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
