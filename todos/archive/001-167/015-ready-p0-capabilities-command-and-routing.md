---
status: ready
priority: p0
issue_id: "015"
tags: [agent-platform, capabilities, command-surface, phase0]
dependencies: ["014"]
---

# Phase 0 Capabilities Command and Routing

Add a first-class `capabilities` command that exposes the live agent/tool/platform surface in one machine-readable payload.

## Problem Statement

Agents should not have to reconstruct transport, policy, profile, and workflow support from scattered docs and schema fragments.

## Technical Scope

**Primary files:**
- `cli/lib/capabilities_command_service.cjs` (new)
- `cli/lib/command_router.cjs`
- `cli/pandora.cjs`

## Required Deliverables

- Add `pandora [--output json] capabilities`
- Return:
  - command contract version
  - supported transports
  - capability catalog summary
  - current policy/profile support status
  - operation protocol readiness status
  - version compatibility metadata
- Add help text and top-level routing
- Keep JSON-first; table mode may print a concise summary

## Acceptance Criteria

- [ ] `pandora --output json capabilities` exists and is stable
- [ ] Payload is generated from the contract source of truth
- [ ] Top-level help mentions the command
- [ ] Router and CLI integration tests cover the command
