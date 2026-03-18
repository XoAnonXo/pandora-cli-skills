---
status: ready
priority: p1
issue_id: "153"
tags: [recipes, agents, mcp, cli, trust-model, onboarding]
dependencies: []
---

# Add an agent-facing recipe trust model

Pandora recipes should become the main workflow catalog an agent can browse when a user asks, “What’s cool? What can we do?” Right now recipes are too flat. Agents can list and fetch them, but they do not get enough trust metadata to distinguish approved first-party workflows from user-created recipes or to choose safely for read-only versus live execution.

## Problem Statement

The desired experience is:

- an agent can discover a recipe catalog
- some recipes are clearly marked as approved
- some recipes are clearly marked as user recipes
- the agent can decide what to show, validate, and run based on trust and risk

Today the recipe surface mostly exposes:

- `source`
- `defaultPolicy`
- `defaultProfile`
- `safeByDefault`
- `supportsRemote`

That is not enough for the behavior we want. There is no explicit approval state, no first-class risk tier, and no clear execution guidance for agents deciding whether an unreviewed user recipe should only be validated or whether an approved live recipe is allowed to run.

Relevant current files:

- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/shared/recipe_schema.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/recipe_registry_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/recipe_command_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/parsers/recipe_flags.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/docs/skills/recipes.md`

## Product Goal

Recipes become the workflow catalog for agents.

Agents should be able to answer:

- “Show me approved recipes”
- “Show me my user recipes”
- “What safe things can we do?”
- “Which recipes are live?”
- “What can I validate but should not run without approval?”

The system should support both:

- first-party approved recipes
- user-created recipes

without collapsing trust, ownership, and risk into one field.

## Recommended Model

Add explicit metadata axes:

- `source`: `first-party | user`
- `approvalStatus`: `approved | unreviewed | experimental | deprecated`
- `riskLevel`: `read-only | paper | dry-run | live`

Keep existing execution metadata too:

- `safeByDefault`
- `mutating`
- `supportsRemote`
- `defaultPolicy`
- `defaultProfile`

Important design point:

- ownership and approval are different axes
- a recipe can be `source=user` and later become `approvalStatus=approved`
- a recipe can be `source=first-party` and still be `riskLevel=live`

## Agent Behavior Goal

Default agent behavior should be:

### Discovery mode

- show approved recipes first
- then show user recipes
- clearly group by trust/risk

### Validation mode

- approved recipes can be validated normally
- unreviewed user recipes can be validated, but the agent should call out that they are unreviewed

### Execution mode

- prefer approved recipes by default
- treat unreviewed user recipes as validate-first and do not run live without explicit user confirmation

### Live mode

- approved live recipes can be used when policy/profile compatibility passes
- unreviewed live recipes should require explicit user intent or a stricter execution gate

## Proposed CLI / MCP Shape

Add recipe list/get surfaces that expose and filter trust metadata.

### `recipe list`

Should support filters such as:

- `--source first-party|user|all`
- `--approval-status approved|unreviewed|experimental|deprecated|all`
- `--risk-level read-only|paper|dry-run|live|all`

MCP/SDK equivalents should accept the same concepts.

### `recipe get`

Should return:

- `source`
- `approvalStatus`
- `riskLevel`
- `mutating`
- `supportsRemote`
- `defaultPolicy`
- `defaultProfile`
- `docs`
- `benchmark`
- `tags`
- `summary`

### Optional later surfaces

These do not have to ship in the first pass, but the design should leave room for them:

- `recipe approve`
- `recipe deprecate`
- `recipe promote`
- `recipe import`

## Suggested First-Pass Scope

Do this in two layers:

### Layer 1: metadata and listing

- extend the schema to carry `source`, `approvalStatus`, and `riskLevel`
- update built-in recipes to declare the correct metadata
- make `recipe list` and `recipe get` expose that metadata
- add filters and grouping support

### Layer 2: agent guidance

- document the intended agent behavior
- make the skill/docs say:
  - approved recipes are recommended by default
  - user recipes are discoverable but not equally trusted
  - live recipes are explicit

Do not add a full recipe review workflow in the first pass unless it is easy.

## Technical Notes

### Likely affected files

- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/shared/recipe_schema.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/shared/recipe_builtin_packs.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/recipe_registry_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/recipe_command_service.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/parsers/recipe_flags.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/docs/skills/recipes.md`
- `/Users/mac/Desktop/pandora-market-setup-shareable/dist/pandora-skill/references/skills/recipes.md`

### Current gap to close

The current table/list rendering in `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/recipe_command_service.cjs` only shows:

- `id`
- `displayName`
- `tool`
- `defaultPolicy`
- `defaultProfile`

That is too little for agent-oriented recipe selection.

## Acceptance Criteria

- [ ] Recipe metadata includes explicit `source`, `approvalStatus`, and `riskLevel`
- [ ] `recipe list` exposes those fields in JSON and supports filtering by them
- [ ] `recipe get` exposes those fields for one recipe
- [ ] Built-in recipes are annotated consistently
- [ ] Docs explain how agents should treat approved versus user recipes
- [ ] Agents can safely distinguish “discoverable” from “recommended to run”
- [ ] Tests cover schema normalization, list/get output, and filter behavior

## Verification

- `node --test tests/unit/recipe_runtime.test.cjs tests/cli/recipe.integration.test.cjs`
- `node cli/pandora.cjs --output json recipe list`
- `node cli/pandora.cjs --output json recipe list --approval-status approved`
- `node cli/pandora.cjs --output json recipe list --source user`
- `node cli/pandora.cjs --output json recipe get --id <recipe-id>`
- `npm run check:docs`

## Recommended Worker Approach

1. Add the metadata fields to the schema and built-in packs.
2. Extend registry summaries and list/get payloads.
3. Add CLI filters for trust/risk dimensions.
4. Update docs and skill references so agents know how to rank recipes.
5. Add tests before widening into any future `approve/promote/import` workflow.

## Notes

- Keep the first pass focused on discoverability and trust signaling.
- Do not overbuild recipe governance yet.
- The main win is making recipes usable as an agent-facing workflow catalog.
