---
status: ready
priority: p1
issue_id: "050"
tags: [agent-platform, phase8, sbom, security]
dependencies: ["048"]
---

# Phase 8 SBOM, Attestation, and Security Model

## Problem Statement

Enterprise adopters and serious agent operators will expect explicit supply-chain and security posture artifacts.

## Findings

- The release process can support trust artifacts, but the posture is not fully documented yet.
- SBOM and attestation work need a matching security model to be useful to operators.

## Proposed Solutions

- Add native SBOM generation and release-gate checks.
- Publish a repo-specific security model tied to the actual runtime and release controls.

## Recommended Action

Generate an SBOM, add build provenance/attestation, and publish a clear security model for local CLI, MCP, remote gateway, SDKs, and hosted modes.

Concrete tasks:
- add a native SBOM generation script and release artifact
- add trust checks so release prep fails when SBOM/attestation surface regresses
- write a repo-specific security model document covering trust boundaries and guarantees

## Acceptance Criteria

- [ ] SBOM generation path exists
- [ ] Build provenance/attestation path exists or is stubbed with clear release workflow
- [ ] Security model doc covers auth, secrets, transport, and trust boundaries

## Work Log

### 2026-03-08 - Phase 8 SBOM/Security Todo Created

**By:** Codex

**Actions:**
- Added the SBOM/attestation/security-model workstream

### 2026-03-08 - SBOM and Security Lane Started

**By:** Codex

**Actions:**
- Split SBOM automation and security-model writing into separate implementation lanes
- Scoped the deliverables to generated artifacts, release workflow parity, and repo-specific trust guarantees

**Learnings:**
- A security model is only credible if it matches the actual release and runtime controls in the repo.
