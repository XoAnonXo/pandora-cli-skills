---
status: complete
priority: p1
issue_id: "119"
tags: [mirror, polymarket, websocket, rpc, resilience]
dependencies: []
---

# Add real-time Polymarket feed and RPC fallbacks

## Problem Statement

Mirror execution still relies too heavily on polling and fragile single-RPC assumptions. Fast sports markets need real-time Polymarket price updates and resilient chain connectivity.

## Findings

- Postmortem used 45-second Gamma polling, which is too slow for live sports odds.
- Operator also hit Polygon RPC outages and had to hunt for working endpoints manually.
- Existing stream infrastructure already supports websocket patterns elsewhere in the CLI.

## Proposed Solutions

### Option 1: Add WebSocket-first Polymarket feed with REST fallback and chain RPC fallback lists

**Approach:** Use WebSocket/streaming for live odds when available, fall back to REST polling, and add ordered RPC fallback chains for Polygon and other relevant networks.

**Pros:**
- Improves reaction time and operational resilience
- Fits agentic execution better than manual endpoint juggling

**Cons:**
- More moving pieces than simple polling

**Effort:** 4-7 hours

**Risk:** Medium

### Option 2: Only shorten REST polling interval and add RPC fallbacks

**Approach:** Keep polling but make it more frequent.

**Pros:**
- Lower implementation cost

**Cons:**
- Still inferior for volatile live markets

**Effort:** 2-3 hours

**Risk:** Medium

## Recommended Action

Implement Option 1. WebSocket-first with explicit fallback is the right long-term agent/operator posture.

## Acceptance Criteria

- [x] Mirror sync can subscribe to a real-time Polymarket update source for live markets
- [x] Sync degrades gracefully to polling if the live feed is unavailable
- [x] Polygon/Polymarket-side chain connectivity supports ordered fallback RPC URLs
- [x] Diagnostics clearly show which price feed and which RPC endpoint are active
- [x] Tests cover feed fallback and RPC fallback behavior

## Work Log

### 2026-03-09 - Todo creation

**By:** Codex

**Actions:**
- Converted live-feed and RPC resilience gaps into one tracked runtime-reliability item

**Learnings:**
- This is both latency and operator-time reduction work

### 2026-03-09 - Batch 1 implemented and verified

**By:** Codex

**Actions:**
- wired live verify/sync paths to prefer realtime Polymarket market fetches
- enforced fresh-source gating for live sports sync and annotated fallback direct-resolution freshness explicitly
- added comma-delimited Polygon fallback RPC handling for mirror go/sync and Polymarket preflight

**Verification:**
- focused unit and CLI suite runs passed
- tests cover stale poll blocking, websocket freshness metadata, and RPC fallback normalization

**Learnings:**
- live-mode freshness needs explicit metadata even on direct-resolution fallback paths; otherwise the gate cannot make a safe decision
