---
status: ready
priority: p1
issue_id: "053"
tags: [sdk, typescript, npm, packaging]
dependencies: ["052"]
---

# Problem Statement
The TypeScript SDK exists only as an embedded surface inside the CLI package. External agent teams cannot adopt it as a normal npm dependency with clear versioning and consumer ergonomics.

# Findings
- `sdk/typescript/package.json` exists but is not published independently.
- The root package exports TS SDK subpaths, which is useful but not sufficient for ecosystem adoption.
- Consumer smoke currently validates installed root-package behavior, not standalone SDK consumption.

# Proposed Solutions
## Option 1: Continue shipping only embedded SDK files
- Pros: simple.
- Cons: weak external adoption, poor DX, no independent lifecycle.

## Option 2: Publish `@pandora/agent-sdk`
- Pros: standard npm consumption, cleaner onboarding, independent docs/examples.
- Cons: needs packaging, version strategy, release automation, smoke tests.

# Recommended Action
Create a publishable `@pandora/agent-sdk` package generated from the contract registry and backed by the same runtime code paths as the embedded SDK.

# Acceptance Criteria
- [ ] Standalone TS package manifest is valid and publishable.
- [ ] `npm pack` on the TS SDK package succeeds from a clean workspace.
- [ ] A clean temp consumer can `npm install` the SDK package and call `capabilities`, `schema`, and a read-only tool.
- [ ] README examples run against both local stdio and remote HTTP backends.
- [ ] SDK package artifacts are generated from the same digest as `sdk/generated`.

# Work Log
### 2026-03-08 - Created TS SDK todo
**By:** Codex

**Actions:**
- Scoped the TS SDK work around standalone packaging, external install, and parity.

**Learnings:**
- This lane should avoid touching signer/profile runtime work to reduce collisions.
