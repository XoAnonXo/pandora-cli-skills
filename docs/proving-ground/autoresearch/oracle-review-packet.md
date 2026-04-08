# Oracle Review Packet: Overnight Research Module

Use this packet to ask Oracle for a hard review of the overnight research system.

This is not a request to review one code change.
This is a request to review the architecture, workflow, and portability of the whole system.

What we need to have is a brutally honest design review `(architecture review + failure-mode review + portability review)` so we can turn this from a Pandora-specific loop into a reusable overnight improvement system for other repos.

---

## 1. What This Project Is

Pandora is a large CLI codebase.

Inside it, we built an overnight research lane that:

- uses MiniMax to propose repo improvements
- gives each worker one isolated worktree
- limits each worker to one attempt
- runs a six-role automated council review before code is applied
- validates the result with lane tests and full repo tests
- writes handoffs and receipts for every attempt
- promotes accepted lane commits into one integration branch
- still uses a separate morning human/Codex review before final publish

The detailed draft is in:

- `docs/proving-ground/autoresearch/overnight-research-module.md`

That file is the main context document.

---

## 2. What We Want From Oracle

Please review this system as if you are deciding whether it is strong enough to become:

- a reusable overnight code-improvement engine
- a reusable repo adapter pattern
- a reusable Codex skill or skill + code package for other repos

We do **not** want surface praise.

We want:

1. the strongest architectural objections
2. the most important missing abstractions
3. the biggest hidden failure modes
4. the cleanest path to productize this for non-Pandora repos

---

## 3. Main Review Questions

Please answer these directly.

### A. Is the current loop architecture correct?

Current shape:

- lane-based
- one worker per attempt
- one worktree per lane
- one handoff per attempt
- automated six-role council before code application
- integration branch fan-in
- final validation

Question:

- is this the right core shape
- or is there a better orchestration model we should switch to now before going further

### B. Is the built-in council strong enough?

Current truth:

- the proposal worker uses MiniMax
- the in-loop council also uses MiniMax-based review calls
- later, a separate morning review can happen with Codex/humans/Oracle

Question:

- is an in-loop same-provider council acceptable
- or should the built-in council become something else

Examples:

- deterministic lint/rule engine plus one external model
- heterogeneous model reviewers
- model-free structural checks before any model review

### C. Is the repo adapter boundary clean enough?

Current truth:

- Pandora has repo-specific lane config in `proving-ground/config/cli_section_research.cjs`
- the engine logic is in `proving-ground/lib/*.cjs`

Question:

- is the split between “engine” and “repo adapter” already good enough
- if not, what exact boundary should we create

### D. What parts are still too Pandora-specific?

Question:

- which assumptions in the current design would break quickly in another repo
- what needs to become generic before this is reusable

### E. Is the worker contract too strict or not strict enough?

Current truth:

- one worker gets one try
- one model call
- one proposal
- one handoff

Question:

- should this stay fixed
- or should the system allow a tightly bounded repair turn

### F. Is the change-set model too weak?

Current truth:

- structured text edits only
- `replace_once`, `insert_after_once`, `insert_before_once`

Question:

- is this the right portability trade-off
- or should future versions become AST-aware or language-aware

### G. How much of the morning review should be brought into the system?

Current truth:

- overnight system has an in-loop automated council
- morning review and selective cherry-pick/publish are still manual

Question:

- should the engine stop at “ready for morning review”
- or should more of that publish funnel become code

### H. What is the right product shape?

Question:

- standalone engine package
- engine + repo adapter schema
- Codex skill that scaffolds adapters
- full plugin
- some combination of the above

Please recommend one, not three.

---

## 4. What To Attack Hard

Please be adversarial about:

- stale-context risks
- duplicate-review illusions
- worktree safety
- hidden merge-conflict costs
- proposal-format fragility
- false positives in “kept” changes
- weak portability assumptions
- operator burden in the morning workflow
- what would fail at 10 repos, not 1 repo

What we need to have is a machine that scales across repos `(multi-repo overnight improvement platform)`, not just something clever that happened to work inside Pandora once.

---

## 5. What Kind Of Answer We Want Back

Please answer in this shape:

1. **Overall verdict**
   - Is the architecture directionally correct or not?

2. **Top 5 architectural risks**
   - Ordered by severity

3. **Top 5 missing abstractions**
   - What we should extract or redesign before portability work

4. **What should remain manual**
   - Which parts should stay human-controlled

5. **What should become code next**
   - Specific next implementation steps

6. **Recommended target architecture**
   - One proposed final shape

7. **Migration plan**
   - How to move from current Pandora state to reusable system state

8. **Failure mode audit**
   - One alternative design
   - One likely failure mode in the current design

Be opinionated.
Do not smooth over trade-offs.

---

## 6. Files To Review

Start with the big design document:

- `docs/proving-ground/autoresearch/overnight-research-module.md`

Then verify against the real implementation:

- `proving-ground/config/cli_section_research.cjs`
- `proving-ground/lib/cli_baton_autoresearch.cjs`
- `proving-ground/lib/cli_section_autoresearch.cjs`
- `proving-ground/lib/baton_council.cjs`
- `proving-ground/lib/baton_manifest.cjs`
- `proving-ground/lib/baton_worktree_manager.cjs`
- `proving-ground/lib/minimax_client.cjs`
- `scripts/run_cli_baton_autoresearch.cjs`
- `tests/unit/cli_baton_autoresearch.test.cjs`
- `tests/unit/baton_council.test.cjs`
- `tests/unit/baton_manifest.test.cjs`

Optional evidence files if you want to inspect real receipts:

- `proving-ground/reports/baton/cli-baton-2026-04-06T18-26-17-980Z/manifest.json`
- `proving-ground/reports/baton/cli-baton-2026-04-06T18-26-17-980Z/lanes/lane-02/attempts/attempt-0001/handoff.md`
- `proving-ground/reports/baton/cli-baton-2026-04-06T18-26-17-980Z/lanes/lane-02/attempts/attempt-0001/council.json`
- `proving-ground/reports/baton/cli-baton-2026-04-06T18-26-17-980Z/lanes/lane-07/attempts/attempt-0002/handoff.md`

---

## 7. Constraints And Non-Goals

Constraints:

- we want this to run overnight
- we want isolated worktrees
- we want machine-written receipts
- we want proposals gated before code application
- we want final publish to remain very high-confidence

Non-goals:

- fully autonomous publish with no human review
- giant multi-file rewrites by default
- model-specific logic spread through the codebase
- Pandora-only behavior baked into the reusable engine

---

## 8. Important Current Truth

Please evaluate the design against these truths:

- The current system already works in Pandora.
- It already runs MiniMax.
- It already creates ten worktrees.
- It already has one-attempt workers.
- It already has a six-role in-loop review council.
- It already writes manifests, reports, and handoffs.
- It already supports promotion into an integration branch.
- It already has synthetic system tests.
- But the final morning audit and selective publish are still manual.

That last point is intentional for now.

---

## 9. Exact Ask

Please review this as a serious engineering system proposal and answer:

**If we wanted to reuse this in other repos, what would you keep, what would you redesign, and what would you productize first?**

---

## 10. Suggested Oracle Command

If you want to run Oracle directly with the right context, use a command like this from repo root:

```bash
oracle --engine browser --model gpt-5.2-pro --slug "overnight-loop-review" \
  -p "$(cat docs/proving-ground/autoresearch/oracle-review-packet.md)" \
  --file "docs/proving-ground/autoresearch/overnight-research-module.md" \
  --file "proving-ground/config/cli_section_research.cjs" \
  --file "proving-ground/lib/cli_baton_autoresearch.cjs" \
  --file "proving-ground/lib/cli_section_autoresearch.cjs" \
  --file "proving-ground/lib/baton_council.cjs" \
  --file "proving-ground/lib/baton_manifest.cjs" \
  --file "proving-ground/lib/baton_worktree_manager.cjs" \
  --file "proving-ground/lib/minimax_client.cjs" \
  --file "scripts/run_cli_baton_autoresearch.cjs" \
  --file "tests/unit/cli_baton_autoresearch.test.cjs" \
  --file "tests/unit/baton_council.test.cjs" \
  --file "tests/unit/baton_manifest.test.cjs"
```

If Oracle needs less context, the first file to keep and the first file to cut are:

- keep: `docs/proving-ground/overnight-research-module.md`
- cut first: receipt examples under `proving-ground/reports/...`

---

## 11. Final Note To Oracle

Assume the authors are willing to change the architecture if needed.

Do not optimize for politeness.
Optimize for making this system robust enough to become a reusable overnight research module.
