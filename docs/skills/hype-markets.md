# Hype Markets

## Goal

Use the hype-market flow when an agent needs to turn fresh public-web trend research into a deployable Pandora market quickly without drifting between research, validation, and execution.

## Canonical commands

```bash
pandora --output json agent market hype --area sports --region "United States" --query "NBA injuries" --candidate-count 3
pandora --output json markets hype plan --area sports --candidate-count 3 --ai-provider openai
pandora --output json markets hype plan --area regional-news --region "Dubai" --query "transport authority" --candidate-count 2 --ai-provider openai
pandora --output json markets hype run --plan-file ./hype-plan.json --candidate-id <candidate-id> --market-type selected --dry-run
```

## Areas

- `sports`
- `esports`
- `politics`
- `regional-news`
- `breaking-news`

## Required workflow

1. Use `agent market hype` when the external agent itself is responsible for research.
2. Use `markets hype plan` when Pandora should run the bounded provider-backed research and freeze the result into a reusable plan payload.
3. Review:
   - `selectedCandidate`
   - `duplicateRiskScore`
   - `duplicateMatches`
   - `validation.validationResult`
   - `recommendedMarketType`
4. Run `markets hype run --dry-run` against the saved plan file.
5. Only use execute mode after confirming the selected candidate is still `readyToDeploy` and matches the frozen plan and validation state.

## Why the plan file matters

- Live trend research is time-sensitive and can drift between calls.
- `markets hype plan` freezes:
  - the research summary
  - the search queries
  - the sources
  - the candidate drafts
  - the market recommendation
  - the validation result
- `markets hype run` is intentionally plan-file based so deployment does not silently mutate after validation.

## AMM vs pari-mutuel recommendation

- Prefer `amm` when:
  - the market should reprice actively as new information arrives
  - the event has a longer live trading window
  - the estimated probability is likely to move materially before close
- Prefer `parimutuel` when:
  - the event is short-window and socially hyped
  - pooled participation matters more than continuous price discovery
  - traders are likely to pile into a headline event close to resolution
- Treat `99.9/0.1` as a parimutuel-style opening signal:
  - it means you want an almost one-sided YES/NO pool at launch
  - users cannot trade out of that skew later the way they can with an AMM
  - if the user actually wants active repricing, use `amm` instead of encoding conviction as an extreme pool split

## Agent rules

- Use public, citable web sources only.
- Prefer official or primary reporting when available.
- Require at least two sources per candidate.
- When using `regional-news`, treat `--region` as mandatory and keep the topic tied to that locality.
- Reject vague, subjective, or weakly resolvable topics.
- Treat high `duplicateRiskScore` as a deployment warning.
- Do not reword question, rules, sources, or target timestamp after planning. Regenerate the plan instead.

## Provider modes

- `--ai-provider auto`
  - use configured provider automatically
- `--ai-provider openai`
  - use OpenAI web-search-backed planning
- `--ai-provider anthropic`
  - use Anthropic web-search-backed planning
- `--ai-provider mock`
  - deterministic test mode
- if no provider is configured for `auto`
  - `markets hype plan` fails fast
  - use `agent market hype` for prompt-only research instead

## Execution notes

- `markets hype run --dry-run` is the safe preview path.
- Execute mode should use the selected candidate from the frozen plan payload.
- Execute mode rejects candidates that are not marked `readyToDeploy`.
- In MCP mode, pass the selected candidate PASS validation attestation back as `agentPreflight`.

## Related docs

- `docs/skills/agent-quickstart.md`
- `docs/skills/capabilities.md`
- `docs/skills/command-reference.md`
