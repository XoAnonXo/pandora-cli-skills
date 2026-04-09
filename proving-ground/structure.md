# Proving Ground Structure

```text
proving-ground/
  README.md
  structure.md
  autoresearch/
    config/
    lib/
    scripts/
  config/
    proving-ground.example.json
    world-lock.example.json
    cli_section_research.cjs
  lib/
    baton_common.cjs
    baton_council.cjs
    baton_manifest.cjs
    baton_worktree_manager.cjs
    cli_baton_autoresearch.cjs
    cli_section_autoresearch.cjs
    scenario_family_loader.cjs
  scenarios/
    daemon-in-loop/
      family.json
  reports/
    baton/
      <batch-id>/
        manifest.json
        events.ndjson
        lanes/
          lane-01/
            status.json
            history.ndjson
            latest.json
            attempts/
              attempt-0001/
                status.json
                events.ndjson
                metrics.json
                council.json
                handoff.json
                handoff.md
                report.json
```

## Intent

- `config/` keeps the experiment world reproducible
- `lib/` keeps loading, baton control, council review, and validation logic in one place
- `scenarios/` keeps scenario families deterministic and reviewable
- `reports/baton/` keeps one full receipt trail for every CLI improvement batch
