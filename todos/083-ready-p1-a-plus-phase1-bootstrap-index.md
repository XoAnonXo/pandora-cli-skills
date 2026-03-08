---
status: complete
priority: p1
issue_id: "083"
tags: [a-plus, phase1, bootstrap, agent-platform, mcp, schema]
dependencies: []
---

# Problem Statement
Pandora still requires too much bootstrap reasoning from a cold external agent. The current startup path is split across `capabilities`, `schema`, `tools`, `policy list`, `profile list`, and documentation. That keeps the platform below A+ even though the underlying surfaces are strong.

# Findings
- Remote HTTP MCP already exposes `/capabilities`, `/schema`, `/tools`, and `/operations`, but not a single canonical bootstrap response.
- The CLI has no first-class `bootstrap` command even though docs already describe preferred bootstrap sequences.
- Canonical-tool guidance exists, but discovery still requires multi-step synthesis by the client.
- SDK generation and benchmark/trust surfaces would benefit from a single digest-bearing bootstrap payload.

# Proposed Solutions
## Option 1: Keep capabilities/schema/tools split only
- Pros: no new surface.
- Cons: keeps agent planning burden high; not A+.

## Option 2: Add a first-class bootstrap surface generated from current contract/capability state
- Pros: single safe entrypoint for agents, can hide compatibility aliases by default, can summarize policy/profile readiness and trust state.
- Cons: needs careful parity work across CLI, remote HTTP, schema, SDK, docs, and tests.

# Recommended Action
Implement `bootstrap` as the canonical first call for new agents and wire it across local CLI, remote HTTP, schema/SDK generation, docs, and tests.

# Acceptance Criteria
- [x] `pandora --output json bootstrap` exists and returns a typed envelope.
- [x] Remote HTTP exposes authenticated `GET /bootstrap`.
- [x] Bootstrap hides compatibility aliases by default and only exposes them when explicitly requested.
- [x] Bootstrap includes principal/scope, canonical tools, recommended next calls, policy/profile readiness, doc/trust summaries, and contract digest references.
- [x] SDK/generated contract artifacts expose bootstrap consistently.
- [x] Benchmarks/docs/tests treat bootstrap as the preferred first call.

# Work Log
### 2026-03-08 - Todo created
**By:** Codex

**Actions:**
- Scoped the A+ Phase 1 work around a single bootstrap contract spanning CLI, HTTP, docs, and generated artifacts.
- Chose a fresh todo range starting at 083 to avoid conflicting with an older phase numbering already present in `todos/`.

**Learnings:**
- The platform already has the required source data; the missing piece is a canonical aggregation surface.

### 2026-03-08 - Phase completed
**By:** Codex

**Actions:**
- Added the canonical `bootstrap` command and integrated it into CLI routing, remote HTTP bootstrap summaries, schema definitions, SDK contract generation, and docs.
- Fixed the two concrete integration bugs found during verification: a duplicate `bootstrap` registry descriptor and an incorrect `pandora.cjs` bootstrap adapter call shape.
- Verified local CLI output, remote MCP bootstrap parity, docs drift checks, and SDK contract freshness.

**Verification:**
- `node --test tests/unit/bootstrap_command_service.test.cjs tests/unit/agent_contract_registry.test.cjs tests/cli/mcp.integration.test.cjs`
- `npm run check:docs`
- `npm run generate:sdk-contracts`
- `npm run check:sdk-contracts`
