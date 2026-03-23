---
status: complete
priority: p1
issue_id: "137"
tags: [skills, anthropic, router, docs, outcomes, troubleshooting]
dependencies: ["135"]
---

# Rewrite skill router for outcome-first use

## Problem Statement

The current root skill is an accurate documentation router, but it reads like an internal operator index rather than a user-facing skill. Anthropic's guide recommends writing the main instructions around outcomes, common requests, examples, and troubleshooting. Right now Pandora's root skill is mostly a list of linked documents and safety rules, which is useful after the skill is loaded but less helpful in teaching Claude how to help the user from the first turn.

This creates a mismatch between “Pandora has rich documentation” and “Pandora is easy for Claude to use as a skill.”

## Findings

- [`SKILL.md`](../SKILL.md) begins with “Pandora CLI & Skills” and a doc-router section rather than a short quick-start framed around user asks.
- The linked docs already contain strong workflows and safe examples:
  - [`docs/skills/agent-quickstart.md`](../docs/skills/agent-quickstart.md)
  - [`docs/skills/trading-workflows.md`](../docs/skills/trading-workflows.md)
  - [`docs/skills/mirror-operations.md`](../docs/skills/mirror-operations.md)
  - [`docs/skills/portfolio-closeout.md`](../docs/skills/portfolio-closeout.md)
- Anthropic's guide recommends the main file include:
  - immediate instructions or quick start
  - example scenarios
  - troubleshooting/common issues
  - links to bundled references for deeper detail
- The current root skill includes high-signal safety rules, but there is no concise “if the user asks X, do Y first” section at the top.
- The current skill also does not separate problem-first and tool-first entrypoints, even though Anthropic explicitly recommends choosing or clarifying that posture.

## Proposed Solutions

### Option 1: Keep the existing router and just shorten it

**Approach:** Trim the current list of links and safety notes without changing the structure much.

**Pros:**
- Low effort
- Minimal churn

**Cons:**
- Does not address the outcome-first problem
- Still weak as a skill teaching surface

**Effort:** 2-3 hours

**Risk:** Medium

---

### Option 2: Rewrite the root skill into a true Anthropic-style router

**Approach:** Keep the progressive-disclosure architecture, but reframe `SKILL.md` around:
- what Pandora helps users accomplish
- a quick-start decision tree
- common user intents and first moves
- concise examples
- troubleshooting and safety
- links to deeper bundled references

**Pros:**
- Aligns with Anthropic's documented pattern
- Reuses existing Pandora docs instead of replacing them
- Improves real first-turn behavior

**Cons:**
- Requires careful editing to avoid duplicating too much detail

**Effort:** 0.5-1 day

**Risk:** Low

---

### Option 3: Split the router into multiple public skills first

**Approach:** Avoid a single top-level router and publish narrower skills per workflow family.

**Pros:**
- Cleaner per-intent instructions

**Cons:**
- More operational complexity
- Not needed until the current root skill is rewritten well

**Effort:** 2-3 days

**Risk:** Medium

## Recommended Action

Use Option 2.

Rewrite the Anthropic-facing `SKILL.md` into these sections:

1. **Outcome framing**
   - what the skill helps users do
   - when to use it
2. **Quick start**
   - bootstrap first
   - stay read-only first
   - choose local MCP vs hosted HTTP only after identifying the use case
3. **Common requests**
   - “discover markets”
   - “quote a trade”
   - “plan a mirror market”
   - “check whether a profile is ready”
   - “start Pandora MCP for an agent”
4. **Examples**
   - at least one discovery example
   - one mutation-preflight example
   - one agent/MCP bootstrap example
5. **Troubleshooting / anti-patterns**
   - do not start by asking for private keys
   - do not use Polymarket URLs as resolution sources
   - do not reuse stale validation tickets
6. **Reference links**
   - route to the smallest bundled reference needed

Also add explicit posture guidance:

- problem-first:
  - “help me mirror this Polymarket market safely”
- tool-first:
  - “I have Pandora installed, what should I call first?”

## Technical Details

**Primary files:**
- Anthropic-facing [`SKILL.md`](../SKILL.md) or generated copy from issue `136`
- [`docs/skills/agent-quickstart.md`](../docs/skills/agent-quickstart.md)
- [`docs/skills/trading-workflows.md`](../docs/skills/trading-workflows.md)
- [`docs/skills/mirror-operations.md`](../docs/skills/mirror-operations.md)
- [`docs/skills/policy-profiles.md`](../docs/skills/policy-profiles.md)
- [`docs/skills/portfolio-closeout.md`](../docs/skills/portfolio-closeout.md)

**Editing constraints:**
- keep the router concise
- keep detailed command matrices in references, not inline
- preserve non-negotiable safety rules, but move them into a clearly teachable structure
- make examples copyable and realistic

## Resources

- Anthropic guide: [The Complete Guide to Building Skills for Claude](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf)
- Current router: [`SKILL.md`](../SKILL.md)
- Strong existing workflow references:
  - [`docs/skills/agent-quickstart.md`](../docs/skills/agent-quickstart.md)
  - [`docs/skills/trading-workflows.md`](../docs/skills/trading-workflows.md)
  - [`docs/skills/mirror-operations.md`](../docs/skills/mirror-operations.md)

## Acceptance Criteria

- [x] The Anthropic-facing router opens with user outcomes rather than internal capability inventory.
- [x] A quick-start path tells Claude what to do first on common Pandora requests.
- [x] Common-request examples exist for discovery, quote, mirror planning, and MCP/bootstrap use cases.
- [x] Troubleshooting and anti-pattern guidance is explicit and concise.
- [x] Deep detail is linked from references rather than inlined into the router.
- [x] The rewritten router still preserves Pandora's critical safety guidance.

## Work Log

### 2026-03-09 - Router rewrite scoped

**By:** Codex

**Actions:**
- Compared the current Pandora root skill with Anthropic's recommended skill-body structure
- Identified which sections should stay in the main router versus move into linked references
- Defined the user-intent examples and anti-patterns needed for a skill-first experience

**Learnings:**
- The repo already has enough content for a strong Anthropic skill; the missing piece is instructional shape, not domain depth

### 2026-03-09 - Rewrote root and bundle routers

**By:** Codex

**Actions:**
- Replaced the old root doc-index style opener in [`SKILL.md`](../SKILL.md) with outcome-first quick start, common requests, examples, safety rules, and anti-patterns
- Added small-reference routing instead of a pure inventory-style document list
- Wrote a dedicated Anthropic bundle router in [`anthropic-skill-src/SKILL.md`](../anthropic-skill-src/SKILL.md) that points only at bundled references

**Learnings:**
- The root skill can stay useful for repo consumers while still becoming much more effective as a first-loaded skill surface
