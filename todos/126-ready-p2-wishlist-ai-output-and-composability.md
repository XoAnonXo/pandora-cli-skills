---
status: ready
priority: p2
issue_id: "126"
tags: [wishlist, ai, json, ndjson, errors, composability]
dependencies: []
---

# Wishlist batch 4: AI-optimized output and composability

## Problem Statement

The CLI is already agent-facing, but the wishlist asks for even more direct machine usability: universal high-fidelity JSON, better streaming NDJSON, composable discovery surfaces, and `pandora explain <error>`.

## Findings

- most commands already support `--output json`, and streaming surfaces already emit NDJSON.
- the remaining gap is consistency and direct operator/agent affordances for error explanation and shell composition.
- compatibility aliases must stay demoted while new AI-facing surfaces remain canonical.

## Recommended Action

Tighten JSON completeness where commands are still summary-heavy, add `pandora explain`, and add small discovery helpers like `mirror find` only where they remove real script-writing.

## Acceptance Criteria

- [ ] machine-readable errors include actionable remediation where feasible
- [ ] `pandora explain <error>` exists and maps canonical errors to remediation guidance
- [ ] streaming/watch surfaces remain NDJSON-first
- [ ] any new discovery/composition commands stay canonical-tool-first and scriptable
