---
status: in_progress
priority: p1
issue_id: "066"
tags: [phase2, execution, profiles, integration]
dependencies: ["056", "057", "058"]
owner: Codex
---

# Objective
Make named signer profiles first-class in live execution paths so raw `--private-key` is no longer the only real mutable path.

# Scope
- Add shared signer resolution for Pandora execution services.
- Thread `profileId` / profile file selectors into live command handlers where appropriate.
- Keep `--private-key` compatibility, but prefer profiles in policy/recipe/agent flows.

# Required behaviors
- [ ] At least two mutable command families can execute using `profileId` without raw `--private-key`.
- [ ] Operation metadata records the selected profile and effective signer backend.
- [ ] Policy packs that recommend `use_profile` now land on actually runnable built-ins.
- [ ] Existing private-key flows remain backward compatible.

# Candidate execution surfaces
- `market_admin_service.cjs`
- `pandora_deploy_service.cjs`
- `polymarket_ops_service.cjs`
- mirror execute paths if low-friction

