from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pandora_agent.backends import HttpPandoraBackend, StdioPandoraBackend
from pandora_agent.errors import PandoraSdkError


class _RecordingStdioBackend(StdioPandoraBackend):
    def __init__(self, messages):
        super().__init__(command='pandora')
        self._messages = list(messages)

    def _read_message(self):
        if not self._messages:
            raise PandoraSdkError('PANDORA_SDK_PROTOCOL_ERROR', 'No more test messages.')
        return self._messages.pop(0)


class BackendTests(unittest.TestCase):
    def test_http_backend_parses_streamable_http_sse_responses(self) -> None:
        backend = HttpPandoraBackend(url='http://127.0.0.1:8787/mcp')
        payload = '\n'.join(
            [
                'event: message',
                'data: {"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info"}}',
                '',
                'event: message',
                'data: {"jsonrpc":"2.0","id":7,"result":{"tools":[]}}',
                '',
            ]
        )

        message = backend._parse_http_response(payload, 'text/event-stream', expected_id=7)

        self.assertEqual(message['id'], 7)
        self.assertEqual(message['result'], {'tools': []})

    def test_stdio_backend_skips_notifications_while_waiting_for_response(self) -> None:
        backend = _RecordingStdioBackend(
            [
                {'jsonrpc': '2.0', 'method': 'notifications/progress', 'params': {'progress': 50}},
                {'jsonrpc': '2.0', 'id': 3, 'result': {'tools': []}},
            ]
        )

        message = backend._read_response(3)

        self.assertEqual(message['id'], 3)
        self.assertEqual(message['result'], {'tools': []})


if __name__ == '__main__':
    unittest.main()
