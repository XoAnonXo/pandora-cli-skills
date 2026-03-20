# Security Model

Pandora is a local-first agent runtime for prediction-market operations. Its security model is centered on strict mutation boundaries, explicit transport contracts, and verifiable release artifacts.

For the current operator deployment posture of the remote gateway, including reverse-proxy and TLS guidance, use [`operator-deployment.md`](./operator-deployment.md).

## Trust boundaries

### Local CLI
- Runs with the caller's local filesystem, process, and environment permissions.
- Has direct access to signer material if the operator provides raw keys or profile-backed secrets.
- Is the reference runtime for CLI JSON, stdio MCP, remote MCP gateway subprocess execution, and generated SDK parity.

### stdio MCP
- Shares the local machine trust boundary with the CLI process.
- Depends on the caller controlling process launch, working directory, and environment.
- Enforces typed tool schemas, execute-intent rules, and workspace path restrictions at the tool boundary.

### Remote MCP gateway
- Adds bearer-token authorization and scope evaluation on top of the local command runtime.
- Does not remove the need to trust the machine hosting the gateway.
- Uses explicit auth scopes and rejects tools outside the granted scope set.
- Expects TLS termination and network hardening outside the gateway process itself.

### Generated SDKs
- Are transport clients, not a separate authority layer.
- Inherit the guarantees and limitations of the backend they target: local stdio or remote HTTP MCP.

## Mutation controls

Pandora does not treat mutation as a plain tool call. The intended safety stack is:
- typed tool schema validation
- `intent.execute` gating for mutating MCP calls
- command-family preflight checks such as `agentPreflight` and validation tickets
- policy/profile restrictions when enabled
- risk guards and panic stops for live execution paths
- operation ids and state stores for long-running work
- terminal-operation receipts with tamper-evident receipt hashes and checkpoint digests

These controls are designed to prevent accidental or ambiguous writes before chain or venue side effects occur.

## Operation receipts

Terminal mutable operations produce a durable receipt artifact in the same private operations store used for lifecycle state.

Receipt purpose:
- prove which canonical command/tool/action produced the terminal outcome
- bind the stored outcome to a specific operation id/hash
- make post-execution tampering visible through `receiptHash` and `checkpointDigest`

Receipt scope:
- local/runtime trust artifact
- complements release provenance and benchmark evidence
- does not replace package verification, auth scope review, or signer hygiene

Current deployment rule:
- assume local receipt storage is available for terminal mutable operations
- authenticated gateways expose remote receipt fetch and verification at `/operations/<operation-id>/receipt` and `/operations/<operation-id>/receipt/verify`

## Filesystem and workspace safety

For agent-facing paths, Pandora treats arbitrary filesystem reads as a security boundary.
- MCP path-like flags are restricted to the active workspace for guarded command families.
- Mirror, sports, lifecycle, model, and related flows reject out-of-workspace file inputs in MCP mode.
- The remote gateway does not grant broader file access than the local runtime already exposes.

Local CLI usage remains operator-controlled and may intentionally reference files outside the workspace.

## Secrets and signer material

Preferred operating model:
- named signer profiles
- policy packs
- explicit environment/profile resolution

Compatibility paths still exist for raw secret flags and env vars. Those are supported because the live CLI still accepts them, but they are not the preferred long-term agent operating model.

Pandora attempts to avoid secret leakage by:
- redacting private keys in error paths
- avoiding logging raw credentials in daemon metadata
- keeping execute gating separate from read-only discovery flows

## Remote gateway auth model

The remote MCP gateway is intentionally simple and self-hostable.
- bearer token auth
- static multi-principal token files via `--auth-tokens-file`
- explicit auth scopes
- conservative default scopes when `--auth-scopes` is omitted
- scope-based tool denials with structured recovery guidance
- no implicit anonymous mutation path

Recommended persona model:
- derive bearer-token records from `capabilities.data.principalTemplates`
- keep one token per principal template or deployment persona
- prefer the shipped least-privilege templates:
  - `read-only-researcher`
  - `operator`
  - `auditor`
  - `recipe-validator`
  - `benchmark-runner`
- widen scopes only after `bootstrap`, `policy explain`, or `profile explain` proves a specific workflow needs them

Important boundary:
- principal templates are reference metadata and token-record examples
- they do not create identities or store signer secrets for you
- runtime token rotation and revocation now exist only for the multi-principal `--auth-tokens-file` mode; single-token modes remain intentionally limited

It is not a multi-tenant hosted control plane by itself. Operators are responsible for deployment hardening, network boundaries, and secret storage on the host running the gateway.

Current deployment limits:
- no built-in TLS
- no hosted multi-tenant control plane
- no durable revoke semantics for single-token modes
- no Prometheus-native metrics exposition

Current runtime posture:
- unauthenticated `GET /health` is a shallow liveness probe
- unauthenticated `GET /ready` is a structured readiness probe that can return `503` when required gateway dependencies are not ready
- authenticated `GET /metrics` is a JSON operational metrics endpoint gated by bearer auth and `capabilities:read`
- every HTTP response includes `x-request-id`, and operation responses also include `x-pandora-operation-id` when an operation id is known

## Webhook delivery semantics

Webhook delivery is intended to be auditable and bounded rather than best-effort fire-and-forget.

Current delivery behavior:
- each outbound delivery gets a stable `deliveryId`
- Pandora sends tracing headers:
  - `x-pandora-delivery-id`
  - `x-pandora-generated-at`
  - `x-pandora-event`
  - `x-pandora-attempt`
  - `x-pandora-correlation-id` when an operation correlation id exists
- signed webhook deliveries include both:
  - `x-pandora-signature`
  - `x-pandora-signature-sha256`
- retry policy is exponential backoff with bounded attempts
- retries are only attempted for network failures, timeouts, `429`, and `5xx`-class responses
- non-retryable `4xx` responses fail closed as permanent delivery failures

Operational expectations:
- use endpoint-side idempotency keyed by `x-pandora-delivery-id`
- log `x-request-id`, `x-pandora-delivery-id`, and `x-pandora-correlation-id` together when debugging webhook paths
- treat webhook delivery reports as runtime evidence, not as a replacement for operation receipts

## Release trust

Pandora release trust is layered:
- npm/package integrity checks
- SHA-256 digests
- keyless cosign signatures
- GitHub provenance attestations
- GitHub SBOM attestations

These controls help consumers verify that release artifacts came from the expected tagged GitHub workflow and have not been tampered with after build.

## Benchmarks and release gates

Pandora treats agent readiness as a release surface.
- the repository uses a verify-once, pack-once, publish-tarball release model
- repo verification is concentrated in `verify:repo`, `verify:tests`, `release:verify`, `release:finalize`, and `release:prep`
- parity failures can zero the benchmark headline score
- in the source tree, `verify:repo` covers compile/docs/SDK/secret-scan checks, `release:verify` runs that repo verification surface once alongside tests and benchmark gating, `release:finalize` refreshes benchmark and SBOM artifacts, and `release:prep` layers the final release-trust and release-drift checks on top
- the supported local maintainer publish path is `npm run release:publish`, which runs `release:verify`, `release:finalize`, packs the tarball once, reuses that tarball for the final trust gate, then publishes it; direct source-tree `npm publish` is intentionally blocked
- `prepack` is packaging-only: it prepares the publish-safe manifest and `postpack` restores the repository manifest after the tarball is built
- smoke builds one publish-safe tarball and reuses it across both packaged-surface smoke checks, avoiding recursive release hooks and duplicate packaging work
- the tagged GitHub release workflow is gated on Linux/macOS/Windows validation before packaging release assets

This does not guarantee perfect safety for every deployment. It does guarantee that the published contract, generated SDKs, and benchmark pack are checked together before release.

## What Pandora explicitly does not guarantee

Pandora does not guarantee:
- profitability or market correctness
- hosted key custody or HSM-backed signing by default
- perfect protection against a fully compromised local machine
- safe autonomous execution without operator-selected policies, profiles, and limits
- that third-party venues, indexers, or sportsbooks behave honestly or remain available

Operators still need environment hardening, credential hygiene, and policy discipline.
