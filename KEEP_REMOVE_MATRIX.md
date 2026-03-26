# Keep/Remove Matrix

Simple, we need to have one cleanup table (architecture owner decision matrix) so repo hygiene changes stop bouncing between audit notes and half-finished edits.

## Current Decision Matrix

| Area | Item | Decision | Why | Next action |
| --- | --- | --- | --- | --- |
| Release artifacts | Root package tarballs (`/*.tgz`) | Remove from source control | Built output is not source of truth and should not be tracked again | Keep ignored in `.gitignore` |
| Release artifacts | `pandora-market-setup-1.0.0.tgz` | Already removed on latest `main` | This was a dead tracked artifact from an older snapshot | No further action beyond ignore rule |
| Backlog | `todos/` active backlog | Keep | Active planning still belongs in the repo when it affects current implementation work | Keep only the live items in the top-level `todos/` folder |
| Backlog | `todos/archive/` | Keep archived in-repo | Latest `main` already compacted the backlog and local archive keeps history searchable | No move to a separate repo right now |
| Release helper scripts | `scripts/build_benchmark_publication_manifest.cjs` | Keep | Wired into the GitHub release workflow even though it is not exposed as an npm script | Treat as release infrastructure, not dead code |
| Orphan scripts | `scripts/generate_cli_visualizer_data.cjs` | Already absent on latest `main` | Not a current cleanup task anymore | None |
| Orphan scripts | `scripts/serve_cli_visualizer.cjs` | Already absent on latest `main` | Not a current cleanup task anymore | None |
| SDK generated payloads | `sdk/generated/**`, `sdk/typescript/generated/**`, `sdk/python/pandora_agent/generated/**` | Keep current release model, defer deeper refactor | Publish payload was already reduced in `1.1.126`, but repo still keeps surface-specific generated outputs | Revisit later as a dedicated SDK build/publish refactor |
| Tests | `tests/cli/cli.integration.test.cjs` | Keep | It is already just a tiny loader over split domain suites | No cleanup needed |
| Tests | `tests/unit/new-features.test.cjs` | Keep for now, split later | Still too large, but this is a real refactor not a hygiene deletion | Plan a domain split into focused suites |
| Legacy launchers | `docs/skills/legacy-launchers.md` | Keep | Still part of the shipped command surface and docs graph | Only remove if `launch` / `clone-bet` are formally deprecated |
| Legacy launchers | `scripts/create_market_launcher.ts` | Keep | Still packaged and referenced by CLI/docs/tests | Same as above |
| Legacy launchers | `scripts/create_polymarket_clone_and_bet.ts` | Keep | Still packaged and referenced by CLI/docs/tests | Same as above |

## Operating Rule

Simple, we need to have two different buckets (product surface vs repo hygiene):

- If a file is referenced by CLI routing, docs registry, package publishing, generated contracts, or tests, it is product surface and cannot be deleted as "cleanup".
- If a file has no references and no release/runtime path, it is hygiene debt and can be removed in a cleanup sweep.
