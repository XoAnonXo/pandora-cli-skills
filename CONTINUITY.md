Goal (incl. success criteria):
- Harden Pandora CLI against latest audit findings and improve arbitrage explainability for AI subagents.
- Success criteria:
  - Leaderboard never reports impossible win-rate percentages from inconsistent indexer aggregates.
  - Autopilot state persistence is robust under rapid repeated runs using the same strategy hash.
  - Mainnet deployment/config reference is documented for ABI-gated `resolve`/`lp` readiness.
  - Validation suite passes (`test`, `build`, `pack:dry-run`).
  - `arbitrage` can expose similarity checks and rule context for agent verification.
  - `arbitrage` reduces same-venue false positives via cross-venue default behavior.

Constraints/Assumptions:
- Follow AGENTS.md continuity process every turn.
- Keep existing command behavior additive (no breaking changes).
- `resolve` and `lp` remain ABI-gated until verified ABI integration lands.

Key decisions:
- Keep leaderboard output deterministic by sanitizing inconsistent totals and surfacing explicit diagnostics.
- Scope `leaderboard` payload-level diagnostics to returned rows only (avoid diagnostics for out-of-window rows).
- Fix autopilot write race by using unique per-write temp files before atomic rename.
- Keep provided mainnet deployment addresses/indexer as documentation source-of-truth (no ABI execution wiring yet).
- Make `arbitrage` cross-venue-only by default; explicit `--allow-same-venue` opt-in.
- Add agent-facing arbitrage flags: `--with-rules` and `--include-similarity`.

State:
  - Done:
    - npm publish issue resolved earlier; package `pandora-cli-skills` latest is `1.1.2`.
    - Implemented leaderboard hardening in `cli/lib/leaderboard_service.cjs`:
      - Clamps inconsistent wins/losses against trades.
      - Caps win-rate to `[0,1]`.
      - Emits row diagnostics and payload-level diagnostics.
      - Schema version bumped to `1.0.1`.
    - Implemented autopilot persistence hardening in `cli/lib/autopilot_state_store.cjs`:
      - Replaced shared `.tmp` path with unique temp file suffix (`pid + timestamp + random`).
    - Added deterministic tests:
      - Unit: unique temp path behavior for `saveState`.
      - CLI integration: leaderboard inconsistent aggregate sanitization + diagnostics.
      - CLI integration: diagnostics scope only includes returned leaderboard rows.
      - Added fixture override support in indexer mock helper.
    - Updated docs:
      - `references/contracts.md` now includes full provided Pandora mainnet deployment/config and indexer URL.
      - `README_FOR_SHARING.md` and `SKILL.md` include mainnet reference block.
      - Documented leaderboard sanitization behavior.
    - Validation completed and passing:
      - `npm run test`
      - `npm run build`
      - `npm run pack:dry-run`
    - Pushed hardening commits to `main`:
      - `7baa17a` `cli: harden leaderboard metrics and autopilot state writes`
      - `5ad3ff0` `docs: refresh continuity ledger after hardening push`
      - `24c2cba` `cli: scope leaderboard diagnostics to returned rows` (P2 review fix)
    - Prepared release candidate `1.1.3`:
      - bumped `package.json` and `package-lock.json` to `1.1.3`.
      - validations passed:
        - `npm run test`
        - `npm run pack:dry-run`
    - Released `pandora-cli-skills@1.1.3`:
      - published successfully to npm with `latest` tag.
      - registry verification:
        - `npm view pandora-cli-skills version --prefer-online` -> `1.1.3`
        - `npm view pandora-cli-skills@1.1.3 version` -> `1.1.3`
      - direct registry payload confirms `dist-tags.latest=1.1.3`.
    - Arbitrage agent-explainability upgrade implemented:
      - `cli/lib/arbitrage_service.cjs`:
        - schema version `1.1.0`.
        - added pairwise similarity breakdown (`tokenScore`, `jaroWinkler`, blended score).
        - added `crossVenueOnly` matching rule and same-venue risk flag support.
        - added optional `similarityChecks` payload and `matchSummary`.
        - added optional per-leg rule/source metadata output.
        - added diagnostics when cross-venue-only is used with fewer than 2 venues.
        - added poll metadata fallback (graceful downgrade if indexer lacks `rules`/`sources` fields).
      - `cli/lib/polymarket_adapter.cjs`:
        - adds leg id and rule-text mapping from Polymarket description.
      - `cli/pandora.cjs`:
        - new arbitrage flags:
          - `--cross-venue-only` (default)
          - `--allow-same-venue`
          - `--with-rules`
          - `--include-similarity`
        - updated help/usage strings and examples.
        - `suggest` now invokes arbitrage with explicit safe defaults for new flags.
    - Deterministic integration tests added for new arbitrage behavior:
      - default cross-venue-only filtering vs same-venue override.
      - rules + similarity diagnostics payload exposure.
    - Validation after arbitrage upgrades:
      - `npm run test:cli` (68 passing)
      - `npm run test:unit` (7 passing)
      - `npm run build`
  - Now:
    - Reviewing and summarizing arbitrage-agent improvements for user.
  - Next:
    - Commit and push arbitrage explainability updates.
    - Optionally publish `1.1.4` patch release if requested.

Open questions (UNCONFIRMED if needed):
- Should arbitrage upgrades ship immediately as `1.1.4`? UNCONFIRMED.

Working set (files/ids/commands):
- Active files:
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/leaderboard_service.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/lib/autopilot_state_store.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/tests/cli/cli.integration.test.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/tests/unit/new-features.test.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/references/contracts.md`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/README_FOR_SHARING.md`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/SKILL.md`
- Validation commands:
  - `npm run test`
  - `npm run pack:dry-run`
