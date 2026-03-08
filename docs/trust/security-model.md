# Security Model

Pandora is a local-first agent runtime for prediction-market operations. Its security model is centered on strict mutation boundaries, explicit transport contracts, and verifiable release artifacts.

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

These controls are designed to prevent accidental or ambiguous writes before chain or venue side effects occur.

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
- explicit auth scopes
- conservative default scopes when `--auth-scopes` is omitted
- scope-based tool denials with structured recovery guidance
- no implicit anonymous mutation path

It is not a multi-tenant hosted control plane by itself. Operators are responsible for deployment hardening, network boundaries, and secret storage on the host running the gateway.

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
- build, prepack, and test wire benchmark, generated SDK, docs, and trust checks together
- parity failures can zero the benchmark headline score
- in the source tree, `release:prep` runs packaged-surface smoke checks, `benchmark:check`, regenerates both CycloneDX and SPDX SBOMs, and then runs release-trust checks
- in the published package, `release:prep` is narrowed to shipped verification only: `benchmark:check`, SBOM generation, and release-trust checks
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
