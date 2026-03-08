from __future__ import annotations

import io
import unittest
import urllib.error
import urllib.request

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

    def test_http_backend_preserves_gateway_error_payload_details(self) -> None:
        backend = HttpPandoraBackend(url='http://127.0.0.1:8787/mcp', auth_token='test-token')
        request = {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize'}
        payload = (
            b'{"ok":false,"error":{"code":"FORBIDDEN","message":"Missing scope.","details":{"missingScopes":["schema:read"]}}}'
        )
        http_error = urllib.error.HTTPError(
            backend.url,
            403,
            'Forbidden',
            hdrs=None,
            fp=io.BytesIO(payload),
        )

        original_urlopen = urllib.request.urlopen

        def _raise_http_error(*args, **kwargs):
            raise http_error

        urllib.request.urlopen = _raise_http_error
        try:
            with self.assertRaises(PandoraSdkError) as context:
                backend._post(request)
        finally:
            urllib.request.urlopen = original_urlopen

        error = context.exception
        self.assertEqual(error.code, 'FORBIDDEN')
        self.assertEqual(error.details['status'], 403)
        self.assertEqual(error.details['remoteDetails']['missingScopes'], ['schema:read'])
        self.assertEqual(error.to_dict()['code'], 'FORBIDDEN')


if __name__ == '__main__':
    unittest.main()
