# Pandora Release Verification

Use this guide to verify that a Pandora release artifact is the exact package produced by the repository's tagged GitHub release workflow.

For support levels and runtime guarantees after install, see [`support-matrix.md`](./support-matrix.md).

## Trust model

An official Pandora release currently has four trust layers:

1. A Git tag such as `v1.1.68` triggers `.github/workflows/release.yml`.
2. That workflow builds the npm tarball with `npm pack`, writes SHA-256 checksum assets, and uploads them to the GitHub release.
3. The same workflow publishes GitHub build-provenance for both the tarball and the shipped SPDX SBOM asset, plus an SPDX SBOM attestation for the tarball.
4. The tarball is also signed with a keyless Sigstore/cosign certificate bound to the exact tagged workflow identity.

For current releases, checksum verification, GitHub attestation verification, and cosign verification are all expected verification steps.

## Prerequisites

For the manual flow, have these tools available:

- `gh` for downloading release assets and verifying GitHub attestations
- `cosign` for keyless signature verification
- `sha256sum` or `shasum`
- `npm` only if you plan to install after verification

## Official release assets

For a tag `vX.Y.Z`, the current release workflow publishes:

- `pandora-cli-skills-X.Y.Z.tgz`
- `pandora-cli-skills-X.Y.Z.tgz.sha256`
- `checksums.sha256`
- `sbom.spdx.json`
- `sbom.spdx.json.sha256`
- `sbom.spdx.json.intoto.jsonl`
- `pandora-cli-skills-X.Y.Z.tgz.intoto.jsonl`
- `pandora-cli-skills-X.Y.Z.tgz.sig`
- `pandora-cli-skills-X.Y.Z.tgz.pem`

What each file is for:

- `*.tgz`: the installable npm package tarball
- `*.tgz.sha256`: per-artifact checksum emitted by the workflow
- `checksums.sha256`: release-wide checksum manifest for the tarball and SBOM
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
- installs only if you omit `--no-install`

Use this helper only from a trusted checkout of the repository itself. If you want to verify manually, use the steps below.

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

```bash
gh release download "$TAG" -R "$REPO" \
  -p "$ASSET" \
  -p "$ASSET.sha256" \
  -p "checksums.sha256" \
  -p "sbom.spdx.json" \
  -p "sbom.spdx.json.sha256" \
  -p "sbom.spdx.json.intoto.jsonl" \
  -p "$ASSET.intoto.jsonl" \
  -p "$ASSET.sig" \
  -p "$ASSET.pem"
```

Expected result:

- all nine files listed above are present in the working directory

### 3. Verify the checksum manifest

Linux:

```bash
sha256sum -c checksums.sha256
```

macOS:

```bash
shasum -a 256 -c checksums.sha256
```

You should see `OK` results for the tarball and the SBOM.

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

## Reject conditions

Do not install or promote a release if any of these happen:

- the GitHub tag, tarball version, and reported CLI version disagree
- `checksums.sha256` does not validate the tarball or SBOM
- the out-of-band pinned digest does not match
- `gh release verify-asset` fails
- build provenance or SPDX SBOM attestation verification fails
- the cosign certificate identity is not the tagged `release.yml` workflow
- the OIDC issuer is not GitHub Actions
