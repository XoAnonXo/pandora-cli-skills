from __future__ import annotations

import os

from pandora_agent import PandoraSdkError, PandoraToolCallError, create_remote_pandora_agent_client


def main() -> int:
    url = os.environ.get('PANDORA_MCP_URL', 'http://127.0.0.1:8787/mcp')
    token = os.environ.get('PANDORA_MCP_AUTH_TOKEN')

    try:
        with create_remote_pandora_agent_client(url=url, auth_token=token) as client:
            schema = client.call_tool('schema')
            print(f'remote schema command: {schema["command"]}')
            print(f'remote tools discovered: {len(client.list_tools())}')
            return 0
    except PandoraToolCallError as error:
        print(f'tool error {error.code}: {error}')
        return 2
    except PandoraSdkError as error:
        print(f'sdk error {error.code}: {error}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
