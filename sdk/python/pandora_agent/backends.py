from __future__ import annotations

import json
import os
import subprocess
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from .errors import PandoraSdkError, PandoraToolCallError
from .catalog import load_generated_manifest

LATEST_PROTOCOL_VERSION = '2025-11-25'


def _build_jsonrpc_request(request_id: int, method: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    payload = {
        'jsonrpc': '2.0',
        'id': request_id,
        'method': method,
    }
    if params is not None:
        payload['params'] = params
    return payload


def _build_jsonrpc_notification(method: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    payload = {
        'jsonrpc': '2.0',
        'method': method,
    }
    if params is not None:
        payload['params'] = params
    return payload


def normalize_tool_envelope(result: Dict[str, Any]) -> Dict[str, Any]:
    envelope = result.get('structuredContent') if isinstance(result.get('structuredContent'), dict) else None

    def raise_tool_error(default_message: str, fallback_code: str = 'PANDORA_SDK_TOOL_ERROR') -> None:
        error_payload = envelope.get('error') if isinstance(envelope, dict) and isinstance(envelope.get('error'), dict) else {}
        code = error_payload.get('code') if isinstance(error_payload.get('code'), str) else fallback_code
        message = error_payload.get('message') if isinstance(error_payload.get('message'), str) else default_message
        details = error_payload.get('details') if 'details' in error_payload else {'result': result}
        if not isinstance(details, dict):
            details = {'details': details}
        if 'result' not in details:
            details['result'] = result
        raise PandoraToolCallError(code, message, details, envelope=envelope, result=result)

    if bool(result.get('isError')):
        raise_tool_error('Pandora tool returned an MCP error result.')
    if isinstance(result.get('structuredContent'), dict):
        envelope = result['structuredContent']
        if envelope.get('ok') is False:
            raise_tool_error('Pandora tool returned a failure envelope.')
        return envelope
    for item in result.get('content', []) or []:
        if isinstance(item, dict) and item.get('type') == 'text' and isinstance(item.get('text'), str):
            try:
                envelope = json.loads(item['text'])
            except json.JSONDecodeError as error:
                raise PandoraSdkError(
                    'PANDORA_SDK_INVALID_TOOL_RESULT',
                    'Tool result text was not valid JSON.',
                    {'text': item['text']},
                ) from error
            if not isinstance(envelope, dict):
                raise PandoraSdkError(
                    'PANDORA_SDK_INVALID_TOOL_RESULT',
                    'Tool result JSON must decode to an object envelope.',
                    {'parsedType': type(envelope).__name__},
                )
            if isinstance(envelope, dict) and envelope.get('ok') is False:
                raise_tool_error('Pandora tool returned a failure envelope.')
            return envelope
    raise PandoraSdkError('PANDORA_SDK_INVALID_TOOL_RESULT', 'Tool result did not include structuredContent or JSON text.', result)


def _normalize_runtime_tool_definition(tool: Dict[str, Any], catalog: Dict[str, Any]) -> Dict[str, Any]:
    raw_tool = dict(tool or {})
    name = raw_tool.get('name') if isinstance(raw_tool.get('name'), str) else ''
    name = name.strip()
    input_schema = raw_tool.get('inputSchema') if isinstance(raw_tool.get('inputSchema'), dict) else {}
    runtime_metadata = None
    if isinstance(input_schema.get('xPandora'), dict):
        runtime_metadata = input_schema['xPandora']
    elif isinstance(raw_tool.get('xPandora'), dict):
        runtime_metadata = raw_tool['xPandora']
    descriptors = catalog.get('commandDescriptors') if isinstance(catalog.get('commandDescriptors'), dict) else {}
    descriptor = descriptors.get(name) if isinstance(descriptors, dict) else None
    if runtime_metadata is None and isinstance(descriptor, dict):
        runtime_metadata = descriptor
    policy_scopes = []
    if isinstance(runtime_metadata, dict) and isinstance(runtime_metadata.get('policyScopes'), list):
        policy_scopes = [str(value) for value in runtime_metadata['policyScopes']]
    return {
        **raw_tool,
        'name': name,
        'description': raw_tool.get('description') if isinstance(raw_tool.get('description'), str) else None,
        'inputSchema': input_schema,
        'xPandora': runtime_metadata if isinstance(runtime_metadata, dict) else None,
        'commandDescriptor': descriptor if isinstance(descriptor, dict) else None,
        'policyScopes': policy_scopes,
        'requiresSecrets': bool(isinstance(runtime_metadata, dict) and runtime_metadata.get('requiresSecrets') is True),
        'supportsRemote': bool(isinstance(runtime_metadata, dict) and runtime_metadata.get('supportsRemote') is True),
        'remoteEligible': bool(isinstance(runtime_metadata, dict) and runtime_metadata.get('remoteEligible') is True),
        'canonicalTool': runtime_metadata.get('canonicalTool') if isinstance(runtime_metadata, dict) and isinstance(runtime_metadata.get('canonicalTool'), str) else None,
        'aliasOf': runtime_metadata.get('aliasOf') if isinstance(runtime_metadata, dict) and isinstance(runtime_metadata.get('aliasOf'), str) else None,
        'preferred': bool(isinstance(runtime_metadata, dict) and runtime_metadata.get('preferred') is True),
    }


def _normalize_authorization_headers(headers: Optional[Dict[str, str]], auth_token: Optional[str]) -> Dict[str, str]:
    normalized: Dict[str, str] = dict(headers or {})
    authorization_keys = [key for key in normalized.keys() if isinstance(key, str) and key.lower() == 'authorization']
    if len(authorization_keys) > 1:
        raise PandoraSdkError(
            'PANDORA_SDK_INVALID_REMOTE_CONFIG',
            'Remote backend received multiple Authorization header variants. Provide only one authorization header.',
            {'headerKeys': authorization_keys},
        )
    if auth_token and authorization_keys:
        raise PandoraSdkError(
            'PANDORA_SDK_INVALID_REMOTE_CONFIG',
            'Remote backend cannot accept auth_token together with an explicit Authorization header.',
            {'headerKey': authorization_keys[0]},
        )
    if authorization_keys and authorization_keys[0] != 'Authorization':
        value = normalized.pop(authorization_keys[0])
        normalized['Authorization'] = value
    return normalized


class BasePandoraBackend:
    def connect(self) -> None:
        raise NotImplementedError

    def close(self) -> None:
        raise NotImplementedError

    def list_tools(self) -> List[Dict[str, Any]]:
        raise NotImplementedError

    def call_tool(self, name: str, args: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        raise NotImplementedError


class HttpPandoraBackend(BasePandoraBackend):
    def __init__(
        self,
        url: str,
        auth_token: Optional[str] = None,
        headers: Optional[Dict[str, str]] = None,
        timeout: float = 30.0,
        client_name: str = 'thisispandora-agent-python',
        client_version: Optional[str] = None,
    ):
        self.url = url
        self.auth_token = auth_token
        self.headers = _normalize_authorization_headers(headers, auth_token)
        self.timeout = timeout
        self.client_name = client_name
        self.client_version = client_version or str(load_generated_manifest().get('packageVersion') or '0.0.0')
        self._request_id = 0
        self._session_id = None
        self._protocol_version = None
        self._connected = False

    def _next_id(self) -> int:
        self._request_id += 1
        return self._request_id

    def _build_headers(self) -> Dict[str, str]:
        headers = {
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream',
            **self.headers,
        }
        if self.auth_token:
            headers['Authorization'] = f'Bearer {self.auth_token}'
        if self._session_id:
            headers['mcp-session-id'] = self._session_id
        if self._protocol_version:
            headers['mcp-protocol-version'] = self._protocol_version
        return headers

    def _parse_sse_response(self, raw: str, expected_id: Optional[int]) -> Optional[Dict[str, Any]]:
        messages: List[Dict[str, Any]] = []
        event_data: List[str] = []

        def flush_event() -> None:
            if not event_data:
                return
            payload = '\n'.join(event_data).strip()
            event_data.clear()
            if not payload:
                return
            try:
                message = json.loads(payload)
            except json.JSONDecodeError as error:
                raise PandoraSdkError(
                    'PANDORA_SDK_PROTOCOL_ERROR',
                    'Remote MCP returned invalid SSE JSON payload.',
                    {'payload': payload},
                ) from error
            if isinstance(message, dict):
                messages.append(message)

        for line in raw.splitlines():
            if not line:
                flush_event()
                continue
            if line.startswith(':'):
                continue
            if line.startswith('data:'):
                event_data.append(line[5:].lstrip())

        flush_event()

        if expected_id is not None:
            for message in messages:
                if message.get('id') == expected_id:
                    return message
        for message in messages:
            if 'result' in message or 'error' in message or message.get('id') is not None:
                return message
        return None

    def _parse_http_response(self, raw: str, content_type: str, expected_id: Optional[int]) -> Optional[Dict[str, Any]]:
        payload = raw.strip()
        if not payload:
            return None
        if 'text/event-stream' in content_type:
            return self._parse_sse_response(payload, expected_id)
        try:
            message = json.loads(payload)
        except json.JSONDecodeError as error:
            raise PandoraSdkError(
                'PANDORA_SDK_PROTOCOL_ERROR',
                'Remote MCP returned invalid JSON payload.',
                {'payload': payload},
            ) from error
        if isinstance(message, dict):
            return message
        raise PandoraSdkError(
            'PANDORA_SDK_PROTOCOL_ERROR',
            'Remote MCP returned a non-object JSON payload.',
            {'payload': message},
        )

    def _post(self, payload: Dict[str, Any], expect_response: bool = True) -> Optional[Dict[str, Any]]:
        expected_id = payload.get('id') if isinstance(payload.get('id'), int) else None
        body = json.dumps(payload).encode('utf-8')
        request = urllib.request.Request(self.url, data=body, headers=self._build_headers(), method='POST')
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                session_id = response.headers.get('mcp-session-id')
                if session_id:
                    self._session_id = session_id
                raw = response.read().decode('utf-8')
                content_type = response.headers.get('content-type', '')
                if not expect_response:
                    return None
                parsed = self._parse_http_response(raw, content_type, expected_id)
                if parsed is None:
                    raise PandoraSdkError(
                        'PANDORA_SDK_PROTOCOL_ERROR',
                        'Remote MCP did not return a JSON-RPC response payload.',
                        {'contentType': content_type, 'body': raw.strip() or None},
                    )
                return parsed
        except urllib.error.HTTPError as error:
            message = error.read().decode('utf-8', errors='replace')
            details: Dict[str, Any] = {
                'status': error.code,
                'body': message or None,
                'url': self.url,
            }
            try:
                parsed_message = json.loads(message) if message else None
            except json.JSONDecodeError:
                parsed_message = None
            if isinstance(parsed_message, dict):
                details['response'] = parsed_message
                error_payload = parsed_message.get('error') if isinstance(parsed_message.get('error'), dict) else {}
                code = error_payload.get('code') if isinstance(error_payload.get('code'), str) else 'PANDORA_SDK_HTTP_ERROR'
                formatted_message = error_payload.get('message') if isinstance(error_payload.get('message'), str) else f'HTTP {error.code}: {message}'
                if 'details' in error_payload:
                    details['remoteDetails'] = error_payload.get('details')
                if 'recovery' in error_payload:
                    details['recovery'] = error_payload.get('recovery')
                raise PandoraSdkError(code, formatted_message, details) from error
            raise PandoraSdkError('PANDORA_SDK_HTTP_ERROR', f'HTTP {error.code}: {message}', details) from error
        except urllib.error.URLError as error:
            raise PandoraSdkError(
                'PANDORA_SDK_HTTP_ERROR',
                str(error),
                {
                    'reason': str(getattr(error, 'reason', error)),
                    'url': self.url,
                },
            ) from error

    def connect(self) -> None:
        if self._connected:
            return
        response = self._post(
            _build_jsonrpc_request(
                self._next_id(),
                'initialize',
                {
                    'protocolVersion': LATEST_PROTOCOL_VERSION,
                    'capabilities': {},
                    'clientInfo': {
                        'name': self.client_name,
                        'version': self.client_version,
                    },
                },
            )
        )
        if not response or 'result' not in response:
            raise PandoraSdkError('PANDORA_SDK_REMOTE_INIT_FAILED', 'Remote MCP initialize did not return a result.', response)
        result = response['result']
        self._protocol_version = result.get('protocolVersion') or LATEST_PROTOCOL_VERSION
        self._post(_build_jsonrpc_notification('notifications/initialized'), expect_response=False)
        self._connected = True

    def close(self) -> None:
        if self._connected and self._session_id:
            request = urllib.request.Request(self.url, headers=self._build_headers(), method='DELETE')
            try:
                with urllib.request.urlopen(request, timeout=self.timeout):
                    pass
            except (urllib.error.HTTPError, urllib.error.URLError):
                pass
        self._connected = False
        self._session_id = None

    def list_tools(self) -> List[Dict[str, Any]]:
        if not self._connected:
            raise PandoraSdkError('PANDORA_SDK_NOT_CONNECTED', 'Call connect() before list_tools().')
        response = self._post(_build_jsonrpc_request(self._next_id(), 'tools/list', {}))
        if not response or 'result' not in response:
            raise PandoraSdkError('PANDORA_SDK_REMOTE_LIST_FAILED', 'Remote MCP tools/list did not return a result.', response)
        return list(response['result'].get('tools', []))

    def call_tool(self, name: str, args: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if not self._connected:
            raise PandoraSdkError('PANDORA_SDK_NOT_CONNECTED', 'Call connect() before call_tool().')
        response = self._post(_build_jsonrpc_request(self._next_id(), 'tools/call', {'name': name, 'arguments': args or {}}))
        if not response or 'result' not in response:
            raise PandoraSdkError('PANDORA_SDK_REMOTE_CALL_FAILED', 'Remote MCP tools/call did not return a result.', response)
        return response['result']


class StdioPandoraBackend(BasePandoraBackend):
    def __init__(
        self,
        command: str = 'pandora',
        args: Optional[List[str]] = None,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        client_name: str = 'thisispandora-agent-python',
        client_version: Optional[str] = None,
    ):
        self.command = command
        self.args = list(args or ['mcp'])
        self.cwd = cwd
        self.env = dict(env or {})
        self.client_name = client_name
        self.client_version = client_version or str(load_generated_manifest().get('packageVersion') or '0.0.0')
        self._process = None
        self._request_id = 0
        self._connected = False

    def _next_id(self) -> int:
        self._request_id += 1
        return self._request_id

    def _write_message(self, payload: Dict[str, Any]) -> None:
        if self._process is None or self._process.stdin is None:
            raise PandoraSdkError('PANDORA_SDK_PROCESS_NOT_RUNNING', 'Pandora MCP process is not running.')
        body = (json.dumps(payload) + '\n').encode('utf-8')
        self._process.stdin.write(body)
        self._process.stdin.flush()

    def _read_message(self) -> Dict[str, Any]:
        if self._process is None or self._process.stdout is None:
            raise PandoraSdkError('PANDORA_SDK_PROCESS_NOT_RUNNING', 'Pandora MCP process is not running.')
        line = self._process.stdout.readline()
        if not line:
            stderr_text = ''
            if self._process.stderr is not None:
                try:
                    stderr_text = self._process.stderr.read().decode('utf-8', errors='replace').strip()
                except Exception:
                    stderr_text = ''
            raise PandoraSdkError(
                'PANDORA_SDK_PROTOCOL_ERROR',
                'Unexpected EOF while reading MCP response line.',
                {'stderr': stderr_text or None},
            )
        if line.startswith(b'Content-Length:'):
            header_lines = [line]
            while True:
                next_line = self._process.stdout.readline()
                if not next_line:
                    raise PandoraSdkError('PANDORA_SDK_PROTOCOL_ERROR', 'Unexpected EOF while reading MCP headers.')
                header_lines.append(next_line)
                if next_line in (b'\n', b'\r\n'):
                    break
            header_map = {}
            for header_line in header_lines:
                decoded = header_line.decode('utf-8', errors='replace').strip()
                if not decoded or ':' not in decoded:
                    continue
                key, value = decoded.split(':', 1)
                header_map[key.strip().lower()] = value.strip()
            try:
                body_length = int(header_map.get('content-length', '0'))
            except ValueError as error:
                raise PandoraSdkError('PANDORA_SDK_PROTOCOL_ERROR', 'Invalid MCP Content-Length header.', {'headers': header_map}) from error
            body = self._process.stdout.read(body_length)
            return json.loads(body.decode('utf-8'))
        return json.loads(line.decode('utf-8'))

    def _read_response(self, expected_id: int) -> Dict[str, Any]:
        while True:
            message = self._read_message()
            if message.get('id') == expected_id:
                return message
            if 'method' in message and 'id' not in message:
                continue
            raise PandoraSdkError(
                'PANDORA_SDK_PROTOCOL_ERROR',
                'Received unexpected MCP response while waiting for request result.',
                {'expectedId': expected_id, 'message': message},
            )

    def connect(self) -> None:
        if self._connected:
            return
        env = os.environ.copy()
        env.update(self.env)
        self._process = subprocess.Popen(
            [self.command, *self.args],
            cwd=self.cwd,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self._write_message(_build_jsonrpc_request(
            self._next_id(),
            'initialize',
            {
                'protocolVersion': LATEST_PROTOCOL_VERSION,
                'capabilities': {},
                'clientInfo': {'name': self.client_name, 'version': self.client_version},
            },
        ))
        response = self._read_response(self._request_id)
        if 'result' not in response:
            raise PandoraSdkError('PANDORA_SDK_STDIO_INIT_FAILED', 'Local MCP initialize did not return a result.', response)
        self._write_message(_build_jsonrpc_notification('notifications/initialized'))
        self._connected = True

    def close(self) -> None:
        if self._process is not None:
            if self._process.stdin:
                self._process.stdin.close()
            self._process.terminate()
            try:
                self._process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self._process.kill()
        self._process = None
        self._connected = False

    def list_tools(self) -> List[Dict[str, Any]]:
        if not self._connected:
            raise PandoraSdkError('PANDORA_SDK_NOT_CONNECTED', 'Call connect() before list_tools().')
        request_id = self._next_id()
        self._write_message(_build_jsonrpc_request(request_id, 'tools/list', {}))
        response = self._read_response(request_id)
        if 'result' not in response:
            raise PandoraSdkError('PANDORA_SDK_STDIO_LIST_FAILED', 'Local MCP tools/list did not return a result.', response)
        return list(response['result'].get('tools', []))

    def call_tool(self, name: str, args: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if not self._connected:
            raise PandoraSdkError('PANDORA_SDK_NOT_CONNECTED', 'Call connect() before call_tool().')
        request_id = self._next_id()
        self._write_message(_build_jsonrpc_request(request_id, 'tools/call', {'name': name, 'arguments': args or {}}))
        response = self._read_response(request_id)
        if 'result' not in response:
            raise PandoraSdkError('PANDORA_SDK_STDIO_CALL_FAILED', 'Local MCP tools/call did not return a result.', response)
        return response['result']
