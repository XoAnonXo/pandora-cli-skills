---
status: complete
priority: p1
issue_id: "089"
tags: [a-plus, phase2, python, sdk, pypi]
dependencies: ["087"]
---

# Problem Statement
The Python SDK needs to become a clean public package with the same contract and runtime guarantees as the TypeScript SDK.

# Acceptance Criteria
- [ ] Standalone Python package metadata and build flow are defined.
- [ ] Local and remote backends are public SDK APIs.
- [ ] Fresh virtualenv install smoke passes from package artifacts.
- [ ] Docs/examples do not depend on the repo checkout.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

### 2026-03-08 - Work in progress
**By:** Codex

**Actions:**
- Added standalone Python package metadata, generated artifacts, wheel/sdist smoke coverage, and package-local tests.
- Cleaned Python build/cache junk from the repo worktree and aligned documentation with the actual standalone Python artifact story.

### 2026-03-08 - Completed
**By:** Codex

**Actions:**
- Added project URLs and tightened MANIFEST rules so the standalone Python package ships a cleaner external-consumer surface.
- Fixed package-local test execution so it validates the SDK package tree instead of accidentally importing a globally installed module.
