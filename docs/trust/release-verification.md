# Pandora Release Verification

Use this guide to verify that a Pandora release artifact is the exact package produced by the repository's tagged GitHub release workflow.

Important scope:
- this helper/manual flow verifies GitHub Releases that publish the trust asset set
- it is not a generic verifier for npm-only publishes that do not have matching GitHub release assets
- if `checksums.sha256` is absent for a tag, the GitHub release verification flow is not available for that version

For support levels and runtime guarantees after install, see [`support-matrix.md`](./support-matrix.md).
For the release-blocking A+ signoff contract, see [`final-readiness-signoff.md`](./final-readiness-signoff.md).
For the maintainer one-tag publication flow that keeps CLI, SDKs, benchmarks, and trust assets aligned, see [`release-bundle-playbook.md`](./release-bundle-playbook.md).
For remote gateway deployment after verification, see [`operator-deployment.md`](./operator-deployment.md).

## Trust model

An official Pandora release currently has four trust layers:

1. A Git tag such as `v1.1.68` triggers `.github/workflows/release.yml`.
2. That workflow builds the npm tarball with `npm pack`, writes SHA-256 checksum assets, and uploads them to the GitHub release.
3. The same workflow publishes GitHub build-provenance for both the tarball and the shipped SPDX SBOM asset, plus an SPDX SBOM attestation for the tarball.
4. The tarball is also signed with a keyless Sigstore/cosign certificate bound to the exact tagged workflow identity.

For current releases, checksum verification, GitHub attestation verification, and cosign verification are all expected verification steps.

The release workflow follows a verify-once, pack-once, publish-tarball model: it verifies the tagged candidate once, packs a single npm tarball, and reuses that tarball for npm publication, GitHub release assets, checksums, attestations, and cosign signatures.

## Final readiness signoff

Package verification is necessary but not sufficient for an A+-grade release claim.

Use [`final-readiness-signoff.md`](./final-readiness-signoff.md) as the release-blocking signoff contract that binds together:

- `bootstrap`, `capabilities`, `schema`, and canonical `/tools` discovery
- standalone SDK release artifacts (`@thisispandora/agent-sdk`, `pandora-agent`)
- signer `runtime-local-readiness` and `profile explain` evidence
- authenticated remote MCP bootstrap/readiness/metrics and operation receipt surfaces
- benchmark publication assets (`core-bundle.json`, `core-history.json`, `core-report.json`, `core.lock.json`, `benchmark-publication-manifest.json`, `benchmark-publication-bundle.tar.gz`)
- release trust and drift gates (`checksums.sha256`, `sbom.spdx.json`, `.intoto.jsonl`, `.sig`, `.pem`, `npm test`, `npm run check:docs`, `npm run check:sdk-contracts`, `npm run benchmark:check`, `npm run check:release-trust`, `npm run release:prep`)

Do not call a release final or A+-grade unless that signoff contract is green.

## Prerequisites

For the manual flow, have these tools available:

- `gh` for downloading release assets and verifying GitHub attestations
- `cosign` for keyless signature verification
- `sha256sum` or `shasum`
- `npm` only if you plan to install after verification

## Official release assets

For a tag `vX.Y.Z`, the current release workflow always publishes:

- `pandora-cli-skills-X.Y.Z.tgz`
- `pandora-cli-skills-X.Y.Z.tgz.sha256`
- `thisispandora-agent-sdk-*.tgz`
- `pandora_agent-*.whl`
- `pandora_agent-*.tar.gz`
- `checksums.sha256`
- `core-report.json`
- `core.lock.json`
- `sdk-checksums.sha256`
- `sdk-release-manifest.json`
- `sbom.spdx.json`
- `sbom.spdx.json.sha256`
- `sbom.spdx.json.intoto.jsonl`
- `pandora-cli-skills-X.Y.Z.tgz.intoto.jsonl`
- `pandora-cli-skills-X.Y.Z.tgz.sig`
- `pandora-cli-skills-X.Y.Z.tgz.pem`

Current benchmark-publication releases also publish:

- `core-bundle.json`
- `core-history.json`
- `benchmark-publication-bundle.tar.gz`
- `benchmark-publication-bundle.tar.gz.sha256`
- `benchmark-publication-bundle.tar.gz.intoto.jsonl`
- `benchmark-publication-manifest.json`
- `benchmark-publication-manifest.json.sha256`
- `benchmark-publication-manifest.json.intoto.jsonl`

What each file is for:

- `*.tgz`: the installable npm package tarball
- `*.tgz.sha256`: per-artifact checksum emitted by the workflow
- `thisispandora-agent-sdk-*.tgz`: standalone TypeScript SDK tarball built and smoke-tested during release
- `pandora_agent-*.whl`: standalone Python SDK wheel built and smoke-tested during release
- `pandora_agent-*.tar.gz`: standalone Python SDK sdist built and smoke-tested during release
- `checksums.sha256`: release-wide checksum manifest for the main tarball, standalone SDK tarball, wheel, and sdist, the shipped SPDX SBOM, the published benchmark report and lock, and the standalone SDK manifest/checksum files
- `core-bundle.json`: machine-readable benchmark publication bundle for the release
- `core-history.json`: machine-readable benchmark history/trend surface for the release
- `benchmark-publication-bundle.tar.gz`: attested archive containing the benchmark publication JSONs plus benchmark docs
- `benchmark-publication-bundle.tar.gz.sha256`: checksum for the benchmark publication archive
- `benchmark-publication-bundle.tar.gz.intoto.jsonl`: GitHub provenance bundle asset for the benchmark publication archive
- `benchmark-publication-manifest.json`: attested manifest that binds the release tarball digest to the published benchmark evidence digests
- `benchmark-publication-manifest.json.sha256`: checksum for the benchmark publication manifest
- `benchmark-publication-manifest.json.intoto.jsonl`: GitHub provenance bundle asset for the benchmark publication manifest
- `core-report.json`: latest benchmark publication bundle report for the release
- `core.lock.json`: benchmark lock file tied to the release contract/artifact digest set
- `sdk-checksums.sha256`: checksum manifest for the standalone SDK artifacts built during release
- `sdk-release-manifest.json`: manifest describing the standalone SDK artifact set built during release
- `sbom.spdx.json`: SPDX JSON SBOM generated during release prep
- `sbom.spdx.json.sha256`: checksum for the SPDX SBOM asset
- `sbom.spdx.json.intoto.jsonl`: GitHub build-provenance bundle asset for the shipped SPDX SBOM file
- `*.intoto.jsonl`: GitHub build-provenance bundle asset for the tarball
- `*.sig`: keyless cosign signature over the tarball blob
- `*.pem`: signing certificate used by `cosign verify-blob`

The same release asset set is exposed machine-readably in `pandora --output json capabilities` under:

- `data.trustDistribution.verification.releaseAssets.names`
- `data.trustDistribution.verification.releaseAssets.verificationMethods`

## Fast path: repository helper script

If you are verifying from a Git checkout of this repository, use the helper script:

```bash
scripts/release/install_release.sh \
  --repo XoAnonXo/pandora-cli-skills \
  --tag vX.Y.Z \
  --no-install
```

What it does:

- downloads release assets from GitHub Releases
- verifies the tarball against `checksums.sha256`
- optionally compares against an out-of-band pinned SHA-256 with `--expected-sha256`
- verifies the GitHub build provenance bundle and SBOM attestation by default
- verifies the shipped SPDX SBOM asset against its own GitHub provenance bundle by default
- verifies the keyless cosign signature by default
- downloads standalone SDK signatures and certificates as release assets
- verifies benchmark publication assets only when they are listed in `checksums.sha256`
- installs only if you omit `--no-install`
- when multiple `.tgz` assets are present, it prefers the main `pandora-cli-skills-*.tgz` release tarball automatically

Use this helper only from a trusted checkout of the repository itself. If you want to verify manually, use the steps below.

If the helper fails immediately while downloading `checksums.sha256`, that usually means one of:
- the tag does not exist as a GitHub Release
- the release exists but does not publish the trust asset set yet
- you are trying to verify an npm publish that was not accompanied by a GitHub release

## Manual verification

### 1. Choose the release and asset name

```bash
REPO="XoAnonXo/pandora-cli-skills"
TAG="vX.Y.Z"
VERSION="${TAG#v}"
ASSET="pandora-cli-skills-${VERSION}.tgz"
mkdir -p pandora-release-verify
cd pandora-release-verify
```

### 2. Download the release assets from GitHub

Required asset set:

```bash
gh release download "$TAG" -R "$REPO" \
  -p "$ASSET" \
  -p "$ASSET.sha256" \
  -p "thisispandora-agent-sdk-*.tgz" \
  -p "thisispandora-agent-sdk-*.tgz.sig" \
  -p "thisispandora-agent-sdk-*.tgz.pem" \
  -p "pandora_agent-*.whl" \
  -p "pandora_agent-*.whl.sig" \
  -p "pandora_agent-*.whl.pem" \
  -p "pandora_agent-*.tar.gz" \
  -p "pandora_agent-*.tar.gz.sig" \
  -p "pandora_agent-*.tar.gz.pem" \
  -p "checksums.sha256" \
  -p "core-report.json" \
  -p "core.lock.json" \
  -p "sdk-checksums.sha256" \
  -p "sdk-release-manifest.json" \
  -p "sbom.spdx.json" \
  -p "sbom.spdx.json.sha256" \
  -p "sbom.spdx.json.intoto.jsonl" \
  -p "$ASSET.intoto.jsonl" \
  -p "$ASSET.sig" \
  -p "$ASSET.pem"
```

Benchmark-publication assets:

```bash
gh release download "$TAG" -R "$REPO" \
  -p "core-bundle.json" \
  -p "core-history.json" \
  -p "benchmark-publication-bundle.tar.gz" \
  -p "benchmark-publication-bundle.tar.gz.sha256" \
  -p "benchmark-publication-bundle.tar.gz.intoto.jsonl" \
  -p "benchmark-publication-manifest.json" \
  -p "benchmark-publication-manifest.json.sha256" \
  -p "benchmark-publication-manifest.json.intoto.jsonl"
```

Expected result:

- all requested files listed above are present in the working directory

### 3. Verify the checksum manifest

Linux:

```bash
sha256sum -c checksums.sha256
```

This now verifies:

- the main npm tarball
- the standalone SDK tarball, wheel, and sdist
- the shipped SPDX SBOM
- the published benchmark report and lock
- the standalone SDK checksum manifest and SDK release manifest
- if present in `checksums.sha256`, also:
  - `core-bundle.json`
  - `core-history.json`
  - `benchmark-publication-bundle.tar.gz`
  - `benchmark-publication-manifest.json`

macOS:

```bash
shasum -a 256 -c checksums.sha256
```

You should see `OK` results for the tarball, the standalone SDK artifacts, the benchmark report and lock, the SDK manifest/checksum assets, and the SBOM.

### 4. Optionally pin an expected digest out of band

If you received the expected SHA-256 from a second channel, compare it before install:

```bash
EXPECTED_SHA256="<64-hex-digest-from-a-second-channel>"
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA256="$(sha256sum "$ASSET" | awk '{print $1}')"
else
  ACTUAL_SHA256="$(shasum -a 256 "$ASSET" | awk '{print $1}')"
fi
test "$ACTUAL_SHA256" = "$EXPECTED_SHA256"
```

If that `test` command exits non-zero, reject the release artifact.

### 5. Verify GitHub build provenance

The checked-in release workflow publishes build provenance and an attestation bundle for the tarball.

Verify the release asset itself:

```bash
gh release verify-asset "$TAG" "$ASSET" --repo "$REPO"
```

Verify the tarball against the bundled attestation:

```bash
gh attestation verify "$ASSET" \
  --repo "$REPO" \
  --bundle "$ASSET.intoto.jsonl" \
  --signer-workflow "${REPO}/.github/workflows/release.yml" \
  --cert-identity "https://github.com/${REPO}/.github/workflows/release.yml@refs/tags/${TAG}" \
  --cert-oidc-issuer "https://token.actions.githubusercontent.com" \
  --source-ref "refs/tags/${TAG}"
```

Reject the release if either command fails.

### 6. Verify the shipped SPDX SBOM asset and the tarball SBOM attestation

Verify the downloaded SPDX SBOM asset against its own provenance bundle:

```bash
gh release verify-asset "$TAG" "sbom.spdx.json" --repo "$REPO"

gh attestation verify "sbom.spdx.json" \
  --repo "$REPO" \
  --bundle "sbom.spdx.json.intoto.jsonl" \
  --signer-workflow "${REPO}/.github/workflows/release.yml" \
  --cert-identity "https://github.com/${REPO}/.github/workflows/release.yml@refs/tags/${TAG}" \
  --cert-oidc-issuer "https://token.actions.githubusercontent.com" \
  --source-ref "refs/tags/${TAG}"
```

Then verify that the tarball carries an SPDX SBOM attestation from the same tagged workflow:

```bash
gh attestation verify "$ASSET" \
  --repo "$REPO" \
  --predicate-type "https://spdx.dev/Document" \
  --signer-workflow "${REPO}/.github/workflows/release.yml" \
  --cert-identity "https://github.com/${REPO}/.github/workflows/release.yml@refs/tags/${TAG}" \
  --cert-oidc-issuer "https://token.actions.githubusercontent.com" \
  --source-ref "refs/tags/${TAG}"
```

This proves both:

- the downloaded `sbom.spdx.json` file is the exact workflow output uploaded as the release asset
- the tarball has an attached SPDX SBOM attestation from the same tagged workflow

### 7. Verify the keyless cosign signature

Verify the tarball with:

```bash
cosign verify-blob \
  --signature "$ASSET.sig" \
  --certificate "$ASSET.pem" \
  --certificate-identity "https://github.com/${REPO}/.github/workflows/release.yml@refs/tags/${TAG}" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  "$ASSET"
```

Reject the release if:

- the certificate identity does not match the tagged release workflow
- the OIDC issuer is not `https://token.actions.githubusercontent.com`
- `cosign verify-blob` fails for any reason

### 8. Verify the benchmark publication manifest and archive

The benchmark publication manifest is the clearest release-level trust binding for benchmark evidence. It includes the tarball SHA-256 plus the SHA-256 values for:

- `core-report.json`
- `core.lock.json`
- `core-bundle.json`
- `core-history.json`
- `docs/benchmarks/history.json`

The benchmark-publication section is part of the standard release verification set. Verify all of:
- `benchmark-publication-manifest.json`
- `benchmark-publication-bundle.tar.gz`
- the matching `.sha256` and `.intoto.jsonl` files
- `core-bundle.json`
- `core-history.json`
- `docs/benchmarks/history.json` through the manifest digest fields

Verify the manifest provenance:

```bash
gh attestation verify "benchmark-publication-manifest.json" \
  --repo "$REPO" \
  --bundle "benchmark-publication-manifest.json.intoto.jsonl" \
  --signer-workflow "${REPO}/.github/workflows/release.yml" \
  --cert-identity "https://github.com/${REPO}/.github/workflows/release.yml@refs/tags/${TAG}" \
  --cert-oidc-issuer "https://token.actions.githubusercontent.com" \
  --source-ref "refs/tags/${TAG}"
```

Extract the benchmark publication archive so the docs history file can be checked against the manifest:

```bash
rm -rf benchmark-publication-bundle
tar -xzf benchmark-publication-bundle.tar.gz
```

Then confirm the manifest matches the tarball and benchmark assets you downloaded:

```bash
node - <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const manifest = JSON.parse(fs.readFileSync('benchmark-publication-manifest.json', 'utf8'));
function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
if (sha(manifest.package.tarballPath.split('/').pop()) !== manifest.package.tarballSha256) {
  throw new Error('Tarball digest does not match benchmark-publication-manifest.json');
}
for (const [label, file] of Object.entries({
  report: 'core-report.json',
  lock: 'core.lock.json',
  bundle: 'core-bundle.json',
  history: 'core-history.json',
})) {
  const manifestKey = `${label}Sha256`;
  const actual = sha(file);
  const expected = manifest.benchmark[manifestKey];
  if (actual !== expected) {
    throw new Error(`${label} digest mismatch: ${actual} !== ${expected}`);
  }
}
const docsHistoryFile = 'benchmark-publication-bundle/docs/benchmarks/history.json';
const docsHistory = sha(docsHistoryFile);
if (docsHistory !== manifest.benchmark.docsHistorySha256) {
  throw new Error(`docs history digest mismatch: ${docsHistory} !== ${manifest.benchmark.docsHistorySha256}`);
}
if (manifest.benchmark.docsHistoryPath !== 'docs/benchmarks/history.json') {
  throw new Error(`docs history path mismatch: ${manifest.benchmark.docsHistoryPath}`);
}
NODE
```

You can also verify the publication archive itself:

```bash
gh attestation verify "benchmark-publication-bundle.tar.gz" \
  --repo "$REPO" \
  --bundle "benchmark-publication-bundle.tar.gz.intoto.jsonl" \
  --signer-workflow "${REPO}/.github/workflows/release.yml" \
  --cert-identity "https://github.com/${REPO}/.github/workflows/release.yml@refs/tags/${TAG}" \
  --cert-oidc-issuer "https://token.actions.githubusercontent.com" \
  --source-ref "refs/tags/${TAG}"
```

### 9. Verify standalone SDK signatures

The release workflow also signs the standalone SDK artifacts with the same tagged workflow identity.

TypeScript SDK tarball:

```bash
TS_SDK_ASSET="$(ls thisispandora-agent-sdk-*.tgz | head -n 1)"
cosign verify-blob \
  --signature "${TS_SDK_ASSET}.sig" \
  --certificate "${TS_SDK_ASSET}.pem" \
  --certificate-identity "https://github.com/${REPO}/.github/workflows/release.yml@refs/tags/${TAG}" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  "$TS_SDK_ASSET"
```

Python wheel:

```bash
PY_WHEEL_ASSET="$(ls pandora_agent-*.whl | head -n 1)"
cosign verify-blob \
  --signature "${PY_WHEEL_ASSET}.sig" \
  --certificate "${PY_WHEEL_ASSET}.pem" \
  --certificate-identity "https://github.com/${REPO}/.github/workflows/release.yml@refs/tags/${TAG}" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  "$PY_WHEEL_ASSET"
```

Python sdist:

```bash
PY_SDIST_ASSET="$(ls pandora_agent-*.tar.gz | head -n 1)"
cosign verify-blob \
  --signature "${PY_SDIST_ASSET}.sig" \
  --certificate "${PY_SDIST_ASSET}.pem" \
  --certificate-identity "https://github.com/${REPO}/.github/workflows/release.yml@refs/tags/${TAG}" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  "$PY_SDIST_ASSET"
```

Reject the release if any standalone SDK verification fails.

## Install only after verification succeeds

Global install:

```bash
npm install --global "./$ASSET"
```

Project-local install:

```bash
npm install "./$ASSET"
```

## Post-install sanity checks

After installing a verified tarball, confirm that the installed build is internally consistent:

```bash
pandora --output json version
pandora --output json capabilities
pandora --output json schema
```

What to confirm:

- `version` matches the expected release version
- `capabilities.data.commandDescriptorVersion` is present
- `capabilities.data.registryDigest` is present
- `capabilities.data.trustDistribution` is present
- `capabilities.data.transports.cliJson.supported` is `true`
- `schema.ok` is `true`

If you are verifying from a repository checkout rather than only from the installed global binary, you can also run the source-tree trust helper:

```bash
npm run release:prep
```

That is the narrower source-tree trust helper for a checkout. It runs packaged-surface smoke checks, `benchmark:check`, regenerates both the default CycloneDX SBOM and the SPDX SBOM, and then runs the repository's release-trust checks. It still does not run the broader docs, SDK, typecheck, or full test gates by itself, and it is not a substitute for verifying the downloaded release tarball itself.

If you want to reproduce the published benchmark evidence from source, use the tagged checkout:

```bash
git checkout "$TAG"
npm ci
npm run benchmark:check
```

For a local refresh of the published benchmark evidence shape:

```bash
node scripts/run_agent_benchmarks.cjs --suite core --write-lock --out benchmarks/latest/core-report.json
npm run benchmark:history
```

That reproduces the same report/lock/bundle/history shape the release workflow publishes, but it must be run from the tagged source tree, not from the installed npm package alone.

## After verification: operator deployment expectations

Verification proves the artifact came from the tagged release workflow.
It does not mean Pandora ships a managed control plane or an official container image.

Current deployment posture after install:

- start `pandora mcp http` yourself
- terminate TLS in front of it
- prefer `--auth-tokens-file` for multi-principal operation
- use `--public-base-url` when the gateway is behind a proxy or load balancer
- treat `/health` as liveness only

Pandora does **not** currently publish:

- an official Docker image
- Kubernetes manifests
- a native TLS listener
- a metrics endpoint
- a token-rotation API

## What an official release currently guarantees

After checksum, GitHub attestation, and cosign verification succeed, you have verified that:

- the tarball matches the checksums published on the GitHub release
- the tarball carries build provenance and SPDX SBOM attestations from the tagged GitHub workflow
- the tarball was signed by the repository's tagged GitHub Actions release workflow
- the package contents passed the repository's current `npm test` and release workflow gates before asset upload

You have **not** automatically proven:

- that a downstream fork follows the same trust process
- that a hosted remote MCP gateway is being run by a trustworthy operator
- that an alpha SDK API will remain stable across pre-1.0 releases
- that your local machine or CI runtime is uncompromised after download

## Runtime receipts vs release trust

Release verification proves where the package came from.
Operation receipts prove what a running Pandora instance did after that package was installed.

Treat them as complementary trust layers:
- release trust:
  - tarballs
  - standalone SDK artifacts
  - checksums
  - GitHub provenance
  - SBOM attestations
  - cosign signatures
- runtime receipts:
  - terminal mutable operations
  - operation id/hash binding
  - canonical command/tool/action binding
  - checkpoint digest binding
  - tamper-evident receipt hash verification

Current receipt model:
- terminal operation states (`completed`, `failed`, `canceled`, `closed`) write a durable JSON receipt
- default local CLI location:
  - `~/.pandora/operations/<operation-id>.receipt.json`
- MCP/workspace-guarded location:
  - `./.pandora/operations/<operation-id>.receipt.json`
- receipt integrity fields:
  - `receiptHash`
  - `verification.receiptHash`
  - `checkpointDigest`
  - `verification.algorithm` (`sha256` in current builds)

What receipts are for:
- operator audit trails
- agent-side post-execution verification
- proving that a stored terminal operation record was not silently modified after receipt generation

What receipts are not for:
- they do not replace release verification
- they do not prove the hosting operator is trustworthy
- they do not by themselves prove signer custody quality

Remote receipt fetch:
- authenticated gateways expose:
  - `GET /operations/<operation-id>/receipt`
  - `GET /operations/<operation-id>/receipt/verify`
- both require `operations:read`

## Reject conditions

Do not install or promote a release if any of these happen:

- the GitHub tag, tarball version, and reported CLI version disagree
- `checksums.sha256` does not validate the tarball or SBOM
- the out-of-band pinned digest does not match
- `gh release verify-asset` fails
- build provenance or SPDX SBOM attestation verification fails
- the cosign certificate identity is not the tagged `release.yml` workflow
- the OIDC issuer is not GitHub Actions

## Standalone SDK install after verification

TypeScript:

```bash
npm install ./thisispandora-agent-sdk-*.tgz
```

Python wheel:

```bash
python3 -m pip install ./pandora_agent-*.whl
```

Python sdist:

```bash
python3 -m pip install ./pandora_agent-*.tar.gz
```

Use the standalone SDK assets only after they pass the same release verification flow as the main CLI tarball.
Each standalone SDK asset now ships with a matching `.sig` and `.pem` pair from the tagged GitHub release workflow.
