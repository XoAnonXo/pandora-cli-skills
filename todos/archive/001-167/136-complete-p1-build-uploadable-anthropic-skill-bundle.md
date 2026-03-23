---
status: complete
priority: p1
issue_id: "136"
tags: [skills, anthropic, packaging, references, assets, release]
dependencies: ["135"]
---

# Build uploadable Anthropic skill bundle

## Problem Statement

The repo currently ships a shareable package, not a clean Anthropic upload artifact. Anthropic's guide expects users to download a skill folder, zip it if needed, and upload it directly. That means the skill artifact should be a self-contained folder whose contents are intentionally organized for skill consumption, not a mixed repo root containing package metadata, SDKs, trust docs, and human README files.

Without a dedicated bundle, installation remains ambiguous and release validation cannot prove that the actual upload target is clean, portable, and complete.

## Findings

- Current published files include:
  - [`SKILL.md`](../SKILL.md)
  - [`README.md`](../README.md)
  - [`README_FOR_SHARING.md`](../README_FOR_SHARING.md)
  - SDKs, docs, scripts, benchmarks, and trust artifacts via [`package.json`](../package.json)
- Anthropic's guide explicitly recommends a skill folder with `SKILL.md` and optional `references/`, `scripts/`, and `assets/`.
- Anthropic also recommends not placing `README.md` inside the skill folder itself, even if the repo has a separate README for human visitors.
- Pandora already has rich documentation under [`docs/skills`](../docs/skills), but those docs are not currently arranged as a single uploadable skill bundle.
- There is currently no script or CI check that validates a zip/upload-ready Anthropic skill artifact.

## Proposed Solutions

### Option 1: Use the repo root as the uploadable skill

**Approach:** Keep the current root layout and tell users to zip the whole repo package.

**Pros:**
- No structural work

**Cons:**
- Violates Anthropic's clean-skill-folder expectation
- Mixes unrelated files into the upload surface
- Harder to document and validate

**Effort:** Minimal

**Risk:** High

---

### Option 2: Generate a dedicated Anthropic skill folder from the repo

**Approach:** Create a build step that assembles a clean skill directory with:
- `SKILL.md`
- `references/`
- `assets/` if needed
- optional helper scripts if truly required

**Pros:**
- Clean installation story
- Can be checked and zipped deterministically
- Preserves current repo organization

**Cons:**
- Requires bundling logic and a new validation surface

**Effort:** 0.5-1 day

**Risk:** Low

---

### Option 3: Maintain a separate standalone skill repo

**Approach:** Split the Anthropic skill into a second repository.

**Pros:**
- Very clean public artifact

**Cons:**
- Duplicates release and maintenance effort
- Easy for docs to drift

**Effort:** 1-2 days

**Risk:** Medium

## Recommended Action

Use Option 2.

Add a dedicated Anthropic skill bundle generated from this repo. The bundle should contain only what a skill consumer needs:

- one Anthropic-facing `SKILL.md`
- curated `references/` files derived from the existing Pandora docs
- optional `assets/` for installation examples, templates, or screenshots metadata
- no repo-level `README.md` inside the skill folder

Also add a validation path such as `npm run check:anthropic-skill` or `npm run pack:anthropic-skill` that:

1. assembles the bundle
2. verifies required files exist
3. verifies forbidden files are absent
4. optionally creates a zip artifact

## Technical Details

**Likely files:**
- [`package.json`](../package.json)
- [`SKILL.md`](../SKILL.md)
- [`docs/skills/agent-quickstart.md`](../docs/skills/agent-quickstart.md)
- [`docs/skills/trading-workflows.md`](../docs/skills/trading-workflows.md)
- [`docs/skills/mirror-operations.md`](../docs/skills/mirror-operations.md)
- [`docs/skills/policy-profiles.md`](../docs/skills/policy-profiles.md)
- [`scripts/check_skill_docs.cjs`](../scripts/check_skill_docs.cjs)

**Likely new surfaces:**
- `anthropic-skill-src/` or generated `dist/pandora-skill/`
- `scripts/build_anthropic_skill_bundle.cjs`
- `scripts/check_anthropic_skill_bundle.cjs`

**Bundling rules:**
- copy only skill-relevant references
- do not ship unrelated SDK or benchmark artifacts inside the uploadable skill
- ensure relative links inside the bundle resolve within the bundle itself
- prefer static references over links that assume the full repo layout

## Resources

- Anthropic guide: [The Complete Guide to Building Skills for Claude](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf)
- Current package surface: [`package.json`](../package.json)
- Current human share guide: [`README_FOR_SHARING.md`](../README_FOR_SHARING.md)

## Acceptance Criteria

- [x] A dedicated Anthropic uploadable skill folder exists or can be generated deterministically.
- [x] The bundle contains `SKILL.md` plus curated `references/` and optional `assets/` only.
- [x] Repo-level README files are not included inside the uploadable skill folder.
- [x] Relative links inside the skill bundle resolve correctly after packaging.
- [x] A build/check script can validate the Anthropic skill artifact.
- [x] Packaging docs clearly identify what directory or zip a user should upload.

## Work Log

### 2026-03-09 - Packaging gap identified

**By:** Codex

**Actions:**
- Compared Anthropic's expected upload model with the current published repo bundle
- Mapped which existing Pandora docs are actually skill-relevant versus repo-only
- Defined the need for a generated clean-skill artifact and validation script

**Learnings:**
- The repo should keep its rich documentation, but Anthropic uploadability needs a narrower artifact than the current package root

### 2026-03-09 - Built uploadable bundle and validators

**By:** Codex

**Actions:**
- Added [`scripts/build_anthropic_skill_bundle.cjs`](../scripts/build_anthropic_skill_bundle.cjs) to generate `dist/pandora-skill/` and `dist/pandora-skill.zip`
- Added [`scripts/check_anthropic_skill_bundle.cjs`](../scripts/check_anthropic_skill_bundle.cjs) to validate frontmatter, forbidden files, and local link resolution
- Added the Anthropic source skill at [`anthropic-skill-src/SKILL.md`](../anthropic-skill-src/SKILL.md)
- Wired `build:anthropic-skill`, `check:anthropic-skill`, and `pack:anthropic-skill` into [`package.json`](../package.json)

**Learnings:**
- Preserving the docs/trust directory shape inside `references/` avoids most link-rewrite work and keeps the bundle navigable
