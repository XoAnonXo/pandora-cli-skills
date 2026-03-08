# Remote Gateway Operator Deployment

Use this guide when you want to run `pandora mcp http` as a long-lived operator-hosted control-plane process.

This document is intentionally strict about what the current runtime actually supports.
If a capability is not described here, do not assume it exists.

## What the runtime supports today

Current remote-gateway facts from the live runtime:

- transport: streamable HTTP MCP over the built-in Node HTTP server
- auth: bearer token required on every authenticated endpoint
- token models:
  - single token: `--auth-token` or `--auth-token-file`
  - multi-principal static token file: `--auth-tokens-file`
- auth admin/runtime endpoints:
  - `GET /auth`
  - `GET /auth/current`
  - `GET /auth/principals`
  - `POST /auth/principals/{principalId}/rotate`
  - `POST /auth/principals/{principalId}/revoke`
- bootstrap and discovery endpoints:
  - `GET /health`
  - `GET /ready`
  - `GET /bootstrap`
  - `GET /capabilities`
  - `GET /schema`
  - `GET /tools`
  - `GET /metrics`
  - `GET /operations`
  - `GET /operations/{operationId}/receipt`
  - `GET /operations/{operationId}/receipt/verify`
  - `GET /operations/{operationId}/webhooks`
  - `POST /operations/{operationId}/cancel`
  - `POST /operations/{operationId}/close`
  - `GET|POST|DELETE /mcp`
- advertised URL override:
  - `--public-base-url`
- reverse-proxy awareness:
  - uses `X-Forwarded-Proto` and `X-Forwarded-Host` when `--public-base-url` is not set

## What the runtime does not support yet

These are current runtime limits, not documentation gaps:

- no built-in TLS listener
- no built-in HTTP-to-HTTPS redirect
- no official Docker image published by the release workflow
- no shipped systemd unit file or Kubernetes manifests

Current caveats on the shipped runtime:

- `/metrics` is a JSON metrics document, not Prometheus exposition format
- auth rotation/revocation is available only through the multi-principal `--auth-tokens-file` mode
- single-token modes (`--auth-token`, `--auth-token-file`, generated token mode) do not support durable revoke semantics
- `--auth-tokens-file` supports live reload on external file edits, but you should still treat it as an operator-controlled control-plane input

Plan deployment around those constraints.

## Recommended topology

Use this shape in production-like environments:

1. Run `pandora mcp http` bound to `127.0.0.1` or another private interface.
2. Terminate TLS at a reverse proxy.
3. Set `--public-base-url` to the externally reachable HTTPS URL.
4. Keep signer material and profile secrets only on the host running Pandora.
5. Use `--auth-tokens-file` for multi-principal operation.
6. Persist the Pandora home directory so generated auth tokens and operation state survive restart.

Minimal example:

```bash
pandora mcp http \
  --host 127.0.0.1 \
  --port 8787 \
  --public-base-url https://pandora.example.com \
  --auth-tokens-file /etc/pandora/auth-tokens.json
```

## Auth token file format

`--auth-tokens-file` expects JSON with a non-empty `tokens` array or a top-level array.

Example:

```json
{
  "tokens": [
    {
      "id": "researcher",
      "token": "replace-with-long-random-token",
      "scopes": [
        "capabilities:read",
        "contracts:read",
        "schema:read",
        "operations:read"
      ]
    },
    {
      "id": "operator",
      "token": "replace-with-different-long-random-token",
      "scopes": [
        "capabilities:read",
        "contracts:read",
        "schema:read",
        "operations:read",
        "operations:write",
        "secrets:use"
      ]
    }
  ]
}
```

Current management model:

- edit the token file directly and let the gateway live-reload it, or
- use:
  - `GET /auth/current`
  - `GET /auth/principals`
  - `POST /auth/principals/{principalId}/rotate`
  - `POST /auth/principals/{principalId}/revoke`
- rotation/revocation endpoints require:
  - bearer auth
  - `gateway:auth:write`
  - request body `{"intent":"execute"}`
- principal listing requires `gateway:auth:read`
- distribute newly-issued rotated tokens out of band; the gateway only returns a new secret at rotation time

## systemd reference

Pandora does not currently ship a systemd unit file, but the runtime works cleanly under one.

Example:

```ini
[Unit]
Description=Pandora MCP HTTP Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pandora
Group=pandora
WorkingDirectory=/srv/pandora
Environment=HOME=/srv/pandora
ExecStart=/usr/bin/env pandora mcp http --host 127.0.0.1 --port 8787 --public-base-url https://pandora.example.com --auth-tokens-file /etc/pandora/auth-tokens.json
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/srv/pandora /etc/pandora

[Install]
WantedBy=multi-user.target
```

Operator notes:

- keep `/srv/pandora` writable because Pandora stores generated runtime artifacts under `~/.pandora`
- keep `/etc/pandora/auth-tokens.json` readable by the service user only
- use journald or your own log shipper for process logs

## Reverse proxy and TLS

Pandora's HTTP gateway does not speak TLS itself.
Terminate TLS in front of it.

### Nginx reference

```nginx
server {
  listen 443 ssl http2;
  server_name pandora.example.com;

  ssl_certificate /etc/letsencrypt/live/pandora.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/pandora.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

### Caddy reference

```caddy
pandora.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

Deployment rules:

- prefer `--public-base-url https://pandora.example.com` even when the proxy forwards host/proto headers correctly
- do not expose the gateway directly on a public `0.0.0.0` bind without a reverse proxy and TLS terminator
- keep bearer tokens out of proxy access logs

## Docker reference

Pandora does not currently publish an official container image.
If you want a container, build your own and treat it as operator-owned.

Example Dockerfile:

```dockerfile
FROM node:20-alpine

RUN adduser -D -h /home/pandora pandora \
  && npm install -g pandora-cli-skills@1.1.70

USER pandora
WORKDIR /home/pandora
ENV HOME=/home/pandora

ENTRYPOINT ["pandora", "mcp", "http"]
CMD ["--host", "0.0.0.0", "--port", "8787"]
```

Example run command:

```bash
docker run --rm \
  -p 8787:8787 \
  -v "$(pwd)/auth-tokens.json:/home/pandora/auth-tokens.json:ro" \
  -v pandora-home:/home/pandora \
  pandora-mcp-http:local \
  --auth-tokens-file /home/pandora/auth-tokens.json \
  --public-base-url https://pandora.example.com
```

Container-specific cautions:

- the release workflow does not verify or publish this image for you
- persist `/home/pandora` if you care about generated token files, operation state, and receipts
- still place TLS and external auth policy in front of the container

## Health and observability

Current observability surface:

- `GET /health`
- `GET /ready`
- `GET /metrics`
- process logs on stdout/stderr
- operation status, receipts, and webhook delivery ledgers via `/operations`

`/health` currently returns:

- `service`
- `version`
- `uptimeSeconds`
- configured endpoint paths
- `authRequired`
- request counters

What you should not assume:

- `/health` is not a deep dependency probe
- `/health` is not the readiness contract
- `/metrics` is JSON, not Prometheus text format

Recommended operator pattern:

- use `/health` for liveness
- use `/ready` for structured readiness
- use `/bootstrap` or `/capabilities` for higher-confidence authenticated readiness
- scrape `/metrics` through your own collector or transform layer if you need Prometheus-compatible ingestion
- collect process logs externally
- treat operation receipts as post-execution audit evidence, not health telemetry

## Webhook and long-running operation caveats

The runtime has webhook and operation machinery, and the gateway now exposes delivery inspection at:

- `GET /operations/{operationId}/webhooks`

What that surface gives you:

- append-only delivery ledger records per operation
- delivery success/failure state
- retry exhaustion vs permanent failure distinction
- delivery policy, context, and report payloads

What it does not give you:

- a global cross-operation delivery index
- webhook re-drive from the gateway
- a hosted queue/worker control plane

Current production implication:

- do not promise external operators a full remote webhook observability surface yet
- if webhook delivery visibility is required, capture the process logs and operation state locally

## Production guidance you can rely on today

Safe claims:

- the gateway can be run behind a reverse proxy with TLS termination
- bearer-token scope enforcement works
- multi-principal static token files work
- `--public-base-url` lets discovery payloads advertise the external URL
- terminal operation receipts can be fetched and verified remotely when `operations:read` is granted

Unsafe claims today:

- that Pandora ships a managed hosted control plane
- that the runtime has native TLS, metrics, or readiness separation
- that token rotation can be done without restart
- that official container/orchestration artifacts are part of the release

## Runtime blockers for stronger production guidance

These are the concrete runtime gaps that still limit the deployment story:

1. no native TLS listener
2. no `/metrics` endpoint
3. no `/ready` or deep readiness probe
4. no token rotation/revocation API
5. no official container image or orchestrator manifests
6. no remote webhook delivery inspection surface

Until those exist, the operator deployment story should stay framed as self-hosted and proxy-fronted.
