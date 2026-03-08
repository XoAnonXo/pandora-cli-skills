from __future__ import annotations

from pandora_agent import PandoraSdkError, create_local_pandora_agent_client


def main() -> int:
    try:
        with create_local_pandora_agent_client(command='pandora') as client:
            capabilities = client.call_tool('capabilities')
            tool_names = [tool['name'] for tool in client.list_tools()]
            print(f'connected to local Pandora MCP; discovered {len(tool_names)} tools')
            print(f'capabilities command: {capabilities["command"]}')
            return 0
    except PandoraSdkError as error:
        print(f'{error.code}: {error}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
