# Pandora Support Matrix

Use this matrix to understand which Pandora surfaces are primary, which are intentionally operator-hosted, which are alpha, and which are documentation/reference only.

For release artifact verification before install, use [`release-verification.md`](./release-verification.md).
For the release-blocking A+ signoff contract, use [`final-readiness-signoff.md`](./final-readiness-signoff.md).
For the maintainer one-tag publication flow that republishes CLI + SDK + trust surfaces together, use [`release-bundle-playbook.md`](./release-bundle-playbook.md).
For concrete remote-gateway deployment guidance, use [`operator-deployment.md`](./operator-deployment.md).

## Status terms

- `Active`: shipped and intended for current consumer use
- `Operator-hosted`: shipped, but inactive until you start or host it yourself
- `Alpha`: shipped and usable, but the interface is still pre-1.0 and may change
- `Reference artifact`: shipped static metadata for generators or catalog readers; not an execution backend
- `Reference docs`: packaged guidance that is discoverable through the documentation index, but not itself an execution surface
- `Implemented`: executable backend code path exists in the current runtime
- `Placeholder`: metadata or sample profiles ship, but the executable backend does not exist yet
- `Ready`: implemented plus current runtime prerequisites are satisfied
- `Degraded`: implemented, but current runtime prerequisites are still missing

The last four terms are runtime-readiness terms for signer profile metadata in `capabilities.data.policyProfiles.signerProfiles`. They do not replace the higher-level support or maturity labels in this matrix.

## Runtime and consumer surfaces

| Surface | Current status | How consumers get it | What Pandora guarantees today | Release evidence | Current limits |
| --- | --- | --- | --- | --- | --- |
| Local CLI (`pandora`) | Active | GitHub release tarball or npm package install | Primary supported operator surface for human and JSON output. `capabilities` and `schema` are the authoritative machine-facing CLI contracts. | Release workflow is gated on Linux, macOS, and Windows validation before publish; pack/install smoke tests validate packaged CLI and JSON commands. | Live execution still depends on env or `.env` secrets for applicable commands. Shipped signer profiles do not mean every built-in backend is runtime-ready. Support level does not mean every command is safe for unattended automation. |
| Local stdio MCP (`pandora mcp`) | Active | Same package as the CLI; start locally with `pandora mcp` | Primary supported MCP transport for direct tool execution on the same machine as Pandora. | CLI/MCP integration tests plus benchmark parity for capabilities, schema, and seeded operations. | Requires local process execution. Some long-running tools are blocked in MCP v1. `launch` and `clone-bet` are intentionally not exposed over MCP. Live mutating calls require execute intent. |
| Remote streamable HTTP MCP (`pandora mcp http`) | Operator-hosted | Same package as the CLI; you must intentionally start the gateway | Shipped gateway with bearer-token scope enforcement, remote `/mcp` endpoint, authenticated `/bootstrap`, `/capabilities`, `/schema`, `/tools`, `/operations`, `/auth`, and JSON observability surfaces (`/ready`, `/metrics`), plus parity-tested bootstrap/operations flows. | Gateway integration tests, benchmark parity/denial checks, release-trust gates, and packaged-doc/operator-deployment checks. | The gateway is not a hosted Pandora service. It is inactive until you start it. You own lifecycle, TLS/proxying, network exposure, auth-token distribution, and signer secret placement. No native TLS or Prometheus exposition format is shipped. Auth rotation/revocation is durable only in `--auth-tokens-file` mode. |
| Operation receipts (terminal mutable-operation audit artifacts) | Active for local/runtime trust | Written automatically beside the operation state store when mutable work reaches a terminal state | Tamper-evident JSON receipts bind operation id/hash, canonical command/tool/action, checkpoint digest, and receipt-hash verification fields for post-execution audit. | Operation-service receipt generation/verification coverage plus release/trust documentation that ties receipts into the broader A+ trust story. | Runtime artifact only. This is not yet a standalone release asset. Authenticated gateways expose `/operations/<operation-id>/receipt` and `/operations/<operation-id>/receipt/verify` when `operations:read` is granted. |
| TypeScript SDK (`@thisispandora/agent-sdk`, repo path `sdk/typescript`) | Alpha | public npm package (`npm install @thisispandora/agent-sdk@alpha`), signed GitHub release tarball attached to the tagged Pandora release, or the vendored copy under `sdk/typescript` / `pandora-cli-skills/sdk/typescript` | Generated contract catalog, package-local generated artifacts, and swappable local stdio MCP or operator-hosted remote HTTP MCP backends for TypeScript/Node consumers. | Public npm publication is live; repository unit coverage validates client/catalog behavior; standalone package checks validate `npm pack`; generated-artifact parity checks and root-package smoke tests validate the vendored copy that ships with Pandora. | Pre-1.0 API. Treat as stable enough to evaluate and integrate, not as a frozen semver contract. Public npm publication is available today. Execution readiness for signer profiles must still be checked at runtime through `capabilities` / `profile`. |
| Python SDK (`pandora-agent`, repo path `sdk/python`) | Alpha | public PyPI package (`pip install pandora-agent==0.1.0a10`), signed GitHub release wheel or sdist attached to the tagged Pandora release, or the vendored copy under `sdk/python` for maintainers and in-tree consumers | Generated contract catalog, package-local generated artifacts, policy/profile helpers, and swappable local stdio MCP or operator-hosted remote HTTP MCP backends for Python consumers. | Repository unit coverage validates the SDK source/package surface; standalone package checks validate build/install behavior; generated-artifact parity checks and root-package smoke tests validate the vendored copy that ships with Pandora. | Pre-1.0 API. Treat as stable enough to evaluate and integrate, not as a frozen semver contract. Public PyPI publication is now live. Execution readiness for signer profiles must still be checked at runtime through `capabilities` / `profile`. The vendored root-package copy keeps its generated bundle under `sdk/python/pandora_agent/generated` and is self-contained at runtime. |
| Shared generated contract bundle (`sdk/generated`) | Reference artifact | Use `@thisispandora/agent-sdk/generated` from the standalone TypeScript package, or read the shared repo/root bundle at `sdk/generated` / `pandora-cli-skills/sdk/generated` | Shared static contract registry, manifest, descriptors, and tool definitions used by standalone SDKs, vendored SDK copies, and custom generators. | Generated-artifact parity checks, pack/install smoke tests, and runtime digest exposure through `capabilities` / `schema`. | Static metadata only. This is not an execution backend and does not replace live runtime discovery. Re-run or re-read `capabilities` / `schema` when descriptor hashes change. |
| Benchmark harness (scenario manifests, lock file, runner scripts) | Active for local regression | Repository checkout | Full reproducible benchmark harness used by build, prepack, CI evidence generation, and release gates. | CI publishes a `benchmark-evidence-<sha>` artifact with `benchmarks/latest/core-report.json`, `benchmarks/latest/core-bundle.json`, `benchmarks/latest/core-history.json`, and `benchmarks/locks/core.lock.json`; tagged releases publish those assets plus an attested benchmark publication bundle and attested benchmark publication manifest. | This is a repository maintainer surface, not installed runtime baggage. Tagged releases publish benchmark evidence and publication metadata, not the full harness. |
| Skills/runtime docs (`SKILL.md`, `docs/skills/**`) | Active | Repository and packaged release contents | Primary human docs for CLI, MCP, SDK bootstrap, workflows, and runtime routing. They are part of the runtime documentation index surfaced by `pandora --output json capabilities`. | `check:docs`, doc drift tests, packaged-doc smoke checks, and runtime `documentation.contentHash` / router metadata. | Human guidance only. The runtime source of truth for machine consumers remains `capabilities` and `schema`. |
| Benchmark docs and latest report (`docs/benchmarks/**`, `benchmarks/latest/core-report.json`) | Active reference | Repository and packaged release contents | Public explanation of the benchmark suite plus the latest shipped benchmark report, benchmark publication bundle, and benchmark history surface. | Pack/install smoke tests confirm the docs and latest benchmark publication JSONs ship with the package; CI and tagged releases also publish the report/lock/bundle/history plus an attested benchmark publication archive and manifest. | These docs and reports explain the benchmark posture but are not themselves an execution surface. |
| Trust docs (`docs/trust/**`) | Active reference | Repository and packaged release contents; surfaced in the runtime documentation index | Release verification, security model, and support boundaries for external operators and agent builders. | `check:release-trust`, pack/install smoke tests, and tagged release assets for checksums, SBOMs, attestations, and keyless signatures. | Human guidance only. They complement `trustDistribution`, not replace machine-readable trust metadata. The docs themselves remain packaged content rather than separate release assets. |

Machine-readable trust companions exposed by `pandora --output json capabilities`:

- `trustDistribution.distribution.platformValidation`: checked-in CI/release workflow platform matrix metadata
- `trustDistribution.verification.releaseAssets`: expected release asset set and verification methods
- `trustDistribution.verification.ciWorkflow`: shipped CI workflow path plus observed OS/Node matrix

Machine-readable signer readiness companions exposed by `pandora --output json capabilities`:

- `policyProfiles.signerProfiles.statusAxes`: authoritative vocabulary for implementation status vs runtime readiness
- `policyProfiles.signerProfiles.backendStatuses`: compact per-backend readiness rollup
- `policyProfiles.signerProfiles.readyBuiltinIds`, `degradedBuiltinIds`, `placeholderBuiltinIds`: current built-in profile split for this runtime

Machine-readable remote principal-template companions exposed by `pandora --output json capabilities`:

- `principalTemplates.notes`: support boundary for gateway token personas
- `principalTemplates.templates[].id`: shipped template id such as `read-only-researcher` or `operator`
- `principalTemplates.templates[].grantedScopes`: exact least-privilege scope set derived from live canonical command descriptors
- `principalTemplates.templates[].tokenRecordTemplate`: JSON shape to copy into `--auth-tokens-file`

## Machine-checkable A+ certification

Pandora now exposes an explicit machine-readable A+ certification scorecard instead of leaving the claim to prose interpretation.

Use:

- `pandora --output json capabilities`
- `pandora --output json capabilities --runtime-local-readiness`
- `node scripts/check_a_plus_scorecard.cjs --runtime-local-readiness`
- `npm run check:final-readiness:runtime-local`

Authoritative machine-readable fields:

- `capabilities.data.certification.aPlus.status`
- `capabilities.data.certification.aPlus.eligible`
- `capabilities.data.certification.aPlus.checks[]`
- `capabilities.data.certification.aPlus.blockers[]`
- `capabilities.data.certification.aPlus.nextCommands[]`

Interpretation:

- `certified`: current runtime and published-surface evidence satisfy the A+ gate
- `not-certified`: one or more required checks fail
- `not-evaluable`: required checks depend on runtime-local readiness that was not probed in the current mode

Important:

- The default `capabilities` view is artifact-neutral for cold-agent discovery. That mode is intentionally conservative and may leave signer-readiness checks as not-evaluable.
- Use `--runtime-local-readiness` when you want to certify whether the current host can honestly claim A+ right now.
- This scorecard is stricter than the support matrix labels. A surface can be `Active` or `Operator-hosted` and still fail the A+ gate.
- Current blockers are expected to remain visible until they are actually closed, for example public SDK registry publication or signed operation receipts.

## Practical guarantees by audience

### If you are a CLI operator

You can rely on:

- the local CLI as the primary supported runtime surface
- `capabilities` and `schema` as the current machine-readable contract
- local terminal-operation receipts as the runtime audit artifact once mutable work finishes
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
- treat `principalTemplates` as the recommended starting point for remote bearer-token personas; the gateway can rotate/revoke principals in multi-principal mode, but you still own principal creation, token distribution, and signer secret placement
- use [`operator-deployment.md`](./operator-deployment.md) for current reverse-proxy, systemd, and container guidance
- treat `@thisispandora/agent-sdk` and `pandora-agent` as the primary standalone SDK package identities
- treat current release-built tarballs/wheels as the verified standalone distribution path until registry publication is added
- treat the `pandora-cli-skills` vendored SDK copies as parity/audit-friendly mirrors of those packages
- treat policy/profile metadata as shipped alpha discovery surfaces
- treat operation receipts as the runtime-side complement to release verification when you need post-execution auditability
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
- Use local operation receipts when you need a tamper-evident record of terminal mutable work after install.
- Use benchmark results and `trustDistribution` as release/regression signals for the checked build, not as a universal external certification score.

Recommended operating model split:

- live execution with user-owned funds:
  - self-custody local runtime
  - local stdio MCP or user-hosted HTTP MCP
- shared hosted gateway:
  - read-only discovery
  - planning
  - recipes
  - audit and receipts
  - bootstrap and schema inspection
