const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const { buildCapabilitiesPayload } = require('../../cli/lib/capabilities_command_service.cjs');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('release trust script passes from the repository root', () => {
  const output = execFileSync(process.execPath, ['scripts/check_release_trust.cjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
  });
  assert.match(output, /Release trust checks passed/i);
});

test('release workflow and installer advertise provenance, sbom, and signature verification', () => {
  const ciWorkflow = readText('.github/workflows/ci.yml');
  const workflow = readText('.github/workflows/release.yml');
  const installer = readText('scripts/release/install_release.sh');

  assert.match(ciWorkflow, /ubuntu-latest/);
  assert.match(ciWorkflow, /macos-latest/);
  assert.match(ciWorkflow, /windows-latest/);
  assert.match(workflow, /attestations:\s*write/);
  assert.match(workflow, /needs:\s*validate/);
  assert.match(workflow, /macos-latest/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /run:\s*npm test/);
  assert.match(workflow, /run:\s*npm run release:prep/);
  assert.match(workflow, /scripts\/generate_sbom\.cjs/);
  assert.match(workflow, /Build benchmark publication manifest/);
  assert.match(workflow, /actions\/attest-build-provenance@/);
  assert.match(workflow, /actions\/attest-sbom@/);
  assert.match(workflow, /sbom\.spdx\.json/);
  assert.match(workflow, /sbom\.spdx\.json\.sha256/);
  assert.match(workflow, /core-bundle\.json/);
  assert.match(workflow, /core-history\.json/);
  assert.match(workflow, /benchmark-publication-bundle\.tar\.gz/);
  assert.match(workflow, /benchmark-publication-manifest\.json/);
  assert.match(workflow, /sbom\.spdx\.json\.intoto\.jsonl|steps\.sbom_attestation_asset\.outputs\.bundle_asset/);
  assert.match(workflow, /checksums\.sha256/);
  assert.match(workflow, /\.intoto\.jsonl/);
  assert.match(workflow, /\.sig/);
  assert.match(workflow, /\.pem/);
  assert.match(workflow, /cosign sign-blob/);
  assert.match(workflow, /Prepare standalone Python SDK publish staging directory/);
  assert.match(workflow, /dist\/release\/sdk\/python-publish/);
  assert.match(workflow, /packages-dir:\s*dist\/release\/sdk\/python-publish/);

  assert.match(installer, /gh attestation verify/);
  assert.match(installer, /sbom\.spdx\.json/);
  assert.match(installer, /sbom\.spdx\.json\.intoto\.jsonl|SBOM_BUNDLE_ASSET="\$\{SBOM_ASSET\}\.intoto\.jsonl"/);
  assert.match(installer, /https:\/\/spdx\.dev\/Document/);
  assert.match(installer, /cosign verify-blob/);
});

test('trust docs reflect the shipped workflow and verification flow', () => {
  const releaseVerification = readText('docs/trust/release-verification.md');
  const supportMatrix = readText('docs/trust/support-matrix.md');

  assert.match(releaseVerification, /actions\/attest-build-provenance|build provenance/i);
  assert.match(releaseVerification, /actions\/attest-sbom|SPDX SBOM attestation/i);
  assert.match(releaseVerification, /gh release verify-asset/);
  assert.match(releaseVerification, /gh attestation verify/);
  assert.match(releaseVerification, /cosign verify-blob/);
  assert.match(releaseVerification, /checksums\.sha256/);
  assert.match(releaseVerification, /benchmark-publication-bundle\.tar\.gz/);
  assert.match(releaseVerification, /benchmark-publication-manifest\.json/);
  assert.match(releaseVerification, /core-bundle\.json/);
  assert.match(releaseVerification, /core-history\.json/);
  assert.match(releaseVerification, /docs\/benchmarks\/history\.json/);
  assert.match(releaseVerification, /docsHistoryPath/);
  assert.match(releaseVerification, /docsHistorySha256/);
  assert.match(releaseVerification, /sbom\.spdx\.json\.intoto\.jsonl/);
  assert.match(releaseVerification, /\.intoto\.jsonl/);
  assert.match(releaseVerification, /\.sig/);
  assert.match(releaseVerification, /\.pem/);

  assert.match(supportMatrix, /Trust docs .* surfaced in the runtime documentation index/i);
  assert.match(
    supportMatrix,
    /GitHub build provenance for both the tarball and shipped SPDX SBOM asset/i,
  );
  assert.match(supportMatrix, /Linux, macOS, and Windows/i);
});

test('benchmark trust docs describe the public bundle and tagged-source reproduction flow consistently', () => {
  const benchmarkOverview = readText('docs/benchmarks/README.md');
  const releaseVerification = readText('docs/trust/release-verification.md');

  assert.match(benchmarkOverview, /core-report\.json/);
  assert.match(benchmarkOverview, /core-bundle\.json/);
  assert.match(benchmarkOverview, /core-history\.json/);
  assert.match(benchmarkOverview, /benchmark-publication-manifest\.json/);
  assert.match(benchmarkOverview, /core\.lock\.json/);
  assert.match(benchmarkOverview, /tagged source checkout/i);
  assert.match(benchmarkOverview, /rather than the installed npm package alone/i);

  assert.match(releaseVerification, /core-report\.json/);
  assert.match(releaseVerification, /core-bundle\.json/);
  assert.match(releaseVerification, /core-history\.json/);
  assert.match(releaseVerification, /benchmark-publication-manifest\.json/);
  assert.match(releaseVerification, /core\.lock\.json/);
  assert.match(releaseVerification, /docs\/benchmarks\/history\.json/);
  assert.match(releaseVerification, /tagged checkout/i);
  assert.match(releaseVerification, /tagged source tree, not from the installed npm package alone/i);
});

test('capabilities payload tolerates malformed benchmark reports without crashing', () => {
  const reportPath = path.join(ROOT, 'benchmarks/latest/core-report.json');
  const originalReadFileSync = fs.readFileSync;
  try {
    fs.readFileSync = function patchedReadFileSync(filePath, ...args) {
      if (path.resolve(String(filePath)) === reportPath) {
        return '{not-json}\n';
      }
      return originalReadFileSync.call(this, filePath, ...args);
    };
    const payload = buildCapabilitiesPayload({ generatedAtOverride: '2026-03-08T00:00:00.000Z' });
    assert.equal(payload.trustDistribution.verification.benchmark.reportPresent, true);
    assert.equal(payload.trustDistribution.verification.benchmark.reportOverallPass, null);
    assert.equal(payload.trustDistribution.verification.benchmark.reportContractLockMatchesExpected, null);
    assert.ok(
      Array.isArray(payload.trustDistribution.notes)
      && payload.trustDistribution.notes.some((note) => /Benchmark report JSON is invalid/i.test(note)),
    );
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});
