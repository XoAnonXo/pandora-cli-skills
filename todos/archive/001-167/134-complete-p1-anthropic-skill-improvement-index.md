---
status: complete
priority: p1
issue_id: "134"
tags: [skills, anthropic, docs, packaging, evaluation]
dependencies: ["135", "136", "137", "138", "139"]
---

# Anthropic skill improvement index

## Problem Statement

The repo has strong Pandora operator documentation, but the shareable skill surface does not yet match Anthropic's current skill guidance closely enough. The main gaps are frontmatter compatibility, trigger wording, Anthropic-native folder packaging, skill-first installation guidance, and explicit trigger/functional evaluation.

Today the package is optimized as a shareable repo artifact. Anthropic's guide expects a more opinionated skill artifact: a clean uploadable folder with `SKILL.md`, focused references/assets, frontmatter that clearly states what the skill does and when to use it, and a documented installation/test story.

## Findings

- Root [`SKILL.md`](../SKILL.md) uses `summary:` rather than Anthropic's required `description:` trigger field.
- The current root skill is a documentation router, but its opening language is feature-first and internal-tool-first rather than outcome-first and user-query-first.
- The published package includes repo-level human docs such as [`README.md`](../README.md) and [`README_FOR_SHARING.md`](../README_FOR_SHARING.md); Anthropic's upload flow expects a clean skill folder rather than a mixed repo bundle.
- The repo already has high-quality linked docs and workflow material under [`docs/skills`](../docs/skills), so the problem is not missing knowledge. The problem is packaging and discoverability.
- `npm run check:docs` validates internal Pandora doc routing, but there is no Anthropic-style trigger, uploadability, or regression suite yet.
- Anthropic's guide strongly emphasizes three areas that are only partially covered here:
  - frontmatter trigger quality
  - obvious/paraphrased/non-trigger test suites
  - distribution guidance for zip/upload and Claude Code placement

## Proposed Solutions

### Option 1: Minimal patch on the current root skill

**Approach:** Keep the repo shape, patch the frontmatter and opening copy, and add a short install doc.

**Pros:**
- Lowest implementation cost
- Minimal disruption to current release flow

**Cons:**
- Still leaves the repo bundle and Anthropic skill artifact conflated
- Harder to guarantee uploadability and clean progressive disclosure

**Effort:** 0.5-1 day

**Risk:** Medium

---

### Option 2: Introduce a dedicated Anthropic-native skill bundle inside the repo

**Approach:** Keep the current repo docs, but add a dedicated skill directory and packaging/evaluation flow designed for Anthropic's conventions.

**Pros:**
- Clean separation between repo docs and uploadable skill
- Preserves current Pandora documentation architecture
- Gives release automation a clear artifact to validate and zip

**Cons:**
- Slightly more maintenance
- Requires duplication or selective copying of some references

**Effort:** 1-2 days

**Risk:** Low

---

### Option 3: Rebuild the whole documentation set around an Anthropic skill first

**Approach:** Make the Anthropic skill structure the primary source of truth and generate repo docs from it.

**Pros:**
- Maximum consistency
- Single canonical documentation source

**Cons:**
- Highest churn
- Risks disrupting current internal docs and validation tooling
- Overkill for the current gap

**Effort:** 3-5 days

**Risk:** Medium

## Recommended Action

Use Option 2.

Create a dedicated Anthropic-native skill bundle while preserving the current repo-level Pandora docs. Execute the work in this order:

1. Issue `135`: fix frontmatter, naming, and trigger surface decisions
2. Issue `136`: build a clean uploadable skill folder and packaging checks
3. Issue `137`: rewrite the skill router around outcome-first entrypoints, quick start, examples, and troubleshooting
4. Issue `138`: add trigger and functional evaluation coverage
5. Issue `139`: publish installation, distribution, and release guidance

This keeps the existing documentation investment intact while producing a skill artifact that is actually optimized for Anthropic's expectations.

## Technical Details

**Primary files likely involved:**
- [`SKILL.md`](../SKILL.md)
- [`README.md`](../README.md)
- [`README_FOR_SHARING.md`](../README_FOR_SHARING.md)
- [`package.json`](../package.json)
- [`docs/skills/agent-quickstart.md`](../docs/skills/agent-quickstart.md)
- [`docs/skills/command-reference.md`](../docs/skills/command-reference.md)
- [`docs/skills/mirror-operations.md`](../docs/skills/mirror-operations.md)
- [`scripts/check_skill_docs.cjs`](../scripts/check_skill_docs.cjs)

**Likely new surfaces:**
- dedicated Anthropic skill source folder such as `anthropic-skill-src/` plus generated `dist/pandora-skill/`
- skill-specific references/assets copied or generated from repo docs
- upload/zip validation script
- trigger and regression fixtures

## Resources

- Anthropic guide: [The Complete Guide to Building Skills for Claude](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf)
- Anthropic guidance relevant to this gap:
  - frontmatter `description` drives triggering
  - skill folder should contain `SKILL.md` plus optional `references/`, `scripts/`, and `assets/`
  - upload/distribution expects a clean zip/folder
  - testing should cover should-trigger, paraphrase-trigger, and should-not-trigger cases

## Acceptance Criteria

- [x] The Anthropic skill-improvement work is decomposed into actionable sub-todos with clear scope.
- [x] Packaging, content, evaluation, and distribution work are separated so they can be executed independently.
- [x] Dependencies reflect the actual sequencing between frontmatter decisions, bundle structure, router content, evaluation, and release docs.
- [x] The final plan preserves the current Pandora docs while producing an Anthropic-native skill artifact.

## Work Log

### 2026-03-09 - Review synthesis and decomposition

**By:** Codex

**Actions:**
- Reviewed Anthropic's current skill guide against the shareable Pandora skill package
- Compared the existing root router, repo docs, and package exports with Anthropic's folder, trigger, and distribution expectations
- Split the improvement work into frontmatter, packaging, router content, evaluation, and distribution tracks

**Learnings:**
- The repo is already strong on domain knowledge and workflow depth
- The highest-value improvements are packaging and trigger clarity, not writing more operator detail

### 2026-03-09 - Implemented Anthropic skill improvement track

**By:** Codex

**Actions:**
- Rewrote the root [`SKILL.md`](../SKILL.md) with Anthropic-style `description` frontmatter, clearer triggers, examples, anti-patterns, and benchmark/install references
- Added a dedicated source skill at [`anthropic-skill-src/SKILL.md`](../anthropic-skill-src/SKILL.md) plus bundle build/check scripts at [`scripts/build_anthropic_skill_bundle.cjs`](../scripts/build_anthropic_skill_bundle.cjs) and [`scripts/check_anthropic_skill_bundle.cjs`](../scripts/check_anthropic_skill_bundle.cjs)
- Added install and eval docs plus trigger and functional fixtures under [`docs/skills`](../docs/skills) and [`tests/skills`](../tests/skills)
- Updated package scripts and package files so the Anthropic bundle can be built, checked, and distributed as `dist/pandora-skill/` or `dist/pandora-skill.zip`
- Rechecked with `npm run check:anthropic-skill`, `npm run check:docs`, JSON fixture parsing, and `node --test tests/unit/docs_skills_drift.test.cjs`

**Learnings:**
- The repo did not need new Pandora domain content; it needed a cleaner skill artifact boundary and a trigger/eval loop
- Bundle validation surfaced a real portability bug in [`docs/benchmarks/README.md`](../docs/benchmarks/README.md) that was fixed during the recheck
