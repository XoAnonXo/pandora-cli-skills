---
status: ready
priority: p1
issue_id: "052"
tags: [sdk, typescript, python, packaging, agent-platform]
dependencies: []
---

# Problem Statement
Pandora ships embedded SDK artifacts inside the CLI package, but the SDKs are not yet first-class external products. That blocks easy third-party agent adoption and keeps the platform below A/A+.

# Findings
- The root package exports embedded TypeScript SDK entrypoints from `sdk/typescript`, but there is no separate publishable npm package flow.
- The Python client lives under `sdk/python`, but there is no PyPI-oriented release workflow or independent consumer smoke path.
- The contract compiler exists in `cli/lib/sdk_contract_service.cjs` and generation already works via `scripts/generate_agent_contract_sdk.cjs`.
- Current docs explicitly frame SDKs as embedded alpha surfaces, not standalone products.

# Proposed Solutions
## Option 1: Keep embedded-only SDKs
- Pros: lowest implementation effort.
- Cons: fails the A/A+ requirement for external agent ergonomics.

## Option 2: Publish standalone SDKs generated from the existing contract registry
- Pros: aligns with A/A+ target, keeps a single source of truth, improves third-party adoption.
- Cons: needs packaging, release automation, consumer smoke tests, and semver policy.

# Recommended Action
Implement standalone TypeScript and Python SDK release surfaces generated from the current contract registry while preserving the embedded SDKs for local consumers. Treat standalone packages as alpha but externally installable and parity-tested.

# Acceptance Criteria
- [ ] A standalone npm package for the TS SDK can be packed and installed from a clean temp directory.
- [ ] A standalone Python package can be built and installed from a clean virtualenv.
- [ ] Both SDKs support local stdio and remote HTTP backends with the same normalized envelope surface.
- [ ] SDK package docs and examples are generated or maintained in parity with the contract registry.
- [ ] CI/release gates fail if generated SDK artifacts drift from the contract registry.

# Work Log
### 2026-03-08 - Created phase index
**By:** Codex

**Actions:**
- Created the Phase 1 index todo and scoped the work around standalone SDK productization.
- Identified existing compiler/generator surfaces and the embedded SDK state in the repository.

**Learnings:**
- Pandora already has the right contract-generation core; the missing piece is productization and independent packaging.
