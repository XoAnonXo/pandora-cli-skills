from __future__ import annotations

import unittest
from typing import Any, Dict, List, Optional

from pandora_agent import PandoraAgentClient, PandoraToolCallError, __version__
from pandora_agent.backends import normalize_tool_envelope


class _TrackingBackend:
    def __init__(self) -> None:
        self.connected = False
        self.connect_calls = 0
        self.close_calls = 0

    def connect(self) -> None:
        self.connected = True
        self.connect_calls += 1

    def close(self) -> None:
        self.connected = False
        self.close_calls += 1

    def list_tools(self) -> List[Dict[str, Any]]:
        return []

    def call_tool(self, name: str, args: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        raise AssertionError('call_tool should not be used in client lifecycle tests')


class ClientErgonomicsTests(unittest.TestCase):
    def test_client_supports_context_manager_lifecycle(self) -> None:
        backend = _TrackingBackend()

        with PandoraAgentClient(backend) as client:
            self.assertTrue(backend.connected)
            self.assertIs(client.backend, backend)

        self.assertEqual(backend.connect_calls, 1)
        self.assertEqual(backend.close_calls, 1)
        self.assertFalse(backend.connected)

    def test_version_export_matches_python_package_manifest(self) -> None:
        client = PandoraAgentClient(_TrackingBackend())

        self.assertEqual(__version__, client.get_manifest()['packageVersion'])

    def test_normalize_tool_envelope_raises_tool_error_with_pandora_code(self) -> None:
        with self.assertRaises(PandoraToolCallError) as context:
            normalize_tool_envelope(
                {
                    'isError': True,
                    'structuredContent': {
                        'ok': False,
                        'error': {
                            'code': 'FORBIDDEN',
                            'message': 'trade requires secrets:use.',
                            'details': {
                                'missingScopes': ['secrets:use'],
                            },
                        },
                    },
                }
            )

        error = context.exception
        self.assertEqual(error.code, 'FORBIDDEN')
        self.assertEqual(error.details['missingScopes'], ['secrets:use'])
        self.assertEqual(error.envelope['error']['code'], 'FORBIDDEN')
        self.assertEqual(error.to_dict()['code'], 'FORBIDDEN')

    def test_normalize_tool_envelope_falls_back_to_sdk_wrapper_code_without_tool_code(self) -> None:
        with self.assertRaises(PandoraToolCallError) as context:
            normalize_tool_envelope(
                {
                    'isError': True,
                    'structuredContent': {
                        'ok': False,
                        'error': {
                            'message': 'Tool failed without a stable code.',
                        },
                    },
                }
            )

        error = context.exception
        self.assertEqual(error.code, 'PANDORA_SDK_TOOL_ERROR')
        self.assertEqual(str(error), 'Tool failed without a stable code.')


if __name__ == '__main__':
    unittest.main()
