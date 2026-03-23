---
status: complete
priority: p1
issue_id: "088"
tags: [a-plus, phase2, typescript, sdk, npm]
dependencies: ["087"]
---

# Problem Statement
The TypeScript SDK needs to become a clean public npm package with stable entrypoints, docs, and smoke-tested install behavior.

# Acceptance Criteria
- [ ] Standalone TS package manifest and exports are defined.
- [ ] Local stdio and remote HTTP backends are public SDK APIs.
- [ ] Clean-temp install smoke passes from npm package artifacts.
- [ ] Docs/examples no longer assume a repo checkout.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

### 2026-03-08 - Work in progress
**By:** Codex

**Actions:**
- Added standalone TypeScript package metadata, generated artifacts, package-local tests, and tarball smoke coverage.
- Tightened docs and trust artifacts so the TS SDK surface is described as a standalone signed release artifact rather than a repo-only implementation detail.

### 2026-03-08 - Completed
**By:** Codex

**Actions:**
- Added native ESM entrypoints and generated-artifact ESM wrappers for the standalone TypeScript package.
- Aligned generated contract-registry package identity with the standalone package version and extended artifact smoke to validate CommonJS and ESM consumers.
