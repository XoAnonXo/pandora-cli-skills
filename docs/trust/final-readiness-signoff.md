# Pandora Final Readiness Signoff

Use this document as the release-blocking signoff contract for Pandora's A+ agent-readiness story.

This file is intentionally strict. A release should not be described as final, production-ready, or A+-grade unless every required evidence surface below is present, green, and bound to the same release.

For package and asset verification, use [`release-verification.md`](./release-verification.md).
For runtime support boundaries, use [`support-matrix.md`](./support-matrix.md).
For remote gateway deployment posture, use [`operator-deployment.md`](./operator-deployment.md).
For transport and runtime trust boundaries, use [`security-model.md`](./security-model.md).

## Artifact role

This path is the shipped final signoff contract:

- `docs/trust/final-readiness-signoff.md`

It is not the only evidence artifact. It is the human-readable release gate that binds the required machine-readable evidence bundle together.

The release workflow must follow a verify-once, pack-once, publish-tarball model: verify the release candidate once, pack a single npm tarball, and reuse that exact tarball for npm publication, GitHub release assets, and trust metadata.

The minimum paired machine-readable evidence set for a signoff includes:

- `checksums.sha256`
- `sdk-release-manifest.json`
- `sdk-checksums.sha256`
- `core-bundle.json`
- `core-history.json`
- `core-report.json`
- `core.lock.json`
- `benchmark-publication-manifest.json`
- `benchmark-publication-bundle.tar.gz`
- `sbom.spdx.json`
- `pandora-cli-skills-<version>.tgz.intoto.jsonl`
- `pandora-cli-skills-<version>.tgz.sig`
- `pandora-cli-skills-<version>.tgz.pem`

A final signoff is invalid if these machine-readable artifacts exist but are not tied back to the same release tag, checksum manifest, and trust workflow identity.

## Release-blocking evidence matrix

All rows below must be green for signoff.

| Evidence area | Required proof | Minimum evidence sources |
| --- | --- | --- |
| Bootstrap and contract discovery | A cold agent can bootstrap from canonical machine-readable surfaces without relying on prose-only guidance. | `pandora --output json bootstrap`, `pandora --output json capabilities`, `pandora --output json schema`, authenticated `GET /bootstrap`, authenticated `GET /schema`, authenticated `GET /tools` |
| Standalone SDK distribution | The standalone TypeScript and Python SDK artifacts attached to the tagged release match the generated contract and smoke successfully. | `@thisispandora/agent-sdk`, `pandora-agent`, `sdk-release-manifest.json`, `sdk-checksums.sha256`, release-built SDK tarball/wheel/sdist artifacts |
| Signer readiness | Mutable profile readiness is proven by runtime checks, not by metadata alone. | `runtime-local-readiness`, `profile explain`, `profile get`, built-in signer readiness metadata from `capabilities.data.policyProfiles.signerProfiles` |
| Remote MCP and control plane | Remote MCP bootstrap, discovery, operation inspection, and auth surfaces are live and covered by release truth. | authenticated `GET /bootstrap`, `GET /schema`, `GET /tools`, `GET /metrics`, `GET /ready`, `/operations/{operationId}/receipt`, `/operations/{operationId}/receipt/verify`, `/auth/principals`, token rotation/revocation surfaces when multi-principal mode is used |
| Operation receipts | Mutable operations emit tamper-evident receipts that can be fetched and verified. | local receipt artifacts, `/operations/{operationId}/receipt`, `/operations/{operationId}/receipt/verify`, receipt verification coverage |
| Benchmark publication | Public benchmark evidence is attached to the release and tied to the same release truth set. | `core-bundle.json`, `core-history.json`, `core-report.json`, `core.lock.json`, `benchmark-publication-manifest.json`, `benchmark-publication-bundle.tar.gz` |
| Release trust | Package, SBOM, provenance, and signatures verify against the tagged workflow. | `checksums.sha256`, `sbom.spdx.json`, `.intoto.jsonl`, `.sig`, `.pem`, GitHub provenance and cosign verification flows |
| Release drift discipline | Repo head, packaged surface, generated artifacts, docs, benchmark lock, and release assets are checked together before publish. | `npm test`, `npm run check:docs`, `npm run check:sdk-contracts`, `npm run benchmark:check`, `npm run check:release-trust`, `npm run release:finalize`, `npm run release:prep`, `npm run release:publish` |

## Final signoff procedure

A release signoff should record all of the following in one review packet or release checklist:

1. Release identity
- Git tag
- package version
- tarball name
- tarball digest

2. Bootstrap identity
- `bootstrap` digest or content hash
- `capabilities` digest or content hash
- `schema` digest or content hash
- canonical `/tools` view used for agent discovery

3. SDK identity
- `sdk-release-manifest.json` digest
- `sdk-checksums.sha256` digest
- TypeScript SDK artifact digest
- Python wheel digest
- Python sdist digest

4. Runtime readiness identity
- ready and degraded signer profile ids
- `profile explain` evidence for the intended execution profiles
- any runtime blockers and explicit disposition

5. Remote control-plane identity
- authenticated remote `GET /bootstrap`
- authenticated remote `GET /schema`
- authenticated remote `GET /tools`
- authenticated remote `GET /ready`
- authenticated remote `GET /metrics`
- operation receipt fetch/verify proof if mutable operations are in scope

6. Benchmark identity
- `core-report.json` digest
- `core.lock.json` digest
- `benchmark-publication-manifest.json` digest
- `core-history.json` snapshot for release trend context

7. Trust identity
- `checksums.sha256` verified
- tarball provenance verified
- `sbom.spdx.json` provenance verified
- tarball cosign signature verified

8. Drift identity
- `npm test`
- `npm run check:docs`
- `npm run check:sdk-contracts`
- `npm run check:final-readiness`
- `npm run benchmark:check`
- `npm run check:release-trust`
- `npm run release:finalize`
- `npm run release:prep`
- `npm run release:publish`

## A+ minimum pass conditions

Do not sign off an A+ release unless all of the following are true:

- `bootstrap` is present and is the documented first call for cold agents.
- canonical-tool discovery is the default machine-facing path.
- `@thisispandora/agent-sdk` and `pandora-agent` release artifacts are attached and verified.
- mutable signer readiness is backed by runtime-local evidence, not only static profile metadata.
- remote MCP trust surfaces are covered by authenticated bootstrap, schema, tools, readiness, and metrics endpoints.
- mutable operations can produce and verify receipts through the documented receipt surfaces.
- benchmark publication assets are attached to the same release and referenced from the trust docs.
- release drift gates are green on the same source state that produced the release assets.

## Signoff blockers

A release must be blocked if any of the following is true:

- `bootstrap`, `capabilities`, `schema`, or canonical `/tools` disagree on the contract surface.
- standalone SDK artifacts are missing, stale, or not represented in `sdk-release-manifest.json` and `sdk-checksums.sha256`.
- signer readiness claims rely only on static metadata and not on `runtime-local-readiness`, `profile explain`, or equivalent runtime evidence.
- remote MCP docs or trust claims describe surfaces that are not actually shipped.
- `/operations/{operationId}/receipt` or `/operations/{operationId}/receipt/verify` are undocumented or unverified for mutable-operation audit.
- benchmark assets are present but not linked through `benchmark-publication-manifest.json` and release checksums.
- `checksums.sha256`, `sbom.spdx.json`, provenance bundles, and cosign materials do not all verify against the same tagged workflow.
- `npm test`, `npm run check:docs`, `npm run check:sdk-contracts`, `npm run check:final-readiness`, `npm run benchmark:check`, `npm run check:release-trust`, `npm run release:finalize`, `npm run release:prep`, or `npm run release:publish` fail on the release candidate.

## Machine-readable gate

Use the shipped scorecard command for the compact machine-readable A+ decision:

- `npm run check:final-readiness`

Use the runtime-local variant when you need signer-readiness certification on the current host:

- `node scripts/check_a_plus_scorecard.cjs --runtime-local-readiness`
- `npm run check:final-readiness:runtime-local`

## Scope note

This signoff contract is intentionally stricter than a basic package verification flow.

It does not certify:
- profitability
- third-party venue honesty
- hosted multi-tenant service guarantees
- universal safety without operator policy and secret-management discipline

It does certify that the released Pandora package, its standalone SDK release artifacts, its benchmark publication assets, and its trust metadata were checked together as one release candidate.
