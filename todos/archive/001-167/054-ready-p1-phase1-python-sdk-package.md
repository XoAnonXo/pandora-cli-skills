---
status: ready
priority: p1
issue_id: "054"
tags: [sdk, python, pypi, packaging]
dependencies: ["052"]
---

# Problem Statement
The Python SDK is present in-repo but not treated as an external product. That weakens agent adoption for Python-first teams.

# Findings
- `sdk/python/pyproject.toml` and package sources already exist.
- Tests exist under `sdk/python/tests`, but not all are framed as external consumer acceptance.
- Current docs describe the Python SDK as embedded, not standalone.

# Proposed Solutions
## Option 1: Embedded-only Python package
- Pros: minimal effort.
- Cons: weak for external agent builders.

## Option 2: Publish `pandora-agent` as a standalone Python package
- Pros: standard Python adoption path, parity with TS SDK direction.
- Cons: packaging and release automation required.

# Recommended Action
Prepare a standalone Python SDK package release path that keeps generated artifacts in lockstep with the contract registry and validates clean-venv installation plus live bootstrap behavior.

# Acceptance Criteria
- [ ] `python -m build` / equivalent packaging flow succeeds.
- [ ] A clean virtualenv can install the package and call `capabilities`, `schema`, and read-only operations.
- [ ] Package metadata and docs clearly describe local stdio vs remote HTTP backends.
- [ ] Python generated manifests remain in digest parity with the contract registry.
- [ ] Runtime errors are normalized into stable Python exceptions.

# Work Log
### 2026-03-08 - Created Python SDK todo
**By:** Codex

**Actions:**
- Scoped Python packaging, external install, backend parity, and docs as the core concerns.

**Learnings:**
- Python packaging should stay focused on consumer ergonomics, not signer implementation.
