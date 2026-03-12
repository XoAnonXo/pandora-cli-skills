# Anthropic Skill Evaluation

This document defines the lightweight evaluation loop for the Anthropic-facing Pandora skill bundle.

The goal is not to overbuild a separate benchmark framework. The goal is to make skill regressions visible in four areas that Anthropic's guide emphasizes:

1. trigger precision
2. non-trigger discipline
3. functional usefulness on real Pandora tasks
4. baseline improvement versus running without the skill

## Artifacts

The evaluation fixtures live under [`tests/skills`](../../tests/skills):

- [`trigger-fixtures.json`](../../tests/skills/trigger-fixtures.json)
- [`functional-scenarios.json`](../../tests/skills/functional-scenarios.json)
- [`manual-eval-template.md`](../../tests/skills/manual-eval-template.md)

Use these artifacts against the generated Anthropic skill bundle, not the repo root.

## Evaluation Flow

### 1. Validate the bundle first

Run the Anthropic skill bundle build/check flow first. Do not run the prompt suite against an ad hoc folder layout.

```bash
npm run pack:anthropic-skill
npm run check:anthropic-skill
```

Minimum expectations before prompt testing:

- the bundle contains the Anthropic-facing `SKILL.md`
- bundled `references/` resolve correctly inside the bundle
- repo-only files such as root README files are not part of the uploadable skill folder

### 2. Run the trigger suite

Use the prompts in [`trigger-fixtures.json`](../../tests/skills/trigger-fixtures.json) and record results in [`manual-eval-template.md`](../../tests/skills/manual-eval-template.md).

The suite is split into three groups:

- **Should trigger**
  - obvious Pandora requests that should clearly load the skill
- **Paraphrase should trigger**
  - natural rephrasings that test robustness
- **Should not trigger**
  - unrelated requests that should leave the Pandora skill inactive

### 3. Run the functional scenarios

Use [`functional-scenarios.json`](../../tests/skills/functional-scenarios.json) to verify the skill does the right thing after it triggers.

Each scenario tests:

- whether the first move is correct
- whether safety guidance appears without extra prompting
- whether the skill routes to the right Pandora surfaces
- whether the skill avoids specific bad behaviors

The current functional coverage is intentionally focused on Pandora's highest-value workflows:

- safe bootstrap
- quote before mutation
- mirror planning and preflight
- profile go/no-go inspection
- MCP transport selection
- portfolio closeout

### Automated Claude Code runtime sweep

For a real installed-skill runtime check, use the built-in Claude Code adapter:

```bash
npm run e2e:skill-runtime
```

What this does:

- builds and validates the generated Anthropic skill bundle
- loads `dist/pandora-skill/` into the local `claude` CLI with `--plugin-dir`
- runs the trigger and functional scenario fixtures through a real Claude runtime
- writes the full report to `output/e2e/skill-runtime-report.json`

Optional:

- set `PANDORA_SKILL_EXECUTOR_MODEL=sonnet` to force a cheaper model for the runtime sweep
- override `PANDORA_CLAUDE_BIN` if the `claude` executable is not on the default `PATH`
- pass `--skill-timeout-ms <ms>` or set `PANDORA_SKILL_EXECUTOR_TIMEOUT_MS` to cap each scenario runtime
- pass `--skill-executor "<command>"` if you want to replace the bundled Claude adapter with another sub-agent executor

### 4. Run at least one baseline comparison

For one or two representative tasks, compare “with skill” versus “without skill”.

The baseline comparison does not need perfect numeric rigor. Track the same practical signals Anthropic recommends:

- how many turns it took to reach the correct first move
- whether safety guidance appeared automatically
- whether the response introduced unnecessary mutation or secrets
- whether the canonical Pandora surfaces were used

## Pass Guidance

These are release heuristics, not hard science:

- obvious trigger cases should pass consistently
- paraphrase cases should mostly pass without explicit skill naming
- non-trigger cases should stay quiet
- functional scenarios should preserve Pandora safety invariants

Any regression in these areas should block a skill release even if core CLI tests are still green.

## What This Does Not Replace

This evaluation layer does not replace:

- CLI/unit/integration tests in [`tests`](../../tests)
- internal docs routing checks
- release trust or SDK parity checks

Those validate the Pandora product. This document validates the Anthropic-facing skill behavior.

## Release Checklist

Before shipping the Anthropic skill bundle:

- confirm the bundle is structurally valid
- run the trigger suite
- run the functional scenarios
- record outcomes in the manual template
- compare at least one task with and without the skill
- fix any trigger drift or routing regressions before release
