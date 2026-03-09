# Pandora One-Shot Release Bundle Playbook

Use this when a CLI change must ship as one coherent release across every public surface:

- `pandora-cli-skills` on npm
- `@thisispandora/agent-sdk` on npm
- `pandora-agent` on PyPI
- GitHub release assets
- benchmark publication assets
- SBOM, checksums, attestations, and trust docs

This is the canonical release rule for the repository:

1. edit the CLI and/or shared contract
2. regenerate and verify derived surfaces
3. tag once
4. let the release workflow publish every surface from that tag

Do not publish individual surfaces out of band unless you are recovering a failed release and have documented why.

## Why this exists

Pandora is no longer a single npm package. The CLI, MCP contract, standalone SDKs, benchmark publication bundle, and trust assets are coupled.

If you ship only one of them:

- `bootstrap` / `capabilities` can drift from the SDKs
- docs can claim package names or publication status that are no longer true
- benchmark and trust bundles can point at the wrong contract digest
- npm, PyPI, and GitHub release assets can disagree

The release system is designed so one tag produces one coherent artifact set.

## One-shot maintainer flow

### 1. Before tagging

Run the full bundle verification locally:

```bash
npm run release:bundle:verify
```

If the current host is also intended to satisfy the runtime-local A+ signer gate, run:

```bash
npm run release:bundle:verify:runtime-local
```

What these commands guarantee:

- docs match runtime truth
- generated SDK artifacts match the live contract
- standalone SDK package surfaces are valid
- benchmark lock/report/history are refreshed and consistent
- SBOMs are regenerated
- trust verification is green
- final readiness gate is evaluated from the current repo state

### 2. Bump version and commit

Update the CLI package version and any mirrored version references such as:

- `package.json`
- `package-lock.json`
- `SKILL.md`

Then commit the release state before tagging.

### 3. Tag once

The GitHub release workflow is the one-shot publication path.

Push:

- the commit
- the version tag (for example `v1.1.73`)

That workflow is responsible for publishing:

- `pandora-cli-skills`
- `@thisispandora/agent-sdk`
- `pandora-agent`
- release checksums, signatures, SBOMs, attestations
- benchmark publication bundle and manifest

### 4. Verify after publish

After the workflow finishes, verify:

```bash
npm view pandora-cli-skills version
npm view @thisispandora/agent-sdk version
python3 - <<'PY'
import json, urllib.request
data = json.load(urllib.request.urlopen('https://pypi.org/pypi/pandora-agent/json'))
print(data['info']['version'])
PY
```

Then verify the GitHub release asset set with:

```bash
scripts/release/install_release.sh --repo XoAnonXo/pandora-cli-skills --tag vX.Y.Z --no-install
```

## What must trigger a full bundle release

Treat any change in these areas as bundle-affecting:

- `cli/lib/**`
- `cli/pandora.cjs`
- `sdk/generated/**`
- `sdk/typescript/**`
- `sdk/python/**`
- `docs/skills/**`
- `docs/trust/**`
- `benchmarks/**`
- release/trust scripts under `scripts/`
- `.github/workflows/release.yml`

In practice:

- CLI contract changes imply SDK/doc/benchmark/trust changes
- trust or benchmark changes still require a full release verification run
- SDK metadata changes still require validating the CLI contract and docs

## Anti-patterns

Do not do these unless recovering from a failed release:

- publish `pandora-cli-skills` locally without re-running release bundle verification
- publish `@thisispandora/agent-sdk` without confirming `check:sdk-contracts`
- upload `sdk/python/dist/*` blindly without clearing stale build artifacts
- edit docs to claim publication or readiness status that `capabilities` does not report
- refresh benchmark JSONs without rerunning trust verification

## Recovery rule

If one surface fails after a tag release:

1. fix the underlying issue in git
2. rerun local bundle verification
3. move the tag only if you intentionally use tag-retag recovery and document it
4. otherwise cut a new version

Prefer a new patch version over repeated invisible manual corrections.
