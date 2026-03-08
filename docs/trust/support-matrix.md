# Pandora Support Matrix

Use this matrix to understand which Pandora surfaces are primary, which are intentionally operator-hosted, which are alpha, and which are documentation/reference only.

For release artifact verification before install, use [`release-verification.md`](./release-verification.md).

## Status terms

- `Active`: shipped and intended for current consumer use
- `Operator-hosted`: shipped, but inactive until you start or host it yourself
- `Alpha`: shipped and usable, but the interface is still pre-1.0 and may change
- `Reference docs`: packaged guidance that is discoverable through the documentation index, but not itself an execution surface

## Runtime and consumer surfaces

| Surface | Current status | How consumers get it | What Pandora guarantees today | Release evidence | Current limits |
| --- | --- | --- | --- | --- | --- |
| Local CLI (`pandora`) | Active | GitHub release tarball or npm package install | Primary supported operator surface for human and JSON output. `capabilities` and `schema` are the authoritative machine-facing CLI contracts. | Release workflow is gated on Linux, macOS, and Windows validation before publish; pack/install smoke tests validate packaged CLI and JSON commands. | Live execution still depends on env or `.env` secrets for applicable commands. Shipped signer profiles do not mean every built-in backend is runtime-ready. Support level does not mean every command is safe for unattended automation. |
| Local stdio MCP (`pandora mcp`) | Active | Same package as the CLI; start locally with `pandora mcp` | Primary supported MCP transport for direct tool execution on the same machine as Pandora. | CLI/MCP integration tests plus benchmark parity for capabilities, schema, and seeded operations. | Requires local process execution. Some long-running tools are blocked in MCP v1. `launch` and `clone-bet` are intentionally not exposed over MCP. Live mutating calls require execute intent. |
| Remote streamable HTTP MCP (`pandora mcp http`) | Operator-hosted | Same package as the CLI; you must intentionally start the gateway | Shipped gateway with bearer-token scope enforcement, remote `/mcp` endpoint, and parity-tested bootstrap/operations flows. | Gateway integration tests and benchmark parity/denial checks. | The gateway is not a hosted Pandora service. It is inactive until you start it. You own lifecycle, TLS/proxying, network exposure, auth-token distribution, and signer secret placement. |
| TypeScript SDK (`sdk/typescript`) | Alpha | Embedded in the Pandora release package under `sdk/typescript` | Generated contract catalog, package-local artifacts, and swappable local/remote MCP backends for TypeScript/Node consumers. | Pack/install smoke tests verify the embedded package and generated artifacts; unit tests cover client/catalog behavior. | Pre-1.0 API. Treat as stable enough to evaluate and integrate, not as a frozen semver contract. This row describes the embedded SDK source/artifact surface shipped inside `pandora-cli-skills`, not a separate public npm release. Execution readiness for signer profiles must still be checked at runtime through `capabilities` / `profile`. |
| Python SDK (`sdk/python/pandora_agent`) | Alpha | Embedded in the Pandora release package under `sdk/python` | Generated contract catalog, package-local artifacts, policy/profile helpers, and swappable local/remote MCP backends for Python consumers. | Pack/install smoke tests verify the embedded Python package files and generated artifacts; unit coverage exists in the repository test suite. | Pre-1.0 API. The repository ships the Python package sources, but this document does not claim a separate PyPI release channel. Execution readiness for signer profiles must still be checked at runtime through `capabilities` / `profile`. |
| Benchmark harness (scenario manifests, lock file, runner scripts) | Active for local regression | Repository checkout | Full reproducible benchmark harness used by build, prepack, and release gates. | Unit tests validate lock/report parity; release flow runs benchmark gates before publish. | This is a repository maintainer surface, not installed runtime baggage. |
| Skills/runtime docs (`SKILL.md`, `docs/skills/**`) | Active | Repository and packaged release contents | Primary human docs for CLI, MCP, SDK bootstrap, workflows, and runtime routing. They are part of the runtime documentation index surfaced by `pandora --output json capabilities`. | `check:docs`, doc drift tests, packaged-doc smoke checks, and runtime `documentation.contentHash` / router metadata. | Human guidance only. The runtime source of truth for machine consumers remains `capabilities` and `schema`. |
| Benchmark docs and latest report (`docs/benchmarks/**`, `benchmarks/latest/core-report.json`) | Active reference | Repository and packaged release contents | Public explanation of the benchmark suite plus the latest shipped benchmark report. | Pack/install smoke tests confirm the docs and latest report ship with the package; release flow regenerates the latest report before publish. | These docs and reports explain the benchmark posture but are not themselves an execution surface. |
| Trust docs (`docs/trust/**`) | Active reference | Repository and packaged release contents; surfaced in the runtime documentation index | Release verification, security model, and support boundaries for external operators and agent builders. | `check:release-trust`, pack/install smoke tests, and release workflow/package metadata checks. | Human guidance only. They complement `trustDistribution`, not replace machine-readable trust metadata. |

Machine-readable trust companions exposed by `pandora --output json capabilities`:

- `trustDistribution.distribution.platformValidation`: checked-in CI/release workflow platform matrix metadata
- `trustDistribution.verification.releaseAssets`: expected release asset set and verification methods
- `trustDistribution.verification.ciWorkflow`: shipped CI workflow path plus observed OS/Node matrix

## Practical guarantees by audience

### If you are a CLI operator

You can rely on:

- the local CLI as the primary supported runtime surface
- `capabilities` and `schema` as the current machine-readable contract
- GitHub release tarballs verified by checksum, attestation, and keyless cosign

You should not assume:

- that remote MCP is running unless you or your operator started it
- that alpha SDK APIs are frozen
- that live-signing flows are risk-free without your own secret-management controls

### If you are building an agent integration

Prefer this order:

1. read `capabilities`
2. read `schema`
3. inspect the documentation index, including trust/reference docs, from `capabilities.data.documentation`
4. decide between local stdio MCP and intentionally hosted remote MCP
5. use the SDKs only if the alpha support level is acceptable for your integration

Key guidance:

- treat `pandora mcp` as the default supported execution backend
- treat `pandora mcp http` as a shipped gateway you operate, not a Pandora-managed service
- treat policy/profile metadata as shipped alpha discovery surfaces
- treat `docs/trust/**` as the human companion to `capabilities.data.trustDistribution`

### If you are evaluating release quality

The strongest current signals are:

- GitHub tag plus checksum-verified release asset
- GitHub build provenance for both the tarball and shipped SPDX SBOM asset, plus an SPDX SBOM attestation on the tarball
- keyless cosign verification against the tagged `release.yml` workflow
- passing Linux/macOS/Windows validation plus smoke, benchmark, and release-trust gates before publish

The weakest current promises are:

- SDK API stability across pre-1.0 releases
- any assumption that docs alone override `capabilities` / `schema`
- any assumption of a hosted remote MCP control plane run by Pandora

## Recommended decision rules

- Use the local CLI or local stdio MCP for the highest-confidence consumer path today.
- Use remote MCP only when you deliberately want a self-hosted remote gateway and can own the auth and runtime boundary.
- Use the TypeScript and Python SDKs when alpha package-local generated clients are useful, but keep upgrade friction budgeted.
- Use benchmark results and `trustDistribution` as release/regression signals for the checked build, not as a universal external certification score.
