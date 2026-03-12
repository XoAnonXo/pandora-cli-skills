---
status: ready
priority: p2
issue_id: "148"
tags: [agents, onboarding, skill, mcp, docs, amm, parimutuel]
dependencies: []
---

# Unify AMM versus parimutuel teaching for agent-first onboarding

Pandora can already plan and validate both AMM and parimutuel markets, but the first-run teaching layer for external agents is still too fragmented. A newcomer can continue through the flow, but they still have to assemble the meaning of `AMM`, `parimutuel`, and distribution skew from multiple docs and partial prompts instead of getting one clean recommendation contract.

## Problem Statement

A skill-installed or MCP-first user often does not arrive knowing market mechanics. They ask questions like:

- “What kind of market should I use?”
- “I want a 99.9/0.1 market.”
- “What does parimutuel mean?”

Today Pandora handles the mechanics correctly, but the explanation layer is spread across:

- the Anthropic skill routing
- hype-market docs
- trading docs
- adjacent autocomplete and validation prompts

That makes the system feel more operator-grade than newcomer-friendly.

## Findings

- The agent experience audit in [agent-experience-audit.md](/Users/mac/Desktop/pandora-market-setup-shareable/docs/skills/agent-experience-audit.md) explicitly calls out “first-run market-type teaching” as one of the remaining weak areas for external agents.
- The live MCP parimutuel journey in [mcp-parimutuel.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/mcp-parimutuel.json) shows that Pandora already does several important things correctly:
  - planning accepts an extreme `99.9/0.1` parimutuel skew
  - dry-run planning works before signer setup
  - the autocomplete layer gives a minimal explanation that parimutuel is pool-based and locked until resolution
- The skill-runtime subset in [skill-runtime-agent-audit.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/skill-runtime-agent-audit.json) shows the skill is already good at safe bootstrap, but it does not yet provide one canonical “choose AMM vs parimutuel” teaching block.
- Current docs contain the relevant pieces, but not one clear first-run decision surface:
  - [anthropic-skill-src/SKILL.md](/Users/mac/Desktop/pandora-market-setup-shareable/anthropic-skill-src/SKILL.md)
  - [docs/skills/hype-markets.md](/Users/mac/Desktop/pandora-market-setup-shareable/docs/skills/hype-markets.md)
  - [docs/skills/trading-workflows.md](/Users/mac/Desktop/pandora-market-setup-shareable/docs/skills/trading-workflows.md)
  - [docs/skills/agent-quickstart.md](/Users/mac/Desktop/pandora-market-setup-shareable/docs/skills/agent-quickstart.md)

## Proposed Solutions

### Option 1: Add one canonical market-type decision explainer

**Approach:** Add a single reusable explanation block that every agent-facing onboarding surface can reuse when the user is choosing a market type.

**Pros:**
- Lowest ambiguity for first-run users
- Keeps product language consistent across skill, MCP, and docs

**Cons:**
- Requires touching several documentation and prompt surfaces
- Still relies on the agent to route to that block at the right time

**Effort:** 3-6 hours

**Risk:** Low

---

### Option 2: Add output-level “why this type” explanations to planning flows

**Approach:** In addition to docs and prompts, include a small natural-language explanation in plan/autocomplete responses that says why AMM or parimutuel fits the user’s request.

**Pros:**
- Teaches through the actual workflow, not only through docs
- Helps agents explain recommendations with less custom prompting

**Cons:**
- Slightly broader surface change
- Must avoid making machine-readable outputs noisy or unstable

**Effort:** 4-8 hours

**Risk:** Medium

## Recommended Action

Implement Option 1 first and include a narrow slice of Option 2 if it can be done without destabilizing output contracts. The minimum bar is that a fresh agent user who says “I want a 99.9/0.1 market” gets one clean explanation of:

- what AMM means
- what parimutuel means
- when each is the better fit
- what the skew means operationally

That explanation should appear consistently across the skill, MCP guidance, and the relevant docs.

## Technical Details

**Likely affected files:**
- `/Users/mac/Desktop/pandora-market-setup-shareable/anthropic-skill-src/SKILL.md`
- `/Users/mac/Desktop/pandora-market-setup-shareable/docs/skills/hype-markets.md`
- `/Users/mac/Desktop/pandora-market-setup-shareable/docs/skills/trading-workflows.md`
- `/Users/mac/Desktop/pandora-market-setup-shareable/docs/skills/agent-quickstart.md`
- `/Users/mac/Desktop/pandora-market-setup-shareable/tests/skills/functional-scenarios.json`
- `/Users/mac/Desktop/pandora-market-setup-shareable/docs/skills/anthropic-skill-evals.md`

**Related scenarios:**
- `mcp-parimutuel`
- skill-runtime `safe-bootstrap` as adjacent onboarding evidence

## Resources

- Audit doc: [agent-experience-audit.md](/Users/mac/Desktop/pandora-market-setup-shareable/docs/skills/agent-experience-audit.md)
- Live journey report: [mcp-parimutuel.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/user-journeys/mcp-parimutuel.json)
- Skill-runtime subset: [skill-runtime-agent-audit.json](/Users/mac/Desktop/pandora-market-setup-shareable/output/e2e/skill-runtime-agent-audit.json)

## Acceptance Criteria

- [ ] Agent-facing docs and skill guidance contain one consistent “AMM vs parimutuel” explanation
- [ ] The explanation covers extreme-skew requests such as `99.9/0.1` in plain language
- [ ] First-run agent guidance explains why Pandora is recommending one market type instead of the other
- [ ] Skill eval fixtures or functional scenarios cover the market-type teaching case explicitly
- [ ] `npm run check:docs` and any affected skill checks pass

## Work Log

### 2026-03-13 - Todo creation

**By:** Codex

**Actions:**
- converted the remaining market-type teaching gap from the agent experience audit into a worker-ready todo
- tied it to the live MCP parimutuel journey and the skill-runtime onboarding evidence
- scoped the work around consistent teaching and recommendation language rather than protocol mechanics

**Learnings:**
- the planning and validation mechanics are already stronger than the explanation layer
- the biggest remaining gap is not “can Pandora do this?” but “does the first-run user understand why Pandora is steering them this way?”

## Notes

- Keep machine-readable contracts stable. Favor explanation blocks, docs, and narrow additive guidance over large response-shape changes.
