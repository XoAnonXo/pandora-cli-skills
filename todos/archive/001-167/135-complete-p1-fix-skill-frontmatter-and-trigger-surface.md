---
status: complete
priority: p1
issue_id: "135"
tags: [skills, anthropic, frontmatter, triggers, naming]
dependencies: []
---

# Fix skill frontmatter and trigger surface

## Problem Statement

The current Pandora skill does not present an Anthropic-native trigger surface. Anthropic's guide treats YAML frontmatter as the first and most important layer of progressive disclosure, but the current root [`SKILL.md`](../SKILL.md) uses `summary:` instead of `description:` and does not clearly encode when the skill should activate, which user phrases should trigger it, or which adjacent requests should not.

If this is not corrected first, the rest of the skill work risks optimizing the body content while keeping a weak or incompatible activation surface.

## Findings

- [`SKILL.md`](../SKILL.md) frontmatter currently contains:
  - `name: pandora-cli-skills`
  - `summary: ...`
  - `version: 1.1.73`
- Anthropic's guide expects `description:` to carry both:
  - what the skill does
  - when to use it, including concrete trigger phrases
- The current name and packaging context are inconsistent:
  - repo folder here is `pandora-market-setup-shareable`
  - package name is `pandora-cli-skills`
  - Anthropic guidance recommends the skill name match the skill folder name
- The current opener is domain-accurate but not query-optimized. It explains Pandora capabilities more than it explains what a user can ask Claude to accomplish.
- The current skill also lacks explicit negative scope language, which increases the risk of over-triggering for generic crypto or coding tasks.

## Proposed Solutions

### Option 1: Minimal compatibility patch

**Approach:** Replace `summary:` with `description:` and keep the rest of the frontmatter mostly unchanged.

**Pros:**
- Fastest path to minimum compatibility
- Minimal repo churn

**Cons:**
- Does not solve name/folder consistency
- Likely leaves trigger quality mediocre

**Effort:** 1-2 hours

**Risk:** Medium

---

### Option 2: Full frontmatter redesign for Anthropic triggering

**Approach:** Rework the name, description, optional `compatibility`, and `metadata` fields around explicit jobs-to-be-done, trigger phrases, and exclusions.

**Pros:**
- Aligns with Anthropic's intended trigger model
- Clarifies the skill's scope before any deeper docs load
- Creates a stable foundation for evaluations and packaging

**Cons:**
- Requires choosing a durable public skill identity
- May require small updates in docs and packaging scripts

**Effort:** 0.5 day

**Risk:** Low

---

### Option 3: Multiple narrow skills instead of one broader Pandora skill

**Approach:** Split Pandora into smaller skills such as discovery, mirror operations, and agent bootstrap.

**Pros:**
- Potentially sharper trigger precision
- Easier mental model per skill

**Cons:**
- More maintenance
- Harder distribution story
- Not necessary before the current trigger surface is fixed

**Effort:** 2-4 days

**Risk:** Medium

## Recommended Action

Use Option 2.

Define a single Anthropic-facing skill identity and rewrite the frontmatter around user outcomes. The `description` should explicitly cover:

- core jobs the skill handles
- phrases users are likely to say
- high-value tool families the skill can route
- negative scope boundaries

Target positioning:

- what it does:
  - bootstrap Pandora safely
  - inspect capabilities/schema/policies/profiles
  - route trading, mirror, and closeout workflows
  - guide MCP and SDK usage
- when to use it:
  - “bootstrap Pandora”
  - “quote a market”
  - “plan a mirror market”
  - “check profile readiness”
  - “start Pandora MCP”
- when not to use it:
  - generic crypto news/research
  - unrelated coding tasks
  - generic spreadsheet/document requests

## Technical Details

**Primary files:**
- [`SKILL.md`](../SKILL.md)
- [`package.json`](../package.json)
- any new Anthropic-native skill directory introduced by issue `136`

**Specific decisions to make:**
- choose a stable public skill folder/name pair
- add `description:` and remove or demote `summary:` from Anthropic-facing frontmatter
- consider `compatibility:` for Node/runtime/network expectations
- keep optional `metadata.version` instead of relying on top-level custom fields if that better matches the target packaging story

**Drafting constraints:**
- keep under Anthropic's 1024-character description budget
- use natural user wording, not only internal command names
- include at least 2-3 positive triggers and 2-3 negative boundaries

## Resources

- Anthropic guide: [The Complete Guide to Building Skills for Claude](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf)
- Current root skill: [`SKILL.md`](../SKILL.md)
- Anthropic packaging/distribution metadata source: [`package.json`](../package.json)

## Acceptance Criteria

- [x] Anthropic-facing frontmatter uses `description:` rather than `summary:`.
- [x] The skill name is aligned with the uploadable folder name.
- [x] The description states both what the skill does and when to use it.
- [x] The description includes concrete user-language trigger phrases.
- [x] Negative scope boundaries are documented to reduce over-triggering.
- [x] Optional compatibility or metadata fields are used intentionally, not ad hoc.

## Work Log

### 2026-03-09 - Trigger-surface gap identified

**By:** Codex

**Actions:**
- Compared the current root frontmatter against Anthropic's required `description` model
- Reviewed current naming across repo folder, package metadata, and root skill
- Drafted the trigger-surface decisions required before packaging or eval work

**Learnings:**
- This is the highest-leverage skills change because Anthropic treats frontmatter as the entrypoint to all later instructions
- The current problem is not missing capability coverage; it is weak trigger encoding

### 2026-03-09 - Implemented trigger-surface rewrite

**By:** Codex

**Actions:**
- Replaced root skill `summary:` frontmatter with an Anthropic-style `description:` in [`SKILL.md`](../SKILL.md)
- Added explicit compatibility and metadata fields for the root skill
- Wrote a dedicated Anthropic-facing source skill in [`anthropic-skill-src/SKILL.md`](../anthropic-skill-src/SKILL.md) with the folder-aligned name `pandora-skill`
- Added explicit positive triggers, outcome framing, and negative-scope guidance in both the root skill and Anthropic bundle source

**Learnings:**
- A separate uploadable skill identity made it easier to align name, folder, and trigger semantics without losing the richer repo router
