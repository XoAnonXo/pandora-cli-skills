---
status: complete
priority: p1
issue_id: "167"
tags: [setup, onboarding, cli, mcp, ux, doctor]
dependencies: []
---

# Redesign Setup Onboarding For CLI And MCP

## Problem Statement

The current onboarding flow is better than raw env editing, but it still behaves like a linear prompt script instead of a proper first-run setup experience. It asks for signer material too early, does not match its own documentation around review and validation, and is only suitable for a human TTY session. That makes the CLI feel rough for first-time users and leaves MCP clients without a structured setup surface.

## Findings

- `setup_wizard_service.cjs` always asks for a Pandora private key before tailoring the flow to the selected goal, so read-only journeys like `explore` and `hosted-gateway` still feel signer-first.
- The interactive wizard uses numeric `readline` prompts instead of arrow-key menus, a stepper, or a review/edit stage, so it does not feel like a modern CLI installer.
- The docs promise scoped validation and a redacted summary before writing, but `setup_command_service.cjs` writes the env file first and only runs doctor once at the end.
- Goal-specific collection is incomplete. `deploy` still depends on runtime fields the wizard does not actively guide the user through, while optional sports/hosting prompts are too generic and weakly tied to the selected goal.
- `setup --interactive` is explicitly TTY-only, which is appropriate for a human wizard but the wrong abstraction for MCP clients or agent-driven setup.
- Existing tests cover the old numeric prompt model and basic env capture, but not arrow-key navigation, review-before-write, or a structured non-interactive setup plan.

## Proposed Solutions

### Option 1: Redesign the wizard and add an MCP-friendly setup planning surface

**Approach:** Rework the interactive flow into a goal-first installer with arrow-key menus, step-level review/validation, and a final redacted diff before write. Add a structured non-interactive setup planning surface so MCP clients can inspect required steps and fields without a TTY.

**Pros:**
- Fixes the first-run CLI experience directly
- Aligns implementation with the onboarding docs and user expectations
- Gives agents a stable, structured setup contract instead of a TTY wizard
- Keeps manual env editing and `doctor` intact for power users

**Cons:**
- Requires coordinated changes across wizard UI, setup orchestration, doctor usage, tests, and docs
- Increases the complexity of the setup command path

**Effort:** 1-2 days

**Risk:** Medium

---

### Option 2: Keep the existing wizard and only patch the most obvious logic problems

**Approach:** Remove premature signer prompts for read-only goals, add a final summary, and leave the numeric `readline` interface mostly intact.

**Pros:**
- Smaller code change
- Lower implementation risk

**Cons:**
- Still does not feel like a proper setup app
- Leaves MCP without a structured onboarding surface
- Only partially addresses the user experience problem

**Effort:** 3-5 hours

**Risk:** Low

## Recommended Action

Implement Option 1. The onboarding surface should split into two complementary modes:

- a human-focused CLI wizard with arrow-key navigation, goal-first branching, step-level review, and a final redacted diff before write
- an MCP-friendly structured setup plan surface that exposes steps, fields, defaults, and validation expectations without requiring a TTY

The wizard should reorder the journey to:

1. Select goal
2. Select mode
3. Capture goal-specific runtime basics
4. Offer signer setup only when the goal or user choice requires it
5. Capture goal-relevant integrations
6. Review the redacted change set
7. Confirm write
8. Run final doctor and print exact next commands

## Technical Details

**Primary files:**
- `cli/lib/setup_wizard_service.cjs`
- `cli/lib/setup_command_service.cjs`
- `cli/lib/doctor_service.cjs`
- `cli/pandora.cjs`
- `cli/lib/parsers/core_command_flags.cjs`
- `cli/lib/schema_command_service.cjs`
- `cli/lib/agent_contract_registry.cjs`
- `docs/skills/setup-and-onboarding.md`
- `docs/skills/command-reference.md`
- `tests/helpers/cli_runner.cjs`
- `tests/cli/cli.integration.test.cjs`

**Likely new files:**
- `cli/lib/setup_plan_service.cjs` or equivalent setup-planning helper
- `cli/lib/setup_terminal_ui.cjs` or equivalent prompt helper

## Acceptance Criteria

- [x] `explore` and `hosted-gateway` no longer request Pandora or Polymarket signer material by default
- [x] Interactive setup uses arrow-key style selection for goal/mode and major branch choices while preserving a safe fallback for limited terminals
- [x] The wizard shows a redacted review screen before anything is written to disk
- [x] The wizard performs scoped validation during setup and a final full doctor run at the end
- [x] `deploy` onboarding collects the runtime inputs required for actual deploy readiness, not just signer material
- [x] Sports, hosting, and resolution-source prompts are gated by the selected goal and phrased as goal-relevant choices rather than generic optional forms
- [x] MCP has a structured non-interactive setup planning surface with machine-readable steps, fields, defaults, and next actions
- [x] Docs, JSON contracts, and CLI help all reflect the redesigned onboarding flow
- [x] Integration tests cover arrow-key navigation, read-only goals, review-before-write behavior, and the MCP planning surface
- [x] `npm run release:verify` passes after the onboarding redesign

## Detailed Todo List

### Wizard UX
- [x] Keep onboarding goal-first and remove signer prompts from read-only goals by default
- [x] Preserve raw arrow-key navigation for selects while keeping numeric fallback for deterministic tests and limited terminals
- [x] Replace generic yes/no text prompts with goal-relevant menu choices for hosting, sports/Odds, and resolution-source setup
- [x] Keep the redacted review step as the final write gate
- [x] Prevent mirror funder prompts when the Polymarket signer step is skipped without existing credentials

### MCP / Planning Surface
- [x] Add and keep `setup --plan` as a non-writing machine-readable onboarding surface
- [x] Keep `doctor --goal` usable with staged env overlays during guided setup
- [x] Expose review/write gating metadata and plan steps through setup payloads and schemas

### Contracts / Docs / Tests
- [x] Update onboarding docs and help text to reflect the goal-first CLI + MCP split
- [x] Keep agent contract metadata aligned with `setup --plan` and review-before-write behavior
- [x] Cover raw arrow-key selection, read-only goals, mirror review flow, and no-write planning in CLI tests
- [x] Refresh generated SDK contract artifacts and rerun the parity tests
- [x] Run the relevant onboarding verification suite and then the full release gate

## Residual Follow-Ups

- The review screen is now a real write gate, but it is still confirm/cancel only. A future pass should let users jump back into a specific section from review instead of restarting the wizard.
- `setup --plan` is the intended MCP-friendly planning surface, but it still shares the generic `setup` contract metadata rather than advertising a distinct first-class planning contract. That is workable today, but still a discoverability compromise for agent clients.

## Work Log

### 2026-03-18 - Initial Triage

**By:** Codex

**Actions:**
- Reviewed the current onboarding flow across `setup_wizard_service.cjs`, `setup_command_service.cjs`, `doctor_service.cjs`, and onboarding docs
- Confirmed that `explore` and `hosted-gateway` still feel signer-first
- Confirmed that docs promise review and step-level validation that the implementation does not currently provide
- Confirmed the interactive flow is numeric-prompt `readline`, not arrow-key CLI UX
- Identified the need to split human TTY onboarding from MCP-friendly structured setup

**Learnings:**
- The current setup flow is directionally correct but still reads like an internal tool, not a polished installer
- CLI and MCP should share the same setup model, but not the same interaction surface
