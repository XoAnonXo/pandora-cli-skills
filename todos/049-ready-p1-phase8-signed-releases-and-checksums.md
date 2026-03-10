---
status: ready
priority: p1
issue_id: "049"
tags: [agent-platform, phase8, releases, provenance]
dependencies: ["048"]
---

# Phase 8 Signed Releases and Checksums

## Problem Statement

Consumers need a clear way to verify that shipped Pandora artifacts are authentic and untampered.

## Findings

- Checksums alone do not establish provenance.
- Verification steps need to match the actual release and install workflow to be credible.

## Proposed Solutions

- Pair checksums with signed-release provenance and verification guidance.
- Keep the install workflow aligned with the published verification flow.

## Recommended Action

Add signed-release workflow, published checksums, and verification documentation for npm/package artifacts.

Concrete tasks:
- keep keyless cosign signing as a required release step
- add GitHub provenance attestations for the published tarball
- publish checksum assets and verification guidance together
- ensure the local release-install script can verify the shipped assets cleanly

## Acceptance Criteria

- [ ] Release artifacts include checksums
- [ ] Signing workflow is documented and automated where feasible
- [ ] Verification steps are documented for consumers

## Work Log

### 2026-03-08 - Phase 8 Signing Todo Created

**By:** Codex

**Actions:**
- Added the signing/checksum workstream

### 2026-03-08 - Signing Lane Started

**By:** Codex

**Actions:**
- Assigned the release workflow and installer verification lane to a dedicated agent
- Scoped the lane to workflow provenance, checksum assets, and consumer verification steps

**Learnings:**
- Checksums without provenance are not enough for external agent operators.
