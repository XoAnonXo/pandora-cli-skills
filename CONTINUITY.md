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
- Strict gating is enforced for match confidence, rules hash, lifecycle, close-time drift, depth, and risk caps.

State:
  - Done:
    - Added new mirror services:
      - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_service.cjs`
      - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_sizing_service.cjs`
      - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_verify_service.cjs`
      - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_sync_service.cjs`
      - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/mirror_state_store.cjs`
      - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/polymarket_trade_adapter.cjs`
      - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/pandora_deploy_service.cjs`
    - Wired new `mirror` command family into CLI entrypoint/dispatcher:
      - `mirror plan`, `mirror deploy`, `mirror verify`, `mirror sync run|once`, `mirror status`
      - Added strict flag validation, help output, JSON envelopes, and table renderers.
    - Implemented formula-driven mirror sizing and distribution hint mapping.
    - Implemented mirror verification with similarity scoring, rule hashing/diff, and gate evaluation.
    - Implemented mirror sync loop with persisted state, idempotency, cooldown, kill-switch, risk caps, webhook support, and paper/live branching.
    - Added Polymarket depth and trade adapter support (`getOrderBook`, depth calculation, market order posting path).
    - Added deterministic unit tests for mirror sizing, rules hash/diff, mirror state persistence, and depth calculations.
    - Added deterministic CLI integration tests for mirror plan/verify/deploy/sync/status and live guardrail enforcement.
    - Added smoke checks for mirror help commands in pack/install test.
    - Updated docs (`README_FOR_SHARING.md`, `SKILL.md`) with mirror command coverage and JSON contract notes.
    - Validation completed and passing:
      - `npm run build`
      - `npm run test:unit`
      - `npm run test:cli`
      - `npm run test:smoke`
      - `npm run test`
      - `npm run pack:dry-run`
  - Now:
    - Implementation complete and validated locally.
  - Next:
    - Commit and push patch.
    - Optionally version bump and publish to npm.

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
