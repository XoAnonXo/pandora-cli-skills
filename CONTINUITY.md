Goal (incl. success criteria):
- Implement and ship the full `pandora mirror` workflow for Polymarket -> Pandora pAMM mirroring with delta-neutral sync.
- Success criteria:
  - New command family works end-to-end: `mirror plan`, `mirror deploy`, `mirror sync run|once`, `mirror status`, `mirror verify`.
  - Liquidity sizing formula matches locked model+depth-cap specification.
  - Sync loop is paper-first, supports live execution with strict gates and deterministic blocking errors.
  - Rules/similarity verification is explicit and consumable by AI subagents.
  - Existing commands remain backward-compatible and tests pass.

Constraints/Assumptions:
- Follow AGENTS.md continuity process every turn.
- Additive-only changes to existing CLI behavior (no breaking changes).
- Source venue for mirror v1 is Polymarket only.
- Mirror deploy target is Pandora AMM only in v1.
- Foreground loop runtime only (no daemon manager).

Key decisions:
- Implement user-approved decision-complete mirror plan across M1-M4 in this patch.
- Default execution posture is paper mode; live mode requires explicit opt-in and full guard flags.
- Delta-neutral target is LP inventory neutral using reserve imbalance proxy.
- Strict gating enforces match confidence, exact rule-hash presence/match (unless override), lifecycle, close-time drift, depth, and risk caps.

State:
  - Done:
    - Added mirror services:
      - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_service.cjs`
      - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_sizing_service.cjs`
      - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_verify_service.cjs`
      - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_sync_service.cjs`
      - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_state_store.cjs`
      - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/polymarket_trade_adapter.cjs`
      - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/pandora_deploy_service.cjs`
    - Wired `mirror` command family into CLI:
      - `mirror plan`, `mirror deploy`, `mirror verify`, `mirror sync run|once`, `mirror status`
      - Help, parsing, renderers, strict flag validation, JSON envelopes.
    - Added deterministic tests:
      - Unit mirror sizing/rules/state/depth coverage.
      - CLI mirror command integration coverage.
      - Smoke help checks for mirror commands.
    - Critical review fixes applied:
      - `RULE_HASH_MATCH` now fails strict gate when one side is missing rule text.
      - `mirror status --state-file` no longer overwrites/misreports stored strategy hash.
      - `--strategy-hash` validation added (`16` hex chars).
    - Docs updated in `README_FOR_SHARING.md` and `SKILL.md` with mirror command/contracts.
    - Validation passed:
      - `npm run build`
      - `npm run test:unit`
      - `npm run test:cli`
      - `npm run test:smoke`
      - `npm run test`
      - `npm run pack:dry-run`
    - Revalidated on 2026-02-26 with full suite:
      - `npm run test` (build + unit + cli + smoke) passed.
    - Committed and pushed to `main`:
      - commit: `dacce9e`
      - branch push: `origin/main` updated (`355912a..dacce9e`).
    - Latest remote state:
      - `main` is clean and synchronized with `origin/main`.
    - NPM registry check on 2026-02-26:
      - package `pandora-cli-skills` latest published version is `1.1.3`.
      - published versions are `1.0.2`, `1.0.3`, `1.1.2`, `1.1.3`.
  - Now:
    - Latest local changes are committed and pushed to `main`.
  - Next:
    - Optional: version bump and npm publish if a new package release is needed.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- Core:
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/pandora.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_service.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_sizing_service.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_verify_service.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_sync_service.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_state_store.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/polymarket_trade_adapter.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/pandora_deploy_service.cjs`
- Tests/docs:
  - `/Users/mac/Desktop/pandora-market-setup-shareable/tests/unit/new-features.test.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/tests/cli/cli.integration.test.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/tests/smoke/pack-install-smoke.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/README_FOR_SHARING.md`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/SKILL.md`
