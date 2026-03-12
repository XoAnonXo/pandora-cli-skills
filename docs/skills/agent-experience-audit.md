# Agent Experience Audit

This document reviews 10 realistic external-agent use cases and notes how the current Pandora experience can be improved.

The goal is not to restate the command reference. The goal is to describe what an agent-first user journey feels like today and what the next improvements should be.

## Evidence used

Live evidence:
- fresh journey run: [`output/e2e/user-journeys/agent-audit-all.json`](../../output/e2e/user-journeys/agent-audit-all.json)
- deployer journey: [`output/e2e/user-journeys/deployer.json`](../../output/e2e/user-journeys/deployer.json)
- MCP parimutuel journey: [`output/e2e/user-journeys/mcp-parimutuel.json`](../../output/e2e/user-journeys/mcp-parimutuel.json)
- skill-runtime subset: [`output/e2e/skill-runtime-agent-audit.json`](../../output/e2e/skill-runtime-agent-audit.json)

Contract and doc review:
- [`agent-quickstart.md`](./agent-quickstart.md)
- [`capabilities.md`](./capabilities.md)
- [`hype-markets.md`](./hype-markets.md)
- [`trading-workflows.md`](./trading-workflows.md)
- [`mirror-operations.md`](./mirror-operations.md)
- [`portfolio-closeout.md`](./portfolio-closeout.md)
- [`install-anthropic-skill.md`](./install-anthropic-skill.md)
- [`anthropic-skill-evals.md`](./anthropic-skill-evals.md)
- [`../../sdk/typescript/README.md`](../../sdk/typescript/README.md)
- [`../../sdk/python/README.md`](../../sdk/python/README.md)
- [`../trust/support-matrix.md`](../trust/support-matrix.md)

## Summary

| Scenario | Current state | Evidence level |
| --- | --- | --- |
| Skill-installed newcomer who does not understand market types | Workable, but education is still too distributed | live + docs |
| MCP-connected user who wants Pandora to suggest markets | Workable, but no-key and mock guidance still need polish | live |
| Fresh deployer who only knows the desired probability split | Strong planning support, moderate teaching support | live |
| Read-only research agent with no wallet or secrets | Strong | live |
| Agent-driven trader who wants safe execution gating | Strong core flow, one recommendation bug remains | live |
| Agent-managed market closeout and claims operator | Strong for empty-state onboarding, still needs richer non-empty examples | live + docs |
| Agent-managed Polymarket mirror operator | Workable, but onboarding still asks too much too late | live |
| Sports operator using an agent as the workflow shell | Blocked without provider setup | live |
| Risk and watchdesk agent | Strong | live |
| Builder integrating Pandora into their own agent product | Workable but still alpha-shaped | live + docs |

## 1. Skill-installed newcomer who does not understand market types

**User story:** The user installs the Pandora skill in Claude/Claude Code and asks what kind of market they should launch.

**Current state:** Workable, but the teaching layer is still too distributed across the skill, hype docs, and trading docs.

**What already works:**
- the skill pushes the agent to start with `bootstrap`, `capabilities`, and `schema`
- the skill explicitly says not to start with secrets
- the `safe-bootstrap` skill-runtime scenario passed and used the exact Pandora bootstrap trio in a live agent run
- the adjacent MCP parimutuel journey shows that Pandora can already explain, at least minimally, that parimutuel is pool-based

**What feels weak:**
- the first-run “AMM vs parimutuel” explanation is still not a single canonical teaching moment
- the user has to infer too much from separate documents
- the current explanation is enough to continue, but not enough to feel well guided

**How to make it better:**
- add one canonical “choose AMM vs parimutuel” explanation block to the skill’s first deploy-routing answer
- include one concrete example for “I want 99.9/0.1” and one for “I want active repricing”
- add a dedicated skill eval prompt for “I don’t know what market type I need”
- add a short decision table to the skill install guide so the first-run prompts are more explicit

## 2. MCP-connected user who wants Pandora to suggest markets

**User story:** The user already has an agent connected through MCP and wants Pandora to suggest launchable market ideas.

**Current state:** Workable, but the real-user path and the test path still need clearer separation.

**What already works:**
- the fresh MCP parimutuel journey shows `markets.hype.plan` is framed correctly
- the output now clearly marks `mock` as deterministic test-only guidance
- the hype docs already say provider-backed `markets.hype.plan` is the real research path and `agent market hype` is fallback/orchestration mode

**What feels weak:**
- no-key flows still feel like internal tooling more than polished product behavior
- the mock path is operational, but it is not suggestion quality a user would trust
- if the provider is missing, the experience is still more “fallback contract” than “guided ideation”

**How to make it better:**
- treat provider-backed `markets.hype.plan` as the explicit default everywhere
- when no provider is configured, return a stronger remediation path instead of simply dropping into prompt fallback semantics
- add quality markers in the response, for example “test mode” versus “real provider-backed research”
- include one MCP-specific example in the docs: “suggest markets this week” -> `markets.hype.plan`

## 3. Fresh deployer who only knows the desired probability split

**User story:** The user says they want a `99.9/0.1` market but does not know how that maps to Pandora’s market types.

**Current state:** Strong for planning and normalization, moderate for teaching.

**What already works:**
- the MCP parimutuel journey proves the plan surface accepts an extreme `99.9/0.1` skew
- the deployer journey shows AMM and parimutuel creation paths stay isolated correctly
- validation and dry-run layers work before live execution

**What feels weak:**
- a cold user still needs more explicit explanation of what the skew means operationally
- the system normalizes the numbers correctly, but the user is not yet shown enough “human meaning” around the result

**How to make it better:**
- add a friendly explanation of what the normalized distribution means in the plan output
- show both the user’s original percentages and the normalized internal representation
- include a “why parimutuel here?” explanation whenever the system recommends it
- add one dedicated example in docs and skill prompts for extreme-skew market creation

## 4. Read-only research agent with no wallet and no secrets

**User story:** The user wants the agent to inspect Pandora safely without any signer setup.

**Current state:** Strong.

**What already works:**
- the `bootstrap-readonly-discovery` journey achieved its goal cleanly
- the quickstart and capabilities docs consistently push `bootstrap`, `capabilities`, `schema`, `policy list`, and `profile list`
- the hosted read-only gateway story is clear in the docs and support matrix

**What feels weak:**
- this path is good, but it could be more visible in top-level onboarding
- agents still need to know which read-only scope set to start with for hosted HTTP

**How to make it better:**
- add a single “researcher quickstart” snippet to the README and sharing docs
- expose the read-only principal template story more prominently in external setup docs
- include a minimal hosted read-only MCP example with exact scopes and expected first calls

## 5. Agent-driven trader who wants safe execution gating

**User story:** The user wants the agent to trade, but only after safe sequencing and policy/profile approval.

**Current state:** Strong core flow, with one important routing defect.

**What already works:**
- the `research-trader-dry-run` journey achieved the canonical read -> quote -> dry-run flow
- quote-first guidance is strong in the trading docs
- policy/profile inspection surfaces exist and are already part of the documented bootstrap contract

**What feels weak:**
- `policy.recommend` still recommends a live-trade pack that denies the actual trade path
- that breaks trust in the “tell me the safe next step” story

**How to make it better:**
- fix `policy.recommend` so the top recommendation is actually usable for the requested path
- make policy responses prefer the exact next safe tool when live trade is still denied
- add one explicit “safe trade sequence” recipe for agents: `quote -> policy recommend -> profile explain -> dry-run -> execute`

## 6. Agent-managed market closeout and claims operator

**User story:** The user wants the agent to inspect positions, see what can be claimed, and close out safely.

**Current state:** Strong for empty-state onboarding, still under-demonstrated for richer real portfolios.

**What already works:**
- the `portfolio-empty-wallet` journey achieved a clean empty-state flow
- the closeout docs strongly reinforce inspect-first and dry-run-first behavior
- the docs now explicitly tell the agent to name `portfolio`, `history`, and `claim` or `mirror close` before asking for a wallet follow-up

**What feels weak:**
- the live journey evidence is strongest for empty wallets, not mixed real portfolios
- there is still no single “closeout bundle” surface that summarizes what can be claimed, withdrawn, or closed next

**How to make it better:**
- add one non-empty closeout journey with claims plus LP exits plus mirror close
- add a compact “what is actionable now?” summary layer on top of the existing read surfaces
- give the skill one canned closeout prompt that always starts with the inspection-first order of operations

## 7. Agent-managed Polymarket mirror operator

**User story:** The user wants an agent to browse a Polymarket market, mirror it onto Pandora, and start in paper mode.

**Current state:** Workable, but onboarding still makes the user learn too much too late.

**What already works:**
- the `amm-mirror-zero-prereqs` journey shows a user can get to deploy planning and paper mirror mode with no wallet or third-party API keys
- the `mirror-sync-paper-existing-market` journey now completes cleanly in paper mode
- the mirror docs are explicit about validation, source requirements, timing, and live versus paper boundaries

**What feels weak:**
- deployment and mirror automation still point to different mutable profiles
- the need for two independent public resolution sources is still discovered late in the flow
- the onboarding story is correct, but not yet smooth

**How to make it better:**
- make the deploy-profile plus mirror-profile split explicit at the first recommendation step
- surface the resolution-source requirement before the user reaches `mirror go`
- where possible, prefill or suggest candidate public source slots instead of leaving the user to guess
- add a single “paper mirror onboarding” recipe for agents

## 8. Sports operator using an agent as the workflow shell

**User story:** The user wants the agent to discover sports events, choose one, and eventually create or sync a market.

**Current state:** Blocked without provider configuration.

**What already works:**
- `sports books list` exposes the missing-provider state cleanly
- the sports command families are clearly documented in the capabilities map

**What feels weak:**
- schedule, events, and scores still hard-fail once the user continues
- the experience becomes a configuration cliff instead of a guided preflight

**How to make it better:**
- route every no-provider sports onboarding path through `sports books list` automatically
- make schedule/events/scores return stronger remediation guidance instead of only a raw provider failure
- add one provider-setup quickstart for agent operators who are coming in specifically for sports workflows

## 9. Risk and watchdesk agent

**User story:** The user wants the agent to monitor risk, panic state, and market conditions before trading.

**Current state:** Strong.

**What already works:**
- the `watch-risk-observer` journey achieved cleanly
- `watch`, `risk show`, and `explain` all work without secrets
- the explain path gives a concrete next command instead of leaving the user with an opaque error code

**What feels weak:**
- this path is good, but not visible enough as a first-class onboarding persona

**How to make it better:**
- add a watchdesk/operator persona to the public docs next to deployer, researcher, and builder
- ship example alert workflows and recommended polling defaults for agents
- include a read-only remote token example specifically for monitoring agents

## 10. Builder integrating Pandora into their own agent product

**User story:** The user wants to integrate Pandora into another agent platform and needs to choose between MCP, SDK, and skill-guided workflows.

**Current state:** Workable, but still alpha-shaped and spread across several docs.

**What already works:**
- the quickstart clearly distinguishes local stdio MCP from hosted HTTP MCP
- the support matrix is honest about operator-hosted HTTP and alpha SDK status
- both SDK READMEs push agents to start with `bootstrap`
- both SDKs now present themselves as real external install paths, not only in-repo artifacts
- the `mcp-transport-choice` skill-runtime scenario passed and correctly recommended local stdio for same-host execution and hosted HTTP for scoped remote access

**What feels weak:**
- the builder story still requires reading several documents to understand the operating model
- the decision between MCP, SDK, and skill is clear once you know the system, but still a little fragmented for a newcomer
- the SDKs are still alpha, which is fine, but the practical guarantees need one tighter summary

**How to make it better:**
- add one top-level “MCP vs CLI vs SDK vs skill” decision guide for external builders
- add one end-to-end example per SDK that starts from `bootstrap` and makes a real tool call
- add a tiny compatibility page that says exactly what each integration surface guarantees today
- add one “self-custody local” and one “hosted read-only gateway” architecture diagram for builders

## Prioritized improvements

If the goal is to improve external agent experience fastest, the highest-value next changes are:

1. fix `policy.recommend` so trading recommendations are operationally correct
2. smooth mirror onboarding by surfacing profile split and resolution-source rules earlier
3. improve sports missing-provider remediation so the user hits a guided preflight instead of a cliff
4. make provider-backed `markets.hype.plan` the visibly default suggestion path everywhere
5. unify the market-type teaching layer for skill-installed and MCP-first newcomers

## Bottom line

Pandora is now strong at:
- read-only bootstrap
- quote-first trading
- profile and policy inspection
- monitoring and watchdesk workflows
- empty-state portfolio and audit behavior

Pandora still needs the most product polish around:
- mirror onboarding
- sports provider onboarding
- suggestion quality and no-provider hype routing
- first-run teaching for market-type choice
- the external builder decision story across MCP, SDK, and skill surfaces
