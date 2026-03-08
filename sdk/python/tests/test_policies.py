from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pandora_agent import (
    PandoraAgentClient,
    inspect_generated_command_policy,
    load_generated_policy_profiles,
)
from pandora_agent.policies import PolicyProfiles


class DummyBackend:
    def connect(self) -> None:
        return None

    def close(self) -> None:
        return None

    def list_tools(self) -> List[Dict[str, Any]]:
        return []

    def call_tool(self, name: str, args: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        raise AssertionError('call_tool should not be used in policy/profile tests')


class PolicyProfilesTests(unittest.TestCase):
    def test_generated_policy_families_are_discoverable(self) -> None:
        profiles = load_generated_policy_profiles()

        self.assertEqual(profiles.family_names(), ('policyPacks', 'signerProfiles'))

        policy_packs = profiles.require_family('policyPacks')
        self.assertEqual(policy_packs.status, 'alpha')
        self.assertEqual(policy_packs.supported, True)
        self.assertIn('commandsWithPolicyScopes', policy_packs.selector_names)
        self.assertIn('trade', policy_packs.member_commands)
        self.assertNotIn('builtinIds', policy_packs.selector_names)
        self.assertNotIn('userIds', policy_packs.selector_names)
        self.assertNotIn('execute-with-risk-cap', policy_packs.member_commands)

        signer_profiles = profiles.require_family('signerProfiles')
        self.assertIn('commandsRequiringSecrets', signer_profiles.selector_names)
        self.assertIn('trade', signer_profiles.get_selector('commandsRequiringSecrets'))
        self.assertNotIn('signerBackends', signer_profiles.selector_names)
        self.assertNotIn('read-only', signer_profiles.member_commands)
        self.assertNotIn('external-signer', signer_profiles.member_commands)

    def test_command_policy_inspection_surfaces_scope_and_profile_membership(self) -> None:
        inspection = inspect_generated_command_policy('trade')

        self.assertEqual(inspection.command_name, 'trade')
        self.assertEqual(
            inspection.policy_scopes,
            ('network:indexer', 'network:rpc', 'secrets:use', 'trade:write'),
        )
        self.assertTrue(inspection.requires_secrets)
        self.assertTrue(inspection.supports_remote)
        self.assertTrue(inspection.remote_eligible)
        self.assertTrue(inspection.mcp_mutating)
        self.assertFalse(inspection.job_capable)
        self.assertEqual(inspection.matching_profiles['policyPacks'], ('commandsWithPolicyScopes',))
        self.assertEqual(inspection.matching_profiles['signerProfiles'], ('commandsRequiringSecrets',))

    def test_policy_profiles_handle_missing_profile_area_gracefully(self) -> None:
        profiles = PolicyProfiles.from_contract_registry(
            {
                'capabilities': {
                    'commandDigests': {
                        'help': {
                            'summary': 'Display top-level usage and global flag metadata.',
                            'policyScopes': ['help:read'],
                            'supportsRemote': True,
                            'remoteEligible': True,
                            'mcpMutating': False,
                            'jobCapable': False,
                            'requiresSecrets': False,
                        }
                    }
                }
            }
        )

        self.assertEqual(profiles.family_names(), ())
        self.assertEqual(profiles.commands_with_scopes(), ('help',))

        inspection = profiles.inspect_command('help')
        self.assertEqual(inspection.policy_scopes, ('help:read',))
        self.assertEqual(inspection.matching_profiles, {})

    def test_policy_profiles_derive_selectors_from_command_digests(self) -> None:
        profiles = PolicyProfiles.from_contract_registry(
            {
                'capabilities': {
                    'commandDigests': {
                        'help': {
                            'summary': 'Display top-level usage and global flag metadata.',
                            'policyScopes': ['help:read'],
                            'supportsRemote': True,
                            'remoteEligible': True,
                            'mcpMutating': False,
                            'jobCapable': False,
                            'requiresSecrets': False,
                        },
                        'trade': {
                            'summary': 'Execute a trade.',
                            'policyScopes': ['trade:write', 'secrets:use'],
                            'supportsRemote': True,
                            'remoteEligible': True,
                            'mcpMutating': True,
                            'jobCapable': False,
                            'requiresSecrets': True,
                        },
                    },
                    'policyProfiles': {
                        'policyPacks': {
                            'status': 'alpha',
                            'supported': True,
                            'notes': ['Policy packs are available.'],
                            'builtinIds': ['research-only'],
                        },
                        'signerProfiles': {
                            'status': 'alpha',
                            'supported': True,
                            'notes': ['Signer profiles are available.'],
                            'signerBackends': ['none'],
                        },
                    },
                }
            }
        )

        self.assertEqual(profiles.commands_for_family('policyPacks'), ('help', 'trade'))
        self.assertEqual(profiles.commands_for_family('signerProfiles'), ('trade',))

        inspection = profiles.inspect_command('trade')
        self.assertEqual(inspection.matching_profiles['policyPacks'], ('commandsWithPolicyScopes',))
        self.assertEqual(inspection.matching_profiles['signerProfiles'], ('commandsRequiringSecrets',))

    def test_client_exposes_policy_helpers(self) -> None:
        client = PandoraAgentClient(DummyBackend())

        families = client.list_policy_profile_families()
        inspection = client.inspect_command_policy('operations.cancel')

        self.assertEqual([family.name for family in families], ['policyPacks', 'signerProfiles'])
        self.assertEqual(inspection.policy_scopes, ('operations:write',))
        self.assertEqual(inspection.matching_profiles['policyPacks'], ('commandsWithPolicyScopes',))
        self.assertIn('trade', client.get_command_descriptors())
        self.assertIn('policyProfiles', client.get_capabilities())
        self.assertIn('help', client.get_tool_catalog())


if __name__ == '__main__':
    unittest.main()
