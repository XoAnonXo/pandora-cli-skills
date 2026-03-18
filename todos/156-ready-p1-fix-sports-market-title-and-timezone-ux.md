---
status: ready
priority: p1
issue_id: "156"
tags: [mirror, sports, ux, titles, rules, timezone, market-creation]
dependencies: []
---

# Fix sports market title and timezone UX in mirror flows

The sports market creation flow still makes users do avoidable semantic cleanup before going live. In the Jazz vs Kings example, the raw matchup headline was treated like a usable market title, which forced the operator to manually rewrite the question, then rework the rules, then double-check the event close time across UTC/GMT interpretations.

This is not just conversational friction. It is a product UX defect in market creation. For head-to-head sports markets, the generated question should already be bettor-readable, outcome-oriented, and time-grounded so a user can understand what `YES` and `NO` mean from the title alone.

## Problem Statement

Current mirror planning / launch guidance is too close to source-market labels and not opinionated enough about bettor semantics.

For a headline like:

- `Jazz vs Kings`

the system should not default to a title that leaves the outcome ambiguous.

It should instead generate something like:

- `Will Utah Jazz beat Sacramento Kings on 2026-03-15?`

That title makes the market orientation explicit:

- `YES = Utah Jazz wins`
- `NO = Utah Jazz does not win`

Without that, the user has to:

1. rewrite the title manually
2. rewrite the rules so they match the rewritten title
3. re-check event timing and market close time because time labels are still easy to misread

The timezone problem is part of the same UX bug. The flow should present one normalized authoritative event/close time with clear timezone labeling and ask for confirmation, instead of making the user reconcile local time, UTC, GMT, and market close behavior by hand.

## Findings

### User-facing failures to fix

1. Sports matchup headlines are not sufficient as final market questions.
   - A raw matchup like `Jazz vs Kings` does not tell a bettor what `YES` or `NO` mean.
   - The market question must be phrased as a resolvable yes/no claim.

2. Rules drift when the title is rewritten.
   - Once the user changes the title from a matchup label to a yes/no question, the rules often need manual rephrasing to stay semantically aligned.
   - That should be generated consistently from the same structured event orientation.

3. Timezone handling is too fragile.
   - Users should not need to manually verify UTC vs GMT vs local event time after editing the title/rules.
   - The flow should derive and display one authoritative event start and market close view, with timezone conversion shown clearly.

### Desired product behavior

For sports head-to-head markets, the agent / CLI should:

1. infer a bettor-readable yes/no question by default
2. explicitly map outcome semantics:
   - `YES = team A wins`
   - `NO = team A does not win`
3. generate rules from the same orientation so title and rules cannot drift
4. show normalized time confirmation before deploy:
   - event time in source timezone if known
   - event time in UTC
   - chosen market close time in UTC
   - optionally the operator-local timezone if available

## Recommended Action

Update the sports mirror planning and deploy path so the default flow is structured around:

1. source event
2. selected favored/question-side team
3. generated bettor-readable question
4. generated aligned rules
5. explicit outcome semantics
6. normalized time confirmation

The worker should treat this as a mirror planning UX improvement across agent prompts, CLI output, and docs, not just as a docs patch.

## Proposed Solutions

### Option 1: Improve prompt/output copy only

- rewrite docs and agent guidance to tell users to convert `Team A vs Team B` into a yes/no question manually

Pros:

- low effort

Cons:

- still leaves the product generating ambiguous titles
- still makes the user fix rules/time by hand

### Option 2: Generate structured sports questions and time confirmation in plan/deploy flows

- detect head-to-head sports markets
- convert raw matchup labels into bettor-readable yes/no questions
- bind rules generation to that orientation
- show explicit `YES` / `NO` meaning
- show one normalized time confirmation block before deploy

Pros:

- fixes the actual user experience
- reduces title/rules/time drift
- improves safety for live deployment

Cons:

- touches planning, copy, and possibly schema/output surfaces

### Option 3: Add an explicit sports question builder step

- `mirror plan` or agent flow enters a structured step:
  - choose team side
  - generate yes/no wording
  - confirm event time and close time

Pros:

- cleanest UX for users who want certainty

Cons:

- more interaction steps

## Recommended Approach

Take Option 2, optionally borrowing the confirmation UX from Option 3.

Specifically:

1. When the source event is a head-to-head sports matchup, never present the raw matchup label as the final market question.
2. Generate a default question in the form:
   - `Will <Team A> beat <Team B> on <YYYY-MM-DD>?`
3. Generate rules from that same orientation so `YES` and `NO` remain unambiguous.
4. Add an explicit summary block before deploy:
   - `Question`
   - `YES means`
   - `NO means`
   - `Event start`
   - `Market close`
   - `Timezone basis`

## Technical Areas

Likely files:

- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_handlers/plan.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_handlers/deploy.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_handlers/go.cjs`
- `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_sync/planning.cjs`
- sports/mirror prompt or summary helpers used by the agent-facing surfaces
- docs covering sports mirror planning and deployment

The exact write scope may differ depending on where question/rules/timestamp normalization currently live.

## Acceptance Criteria

- [ ] A sports matchup headline like `Jazz vs Kings` is not used as the final default market question
- [ ] The default generated question is bettor-readable and makes `YES` / `NO` semantics obvious from the title alone
- [ ] Generated rules stay aligned with the generated question without manual rephrasing
- [ ] The flow explicitly shows `YES means ...` and `NO means ...` before deployment
- [ ] The flow presents one normalized event/close-time confirmation with clear timezone labeling
- [ ] Docs/examples for sports mirror flows use bettor-readable question wording, not raw matchup headlines
- [ ] Focused tests cover default sports question generation and timezone confirmation output

## Verification

- run the relevant unit tests for sports/mirror planning output
- run CLI/help or plan/deploy integration tests that assert:
  - question wording
  - outcome semantics summary
  - normalized timezone output
- test with a real sports slug or fixture equivalent for a head-to-head game

## Resources

- `/Users/mac/Desktop/post-mortem_new.md`
- sports mirror docs and examples in this repo

## Notes

- This issue is about bettor comprehension first, not just operator convenience.
- The correct product standard is: a bettor should understand what `YES` means from the question alone, without reading custom rules.

## Work Log

### 2026-03-16 - Sports title/timezone UX review and todo creation

**By:** Codex

**Actions:**

- reviewed `/Users/mac/Desktop/post-mortem_new.md`
- extracted the core UX complaint from the setup flow:
  - raw matchup titles are ambiguous
  - rules had to be manually rewritten
  - timezone handling required manual double-checking
- converted that feedback into a worker-facing implementation brief

**Learnings:**

- the main failure is in market-creation semantics, not just operator procedure
- the title, rules, and time confirmation need to come from one consistent structured event model
