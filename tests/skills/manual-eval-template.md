# Anthropic Skill Manual Eval Template

Use this template when running the Pandora Anthropic skill evaluation suite in Claude.ai, Claude Code, or via an API workflow that supports skills.

## Session Metadata

- **Date:**
- **Evaluator:**
- **Skill bundle revision:**
- **Model:**
- **Surface:** Claude.ai / Claude Code / API
- **Notes:**

## Trigger Suite

| Fixture ID | Expected | Actual | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| bootstrap-agent-runtime | Should trigger |  |  |  |
| quote-before-buy | Should trigger |  |  |  |
| mirror-plan | Should trigger |  |  |  |
| profile-readiness | Should trigger |  |  |  |
| start-mcp | Should trigger |  |  |  |
| what-first | Paraphrase trigger |  |  |  |
| mirror-preflight | Paraphrase trigger |  |  |  |
| agent-transport | Paraphrase trigger |  |  |  |
| closeout-help | Paraphrase trigger |  |  |  |
| generic-react-help | Should not trigger |  |  |  |
| generic-crypto-news | Should not trigger |  |  |  |
| spreadsheet-task | Should not trigger |  |  |  |
| pdf-summary | Should not trigger |  |  |  |
| weather | Should not trigger |  |  |  |

## Functional Scenarios

| Scenario ID | Correct first move? | Safety preserved? | Useful references surfaced? | Pass/Fail | Notes |
| --- | --- | --- | --- | --- | --- |
| safe-bootstrap |  |  |  |  |  |
| quote-workflow |  |  |  |  |  |
| mirror-preflight |  |  |  |  |  |
| profile-go-no-go |  |  |  |  |  |
| mcp-transport-choice |  |  |  |  |  |
| portfolio-closeout |  |  |  |  |  |

## Baseline Comparison

Run at least one representative task with the skill enabled and disabled.

| Task | With skill | Without skill | Delta | Notes |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |
|  |  |  |  |  |

Suggested dimensions:

- number of user turns before the agent chooses the correct first move
- whether safety guidance appears without follow-up prompting
- whether the response introduces unnecessary mutation or secret-handling steps
- whether the routed docs/commands are the canonical Pandora surfaces

## Release Recommendation

- **Ready to ship:** Yes / No
- **Blocking regressions:**
- **Follow-up improvements:**
