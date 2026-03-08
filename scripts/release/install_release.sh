#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/release/install_release.sh --repo <owner/repo> --tag <tag> [--asset <file.tgz>] [--expected-sha256 <hex>] [--skip-attestation-verify] [--skip-signature-verify] [--signer-workflow <owner/repo/.github/workflows/release.yml>] [--certificate-identity <identity>] [--certificate-oidc-issuer <issuer>] [--no-install] [--install-local]

Examples:
  scripts/release/install_release.sh --repo acme/pandora-cli-skills --tag v1.0.0 --no-install
  scripts/release/install_release.sh --repo acme/pandora-cli-skills --tag v1.0.0

Notes:
  - Downloads release assets from GitHub Releases.
  - Verifies SHA-256 using checksums.sha256 before install.
  - Verifies GitHub release authenticity and build provenance by default using `gh release verify-asset` and `gh attestation verify`.
  - Downloads the GitHub build provenance bundle from <asset>.intoto.jsonl.
  - Verifies SPDX SBOM attestation for the tarball when GitHub attestations are enabled.
  - Verifies keyless cosign signature by default (downloads <asset>.sig and <asset>.pem).
  - Default certificate identity:
      https://github.com/<owner>/<repo>/.github/workflows/release.yml@refs/tags/<tag>
  - Default signer workflow:
      <owner>/<repo>/.github/workflows/release.yml
  - Use --skip-attestation-verify only for legacy releases that predate GitHub attestations.
  - Use --skip-signature-verify only for legacy releases that predate signatures.
  - Optional --expected-sha256 enables out-of-band digest pinning.
  - Default install mode is global (npm install --global).
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

extract_expected_checksum() {
  local checksums_file="$1"
  local asset_name="$2"

  awk -v target="$asset_name" '
    $0 ~ /^[[:space:]]*#/ { next }
    NF < 2 { next }
    {
      file = $2
      sub(/^\*/, "", file)
      if (file == target) {
        print $1
        exit
      }
    }
  ' "$checksums_file"
}

has_checksum_entry() {
  local checksums_file="$1"
  local asset_name="$2"
  [[ -n "$(extract_expected_checksum "$checksums_file" "$asset_name")" ]]
}

validate_asset_name() {
  local name="$1"
  if [[ ! "$name" =~ ^[A-Za-z0-9._-]+\.tgz$ ]]; then
    echo "Invalid asset name: $name (expected *.tgz basename without path characters)" >&2
    exit 1
  fi
}

list_tgz_assets_from_checksums() {
  local checksums_file="$1"
  awk '
    $0 ~ /^[[:space:]]*#/ { next }
    NF < 2 { next }
    {
      file = $2
      sub(/^\*/, "", file)
      if (file ~ /\.tgz$/) {
        print file
      }
    }
  ' "$checksums_file"
}

select_asset_from_checksums() {
  local checksums_file="$1"
  mapfile -t assets < <(list_tgz_assets_from_checksums "$checksums_file")
  if [[ ${#assets[@]} -eq 0 ]]; then
    echo "Could not find any .tgz asset in checksums.sha256. Pass --asset <file.tgz>." >&2
    exit 1
  fi
  if [[ ${#assets[@]} -gt 1 ]]; then
    mapfile -t preferred_assets < <(printf '%s\n' "${assets[@]}" | awk '/^pandora-cli-skills-.*\.tgz$/ { print }')
    if [[ ${#preferred_assets[@]} -eq 1 ]]; then
      echo "${preferred_assets[0]}"
      return
    fi
  fi
  if [[ ${#assets[@]} -gt 1 ]]; then
    echo "Multiple .tgz assets found. Please specify --asset explicitly." >&2
    printf 'Found: %s\n' "${assets[@]}" >&2
    exit 1
  fi
  echo "${assets[0]}"
}

compute_sha256() {
  local file="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return
  fi

  echo "No SHA-256 tool found (sha256sum or shasum required)." >&2
  exit 1
}

download_release_asset_if_listed() {
  local checksums_file="$1"
  local asset_name="$2"
  local destination="$3"
  if ! has_checksum_entry "$checksums_file" "$asset_name"; then
    return 1
  fi
  curl "${CURL_FLAGS[@]}" "$BASE_URL/$asset_name" -o "$destination"
  return 0
}

download_release_asset_required() {
  local asset_name="$1"
  local destination="$2"
  local context_message="${3:-}"
  if ! curl "${CURL_FLAGS[@]}" "$BASE_URL/$asset_name" -o "$destination"; then
    echo "Failed to download required GitHub release asset: $asset_name" >&2
    if [[ -n "$context_message" ]]; then
      echo "$context_message" >&2
    fi
    echo "Repo: $REPO" >&2
    echo "Tag:  $TAG" >&2
    echo "Expected release asset URL: $BASE_URL/$asset_name" >&2
    echo "This helper verifies tagged GitHub Releases. It will not work for npm-only publishes that do not have matching GitHub release assets." >&2
    exit 1
  fi
}

REPO=""
TAG=""
ASSET=""
EXPECTED_SHA256=""
INSTALL_MODE="global"
VERIFY_ATTESTATION="true"
VERIFY_SIGNATURE="true"
SIGNER_WORKFLOW=""
CERT_IDENTITY=""
CERT_OIDC_ISSUER="https://token.actions.githubusercontent.com"
CURL_FLAGS=(--fail --silent --show-error --location --retry 5 --retry-all-errors --connect-timeout 10 --max-time 300)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --asset)
      ASSET="${2:-}"
      shift 2
      ;;
    --expected-sha256)
      EXPECTED_SHA256="${2:-}"
      shift 2
      ;;
    --skip-attestation-verify)
      VERIFY_ATTESTATION="false"
      shift
      ;;
    --skip-signature-verify)
      VERIFY_SIGNATURE="false"
      shift
      ;;
    --signer-workflow)
      SIGNER_WORKFLOW="${2:-}"
      shift 2
      ;;
    --certificate-identity)
      CERT_IDENTITY="${2:-}"
      shift 2
      ;;
    --certificate-oidc-issuer)
      CERT_OIDC_ISSUER="${2:-}"
      shift 2
      ;;
    --no-install)
      INSTALL_MODE="none"
      shift
      ;;
    --install-local)
      INSTALL_MODE="local"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$REPO" || -z "$TAG" ]]; then
  echo "Both --repo and --tag are required." >&2
  usage
  exit 1
fi

if [[ ! "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "Invalid --repo format: $REPO (expected owner/repo)" >&2
  exit 1
fi

if [[ -n "$EXPECTED_SHA256" && ! "$EXPECTED_SHA256" =~ ^[A-Fa-f0-9]{64}$ ]]; then
  echo "Invalid --expected-sha256 (must be 64 hex characters)." >&2
  exit 1
fi

if [[ -n "$ASSET" ]]; then
  validate_asset_name "$ASSET"
fi

if [[ -z "$CERT_IDENTITY" ]]; then
  CERT_IDENTITY="https://github.com/${REPO}/.github/workflows/release.yml@refs/tags/${TAG}"
fi

if [[ -z "$SIGNER_WORKFLOW" ]]; then
  SIGNER_WORKFLOW="${REPO}/.github/workflows/release.yml"
fi

if [[ -z "$CERT_OIDC_ISSUER" ]]; then
  echo "Invalid --certificate-oidc-issuer (cannot be empty)." >&2
  exit 1
fi

require_cmd curl
if [[ "$INSTALL_MODE" != "none" ]]; then
  require_cmd npm
fi
if [[ "$VERIFY_ATTESTATION" == "true" ]]; then
  require_cmd gh
fi
if [[ "$VERIFY_SIGNATURE" == "true" ]]; then
  require_cmd cosign
fi

BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

CHECKSUMS_FILE="$TMP_DIR/checksums.sha256"
SBOM_ASSET="sbom.spdx.json"
SBOM_CHECKSUM_ASSET="${SBOM_ASSET}.sha256"
SBOM_BUNDLE_ASSET="${SBOM_ASSET}.intoto.jsonl"
BENCHMARK_REPORT_ASSET="core-report.json"
BENCHMARK_BUNDLE_ASSET="core-bundle.json"
BENCHMARK_HISTORY_ASSET="core-history.json"
BENCHMARK_LOCK_ASSET="core.lock.json"
BENCHMARK_PUBLICATION_BUNDLE_ASSET="benchmark-publication-bundle.tar.gz"
BENCHMARK_PUBLICATION_MANIFEST_ASSET="benchmark-publication-manifest.json"
SDK_CHECKSUMS_ASSET="sdk-checksums.sha256"
SDK_RELEASE_MANIFEST_ASSET="sdk-release-manifest.json"

download_release_asset_required \
  "checksums.sha256" \
  "$CHECKSUMS_FILE" \
  "checksums.sha256 is the minimum trust manifest for this helper."

if [[ -z "$ASSET" ]]; then
  ASSET="$(select_asset_from_checksums "$CHECKSUMS_FILE")"
fi

if [[ -z "$ASSET" ]]; then
  echo "Could not determine asset name. Pass --asset <file.tgz>." >&2
  exit 1
fi
validate_asset_name "$ASSET"

EXPECTED_SUM="$(extract_expected_checksum "$CHECKSUMS_FILE" "$ASSET")"
if [[ -z "$EXPECTED_SUM" ]]; then
  echo "No checksum entry found for asset: $ASSET" >&2
  exit 1
fi

if [[ -n "$EXPECTED_SHA256" && "$EXPECTED_SHA256" != "$EXPECTED_SUM" ]]; then
  echo "Expected digest mismatch for $ASSET compared to release checksums." >&2
  echo "From --expected-sha256: $EXPECTED_SHA256" >&2
  echo "From checksums.sha256:  $EXPECTED_SUM" >&2
  exit 1
fi

ASSET_PATH="$TMP_DIR/$ASSET"
download_release_asset_required "$ASSET" "$ASSET_PATH"

SBOM_PATH="$TMP_DIR/$SBOM_ASSET"
SBOM_CHECKSUM_PATH="$TMP_DIR/$SBOM_CHECKSUM_ASSET"
download_release_asset_required "$SBOM_ASSET" "$SBOM_PATH"
download_release_asset_required "$SBOM_CHECKSUM_ASSET" "$SBOM_CHECKSUM_PATH"
download_release_asset_required "$BENCHMARK_REPORT_ASSET" "$TMP_DIR/$BENCHMARK_REPORT_ASSET"
download_release_asset_required "$BENCHMARK_LOCK_ASSET" "$TMP_DIR/$BENCHMARK_LOCK_ASSET"
download_release_asset_required "$SDK_CHECKSUMS_ASSET" "$TMP_DIR/$SDK_CHECKSUMS_ASSET"
download_release_asset_required "$SDK_RELEASE_MANIFEST_ASSET" "$TMP_DIR/$SDK_RELEASE_MANIFEST_ASSET"

HAS_BENCHMARK_BUNDLE_ASSET="false"
HAS_BENCHMARK_HISTORY_ASSET="false"
HAS_BENCHMARK_PUBLICATION_BUNDLE_ASSET="false"
HAS_BENCHMARK_PUBLICATION_MANIFEST_ASSET="false"

if download_release_asset_if_listed "$CHECKSUMS_FILE" "$BENCHMARK_BUNDLE_ASSET" "$TMP_DIR/$BENCHMARK_BUNDLE_ASSET"; then
  HAS_BENCHMARK_BUNDLE_ASSET="true"
fi
if download_release_asset_if_listed "$CHECKSUMS_FILE" "$BENCHMARK_HISTORY_ASSET" "$TMP_DIR/$BENCHMARK_HISTORY_ASSET"; then
  HAS_BENCHMARK_HISTORY_ASSET="true"
fi
if download_release_asset_if_listed "$CHECKSUMS_FILE" "$BENCHMARK_PUBLICATION_BUNDLE_ASSET" "$TMP_DIR/$BENCHMARK_PUBLICATION_BUNDLE_ASSET"; then
  HAS_BENCHMARK_PUBLICATION_BUNDLE_ASSET="true"
fi
if download_release_asset_if_listed "$CHECKSUMS_FILE" "$BENCHMARK_PUBLICATION_MANIFEST_ASSET" "$TMP_DIR/$BENCHMARK_PUBLICATION_MANIFEST_ASSET"; then
  HAS_BENCHMARK_PUBLICATION_MANIFEST_ASSET="true"
fi

ACTUAL_SUM="$(compute_sha256 "$ASSET_PATH")"
if [[ "$ACTUAL_SUM" != "$EXPECTED_SUM" ]]; then
  echo "Checksum mismatch for $ASSET" >&2
  echo "Expected: $EXPECTED_SUM" >&2
  echo "Actual:   $ACTUAL_SUM" >&2
  exit 1
fi

for AUX_ASSET in \
  "$BENCHMARK_REPORT_ASSET" \
  "$BENCHMARK_LOCK_ASSET" \
  "$SDK_CHECKSUMS_ASSET" \
  "$SDK_RELEASE_MANIFEST_ASSET"; do
  EXPECTED_AUX_SUM="$(extract_expected_checksum "$CHECKSUMS_FILE" "$AUX_ASSET")"
  if [[ -z "$EXPECTED_AUX_SUM" ]]; then
    echo "No checksum entry found for release companion asset: $AUX_ASSET" >&2
    exit 1
  fi
  ACTUAL_AUX_SUM="$(compute_sha256 "$TMP_DIR/$AUX_ASSET")"
  if [[ "$ACTUAL_AUX_SUM" != "$EXPECTED_AUX_SUM" ]]; then
    echo "Checksum mismatch for companion asset $AUX_ASSET" >&2
    echo "Expected: $EXPECTED_AUX_SUM" >&2
    echo "Actual:   $ACTUAL_AUX_SUM" >&2
    exit 1
  fi
done

for OPTIONAL_AUX_ASSET in \
  "$BENCHMARK_BUNDLE_ASSET" \
  "$BENCHMARK_HISTORY_ASSET" \
  "$BENCHMARK_PUBLICATION_BUNDLE_ASSET" \
  "$BENCHMARK_PUBLICATION_MANIFEST_ASSET"; do
  if ! has_checksum_entry "$CHECKSUMS_FILE" "$OPTIONAL_AUX_ASSET"; then
    continue
  fi
  EXPECTED_AUX_SUM="$(extract_expected_checksum "$CHECKSUMS_FILE" "$OPTIONAL_AUX_ASSET")"
  ACTUAL_AUX_SUM="$(compute_sha256 "$TMP_DIR/$OPTIONAL_AUX_ASSET")"
  if [[ "$ACTUAL_AUX_SUM" != "$EXPECTED_AUX_SUM" ]]; then
    echo "Checksum mismatch for companion asset $OPTIONAL_AUX_ASSET" >&2
    echo "Expected: $EXPECTED_AUX_SUM" >&2
    echo "Actual:   $ACTUAL_AUX_SUM" >&2
    exit 1
  fi
done

if [[ "$HAS_BENCHMARK_PUBLICATION_MANIFEST_ASSET" == "true" ]]; then
node - <<'NODE' "$TMP_DIR/$BENCHMARK_PUBLICATION_MANIFEST_ASSET" "$ASSET_PATH" "$TMP_DIR/$BENCHMARK_REPORT_ASSET" "$TMP_DIR/$BENCHMARK_LOCK_ASSET" "$TMP_DIR/$BENCHMARK_BUNDLE_ASSET" "$TMP_DIR/$BENCHMARK_HISTORY_ASSET"
const fs = require('fs');
const crypto = require('crypto');
const [
  manifestPath,
  tarballPath,
  reportPath,
  lockPath,
  bundlePath,
  historyPath,
] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
const checks = [
  ['tarball', tarballPath, manifest.package.tarballSha256],
  ['report', reportPath, manifest.benchmark.reportSha256],
  ['lock', lockPath, manifest.benchmark.lockSha256],
  ['bundle', bundlePath, manifest.benchmark.bundleSha256],
  ['history', historyPath, manifest.benchmark.historySha256],
];
for (const [label, file, expected] of checks) {
  const actual = sha(file);
  if (actual !== expected) {
    throw new Error(`${label} digest mismatch: ${actual} !== ${expected}`);
  }
}
NODE

echo "Benchmark publication manifest verified against downloaded artifacts"
else
  echo "Skipping benchmark publication manifest verification because benchmark-publication-manifest.json is not listed in checksums.sha256."
fi

if [[ -n "$EXPECTED_SHA256" && "$ACTUAL_SUM" != "$EXPECTED_SHA256" ]]; then
  echo "Downloaded asset digest does not match --expected-sha256." >&2
  echo "Expected: $EXPECTED_SHA256" >&2
  echo "Actual:   $ACTUAL_SUM" >&2
  exit 1
fi

echo "Checksum verified for $ASSET"

SBOM_EXPECTED_SUM="$(extract_expected_checksum "$CHECKSUMS_FILE" "$SBOM_ASSET")"
if [[ -z "$SBOM_EXPECTED_SUM" ]]; then
  echo "No checksum entry found for asset: $SBOM_ASSET" >&2
  exit 1
fi

SBOM_ACTUAL_SUM="$(compute_sha256 "$SBOM_PATH")"
if [[ "$SBOM_ACTUAL_SUM" != "$SBOM_EXPECTED_SUM" ]]; then
  echo "Checksum mismatch for $SBOM_ASSET" >&2
  echo "Expected: $SBOM_EXPECTED_SUM" >&2
  echo "Actual:   $SBOM_ACTUAL_SUM" >&2
  exit 1
fi

echo "Checksum verified for $SBOM_ASSET"

if [[ "$VERIFY_ATTESTATION" == "true" ]]; then
  ATTESTATION_BUNDLE_ASSET="${ASSET}.intoto.jsonl"
  ATTESTATION_BUNDLE_PATH="$TMP_DIR/$ATTESTATION_BUNDLE_ASSET"
  SBOM_BUNDLE_PATH="$TMP_DIR/$SBOM_BUNDLE_ASSET"
  BENCHMARK_PUBLICATION_BUNDLE_ATTESTATION_ASSET="${BENCHMARK_PUBLICATION_BUNDLE_ASSET}.intoto.jsonl"
  BENCHMARK_PUBLICATION_BUNDLE_ATTESTATION_PATH="$TMP_DIR/$BENCHMARK_PUBLICATION_BUNDLE_ATTESTATION_ASSET"
  BENCHMARK_PUBLICATION_MANIFEST_ATTESTATION_ASSET="${BENCHMARK_PUBLICATION_MANIFEST_ASSET}.intoto.jsonl"
  BENCHMARK_PUBLICATION_MANIFEST_ATTESTATION_PATH="$TMP_DIR/$BENCHMARK_PUBLICATION_MANIFEST_ATTESTATION_ASSET"

  download_release_asset_required "$ATTESTATION_BUNDLE_ASSET" "$ATTESTATION_BUNDLE_PATH"
  download_release_asset_required "$SBOM_BUNDLE_ASSET" "$SBOM_BUNDLE_PATH"
  gh release verify-asset "$TAG" "$ASSET_PATH" --repo "$REPO" >/dev/null
  echo "GitHub release attestation verified for $ASSET"

  gh release verify-asset "$TAG" "$SBOM_PATH" --repo "$REPO" >/dev/null
  echo "GitHub release attestation verified for $SBOM_ASSET"

  gh attestation verify "$ASSET_PATH" \
    --repo "$REPO" \
    --bundle "$ATTESTATION_BUNDLE_PATH" \
    --signer-workflow "$SIGNER_WORKFLOW" \
    --cert-identity "$CERT_IDENTITY" \
    --cert-oidc-issuer "$CERT_OIDC_ISSUER" \
    --source-ref "refs/tags/$TAG" >/dev/null

  echo "GitHub build provenance verified for $ASSET"

  gh attestation verify "$ASSET_PATH" \
    --repo "$REPO" \
    --predicate-type "https://spdx.dev/Document" \
    --signer-workflow "$SIGNER_WORKFLOW" \
    --cert-identity "$CERT_IDENTITY" \
    --cert-oidc-issuer "$CERT_OIDC_ISSUER" \
    --source-ref "refs/tags/$TAG" >/dev/null

  echo "GitHub SBOM attestation verified for $ASSET"

  gh attestation verify "$SBOM_PATH" \
    --repo "$REPO" \
    --bundle "$SBOM_BUNDLE_PATH" \
    --signer-workflow "$SIGNER_WORKFLOW" \
    --cert-identity "$CERT_IDENTITY" \
    --cert-oidc-issuer "$CERT_OIDC_ISSUER" \
    --source-ref "refs/tags/$TAG" >/dev/null

  echo "GitHub provenance verified for $SBOM_ASSET"

  if [[ "$HAS_BENCHMARK_PUBLICATION_BUNDLE_ASSET" == "true" ]]; then
    download_release_asset_required "$BENCHMARK_PUBLICATION_BUNDLE_ATTESTATION_ASSET" "$BENCHMARK_PUBLICATION_BUNDLE_ATTESTATION_PATH"
    gh attestation verify "$TMP_DIR/$BENCHMARK_PUBLICATION_BUNDLE_ASSET" \
      --repo "$REPO" \
      --bundle "$BENCHMARK_PUBLICATION_BUNDLE_ATTESTATION_PATH" \
      --signer-workflow "$SIGNER_WORKFLOW" \
      --cert-identity "$CERT_IDENTITY" \
      --cert-oidc-issuer "$CERT_OIDC_ISSUER" \
      --source-ref "refs/tags/$TAG" >/dev/null

    echo "GitHub provenance verified for $BENCHMARK_PUBLICATION_BUNDLE_ASSET"
  fi

  if [[ "$HAS_BENCHMARK_PUBLICATION_MANIFEST_ASSET" == "true" ]]; then
    download_release_asset_required "$BENCHMARK_PUBLICATION_MANIFEST_ATTESTATION_ASSET" "$BENCHMARK_PUBLICATION_MANIFEST_ATTESTATION_PATH"
    gh attestation verify "$TMP_DIR/$BENCHMARK_PUBLICATION_MANIFEST_ASSET" \
      --repo "$REPO" \
      --bundle "$BENCHMARK_PUBLICATION_MANIFEST_ATTESTATION_PATH" \
      --signer-workflow "$SIGNER_WORKFLOW" \
      --cert-identity "$CERT_IDENTITY" \
      --cert-oidc-issuer "$CERT_OIDC_ISSUER" \
      --source-ref "refs/tags/$TAG" >/dev/null

    echo "GitHub provenance verified for $BENCHMARK_PUBLICATION_MANIFEST_ASSET"
  fi
else
  echo "Skipping GitHub attestation verification (--skip-attestation-verify)." >&2
fi

if [[ "$VERIFY_SIGNATURE" == "true" ]]; then
  SIG_PATH="$TMP_DIR/$ASSET.sig"
  CERT_PATH="$TMP_DIR/$ASSET.pem"

  download_release_asset_required "$ASSET.sig" "$SIG_PATH"
  download_release_asset_required "$ASSET.pem" "$CERT_PATH"

  cosign verify-blob \
    --signature "$SIG_PATH" \
    --certificate "$CERT_PATH" \
    --certificate-identity "$CERT_IDENTITY" \
    --certificate-oidc-issuer "$CERT_OIDC_ISSUER" \
    "$ASSET_PATH" >/dev/null

  echo "Cosign signature verified for $ASSET"
else
  echo "Skipping signature verification (--skip-signature-verify)." >&2
fi

case "$INSTALL_MODE" in
  global)
    npm install --global "$ASSET_PATH"
    echo "Installed globally from verified release artifact."
    ;;
  local)
    npm install "$ASSET_PATH"
    echo "Installed locally in current project from verified release artifact."
    ;;
  none)
    echo "Skipping npm install (--no-install)."
    ;;
  *)
    echo "Invalid install mode: $INSTALL_MODE" >&2
    exit 1
    ;;
esac
