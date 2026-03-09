---
status: complete
priority: p2
issue_id: "126"
tags: [wishlist, ai, json, ndjson, errors, composability]
dependencies: []
---

# Wishlist batch 4: AI-optimized output and composability

## Problem Statement

The wishlist called for a machine-first CLI: structured JSON output, NDJSON where streaming matters, better remediation, and a direct `pandora explain <error>` surface.

## Findings

- `pandora explain` now exists as a first-class remediation command with both direct-code and stdin-driven flows.
- Structured JSON success/error envelopes are already the default machine contract for CLI, MCP, and generated SDK surfaces.
- Streaming surfaces already use NDJSON where appropriate, including `stream` and bounded-vs-streaming `arb scan`.
- Docs and tests already describe and verify the AI-facing contracts across help, schemas, and MCP envelopes.
- The remaining inconsistencies found during this audit are discoverability/help issues, not missing AI output primitives.

## Recommended Action

Mark this batch complete. Track the residual help-surface issues separately instead of leaving the AI-output batch open.

## Acceptance Criteria

- [x] Machine-readable errors include actionable remediation where feasible
- [x] `pandora explain <error>` exists and maps canonical errors to guidance
- [x] Streaming/watch-oriented surfaces keep NDJSON-first behavior where designed
- [x] New AI-facing commands remain canonical-tool-first and scriptable

## Work Log

### 2026-03-09 - Initial wishlist decomposition

**By:** Codex

**Actions:**
- Created the AI/composability wishlist batch

**Learnings:**
- Most of the desired behavior was already aligned with the repo’s agent-first direction

### 2026-03-10 - Parity audit and closeout

**By:** Codex

**Actions:**
- Audited current CLI help, docs, error envelopes, and tests
- Confirmed `explain`, structured error payloads, and NDJSON streaming behavior are shipped
- Split remaining discoverability issues into a separate help-parity todo

**Learnings:**
- This batch is functionally complete; the leftover work is UX/discoverability polish
