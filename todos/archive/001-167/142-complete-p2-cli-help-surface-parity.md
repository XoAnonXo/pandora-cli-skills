---
status: complete
priority: p2
issue_id: "142"
tags: [cli, help, docs, discoverability, wishlist]
dependencies: []
---

# CLI help surface parity

## Problem Statement

The implemented command surface had started to outrun the visible help output, which made operator and agent discovery less trustworthy than the underlying code.

## Findings

- Root help now lists `markets mine` and the full mirror family including `mirror logs`.
- Table-mode `pandora dashboard --help` renders usage and notes instead of falling through to the generic `Done.` output.
- `sports scores --help` and `sports schedule --help` both return subcommand-specific help in JSON and table modes.
- Focused tests already cover these discoverability paths:
  - `tests/cli/cli.integration.test.cjs`
  - `tests/cli/sports.integration.test.cjs`

## Recommended Action

Mark this todo complete. The current tree already satisfies the intended parity requirements.

## Acceptance Criteria

- [x] Root help lists `markets mine` and the full current mirror family including `mirror logs`
- [x] Table-mode `dashboard --help` renders usage and notes instead of `Done.`
- [x] Sports subcommands return specific help output for `scores` and `schedule`
- [x] Tests cover the updated help/discoverability paths

## Work Log

### 2026-03-10 - Wishlist parity audit

**By:** Codex

**Actions:**
- Re-checked root help, table-mode dashboard help, and sports subcommand help against the current CLI
- Verified the expected behavior directly via CLI invocation
- Confirmed focused test coverage already exists for help/discoverability paths

**Learnings:**
- This todo was stale; the codebase had already caught up to the original gap
