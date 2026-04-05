# Proving Ground Structure

```text
proving-ground/
  README.md
  structure.md
  config/
    proving-ground.example.json
    world-lock.example.json
  lib/
    scenario_family_loader.cjs
  scenarios/
    daemon-in-loop/
      family.json
```

## Intent

- `config/` keeps the experiment world reproducible
- `lib/` keeps loading and validation logic in one place
- `scenarios/` keeps scenario families deterministic and reviewable

