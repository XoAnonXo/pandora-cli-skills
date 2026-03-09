---
status: complete
priority: p2
issue_id: "139"
tags: [skills, anthropic, distribution, docs, release, install]
dependencies: ["136", "137"]
---

# Add skill installation and distribution assets

## Problem Statement

Even with a corrected skill and clean bundle, the repo still needs a clear public story for how humans discover, install, test, and update the Anthropic skill. Anthropic's guide recommends a public repo README, installation instructions, quick-start usage, and example screenshots for human visitors. The current Pandora docs explain product usage well, but they do not yet explain the Anthropic skill as a distributable artifact.

Without this layer, users may still understand Pandora but fail to install or validate the skill correctly.

## Findings

- [`README.md`](../README.md) and [`README_FOR_SHARING.md`](../README_FOR_SHARING.md) are product/package-oriented, not skill-installation-oriented.
- Anthropic's guide recommends:
  - public repo hosting
  - clear README
  - installation instructions
  - example usage and screenshots
  - a quick-start guide linking the skill and any MCP integration story
- Pandora already has a strong “why MCP + skills together” story, but it is spread across several docs rather than expressed as a simple installation narrative.
- There is no dedicated release artifact or human-facing install section for “download this zip/folder and upload it to Claude.ai / place it in Claude Code.”

## Proposed Solutions

### Option 1: Add a short paragraph to the existing README

**Approach:** Patch the current README with a minimal install note.

**Pros:**
- Fast
- Low churn

**Cons:**
- Weak discoverability
- Still no dedicated artifact or examples

**Effort:** 1-2 hours

**Risk:** Medium

---

### Option 2: Add a dedicated installation/distribution track for the skill

**Approach:** Create explicit docs and release support for:
- where the Anthropic skill bundle lives
- how to zip/upload it
- how to install it in Claude Code
- how to test it with a few starter prompts
- how Pandora MCP and the skill complement each other

**Pros:**
- Aligns with Anthropic's guide
- Human-friendly onboarding
- Easier external sharing

**Cons:**
- Requires documentation and possibly screenshot/example upkeep

**Effort:** 0.5-1 day

**Risk:** Low

---

### Option 3: Publish a separate marketing microsite or docs set for skills

**Approach:** Build a standalone distribution site around the Anthropic skill.

**Pros:**
- Highest polish

**Cons:**
- Overbuilt for the current need
- Adds maintenance overhead

**Effort:** 2-3 days

**Risk:** Medium

## Recommended Action

Use Option 2.

Create a clear distribution story with:

1. **Install guide**
   - where to find the Anthropic skill bundle
   - how to zip/upload to Claude.ai
   - how to place it in Claude Code
2. **Quick test prompts**
   - a few prompts that should obviously trigger the skill
3. **MCP + skill positioning**
   - MCP gives access to Pandora
   - the skill teaches safe bootstrap and workflows
4. **Release artifact notes**
   - what file or directory is the supported artifact
   - how to verify it before sharing externally
5. **Optional visuals**
   - screenshots or terminal snippets of installation and first use

## Technical Details

**Likely files:**
- [`README.md`](../README.md)
- [`README_FOR_SHARING.md`](../README_FOR_SHARING.md)
- new docs such as `docs/skills/install-anthropic-skill.md`
- package/release script changes from issue `136`

**Distribution constraints:**
- keep repo-level README for human visitors
- keep Anthropic upload folder free of README files
- make the install guide refer to the generated bundle/zip, not the repo root
- ensure quick-start prompts match the trigger fixtures from issue `138`

## Resources

- Anthropic guide: [The Complete Guide to Building Skills for Claude](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf)
- Current repo onboarding:
  - [`README.md`](../README.md)
  - [`README_FOR_SHARING.md`](../README_FOR_SHARING.md)

## Acceptance Criteria

- [x] The repo documents exactly which bundle or zip to install as the Anthropic skill.
- [x] Installation steps exist for both Claude.ai upload and Claude Code placement.
- [x] Human-facing quick-start prompts are documented and align with the intended trigger surface.
- [x] The docs explain the MCP-plus-skill story in clear outcome language.
- [x] Release or sharing notes identify how to verify the supported skill artifact before external handoff.

## Work Log

### 2026-03-09 - Distribution work scoped

**By:** Codex

**Actions:**
- Compared the current Pandora shareable docs with Anthropic's distribution recommendations
- Identified the missing install, quick-test, and artifact-verification guidance
- Defined a dedicated distribution/docs todo that depends on the new bundle and router shape

**Learnings:**
- The missing piece is not more technical detail about Pandora itself; it is a simpler human installation story for the skill artifact

### 2026-03-09 - Added install and distribution guidance

**By:** Codex

**Actions:**
- Added the dedicated install guide at [`docs/skills/install-anthropic-skill.md`](../docs/skills/install-anthropic-skill.md)
- Updated [`README.md`](../README.md) and [`README_FOR_SHARING.md`](../README_FOR_SHARING.md) to point users at the Anthropic install path
- Documented the exact build and verification commands: `npm run pack:anthropic-skill` and `npm run check:anthropic-skill`
- Documented the supported artifacts: `dist/pandora-skill/` and `dist/pandora-skill.zip`

**Learnings:**
- The install story becomes much clearer once the bundle has a stable name and exact command surface
