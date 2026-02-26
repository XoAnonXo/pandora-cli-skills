Goal (incl. success criteria):
- Ship and publish `Pandora CLI & Skills` with production-ready install/release quality.
- Execute post-release optimization roadmap to materially improve CLI usability for humans and agents.
- Success criteria:
  - `main` CI passes across Linux/macOS/Windows.
  - npm package `pandora-cli-skills` is published.
  - Signed release tag exists and is verified.
  - Phase 1, Phase 2, and Phase 3 features are implemented and tested.

Constraints/Assumptions:
- Follow AGENTS.md continuity process every turn.
- Keep existing `launch`/`clone-bet` behavior unchanged unless fixing defects.
- Prefer deterministic local tests; do not rely on live network for CI.
- npm publish requires authenticated npm session and (if enabled) 2FA.

Key decisions:
- Repository/package branding renamed to `Pandora CLI & Skills` / `pandora-cli-skills`.
- Use signed git tags for releases (`v1.0.0`, `v1.0.1`, `v1.0.2`).
- Harden smoke tests for Windows parity before publish confidence.
- Phase 2 supports quote/trade with PariMutuel-compatible execute path.
- Phase 3 now includes both portfolio analytics and watch polling.

State:
  - Done:
    - Repo rename, package rename, signed tags, npm publish, CI hardening complete.
    - 5-bug audit fixes complete with regression tests.
    - Phase 1 complete (`scan`, `--expand`, `--with-odds`) with docs + tests and full validation.
    - Phase 2 complete (`quote`, `trade`, help handlers, dry-run plan, execute flow, tests, docs).
    - Phase 3 advanced slice complete:
      - Added `pandora portfolio` metrics: `cashflowNet`, `pnlProxy` and standardized table-mode error prefixing.
      - Added `pandora watch` command for polling market and/or wallet snapshots.
      - Added deterministic tests for watch targets/iterations and enhanced portfolio assertions.
      - Updated docs (`README_FOR_SHARING.md`, `SKILL.md`) for watch + enriched Phase 3 contracts.
    - Post-Phase-3 UX/query slice complete:
      - Added nested subcommand help for `markets`, `polls`, `events`, `positions` (`--help` works at subcommand level).
      - Added market lifecycle convenience filters: `--active`, `--resolved`, `--expiring-soon`, `--expiring-hours`.
      - Added batch `markets get` support via repeated `--id` and `--stdin`, including partial-hit reporting (`missingIds`).
      - Added integration coverage for scoped help, lifecycle filters, lifecycle validation, and batch market retrieval.
      - Updated docs (`README_FOR_SHARING.md`, `SKILL.md`) with lifecycle + batch get usage/limitations.
    - Post-Phase-3 risk/alert slice complete:
      - Added trade risk guardrails: `--max-amount-usdc`, `--min-probability-pct`, `--max-probability-pct`, and `--allow-unquoted-execute`.
      - Enforced execute safety: unquoted `trade --execute` now fails by default unless explicitly bypassed or protected with `--min-shares-out-raw`.
      - Added watch alerts: `--alert-yes-below`, `--alert-yes-above`, `--alert-net-liquidity-below`, `--alert-net-liquidity-above`, and `--fail-on-alert`.
      - Added alert metadata in watch payload (`alertCount`, snapshot `alerts`, aggregated `alerts[]`).
      - Added integration tests for trade guards, watch alert validation/triggering, and non-zero fail-on-alert exits.
      - Updated docs (`README_FOR_SHARING.md`, `SKILL.md`) for risk guardrails and watch alert contracts.
    - CI failure diagnosis complete for run `22438277762`:
      - Root cause: `clone-bet --help` test failed in clean runners because `runScriptCommand` loaded missing `scripts/.env` before forwarding help flags.
      - Fix: skip dotenv loading for help-only passthrough in script wrapper; added regression test for `launch --help` without env file.
      - Local validations after fix: `npm run test:cli`, `npm run test`, `npm run build`, `npm run pack:dry-run` all pass.
    - Latest validations all passing:
      - `npm run test`
      - `npm run build`
      - `npm run pack:dry-run`
  - Now:
    - Token-based publish completed successfully.
    - npm registry now shows `pandora-cli-skills@1.0.3` as `latest`.
    - Working tree contains version bump files pending commit (`package.json`, `package-lock.json`) plus ledger update.
  - Next:
    - Commit/push version bump so repository state matches published npm artifact.
    - If requested: create signed release tag for the publish commit.

Open questions (UNCONFIRMED if needed):
- Release target for bundled post-Phase-3 patch (`1.0.3` now vs later). UNCONFIRMED.

Working set (files/ids/commands):
- Active files:
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/pandora.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/tests/cli/cli.integration.test.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/README_FOR_SHARING.md`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/SKILL.md`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/CONTINUITY.md`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/scripts/create_market_launcher.ts`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/scripts/create_polymarket_clone_and_bet.ts`
- Validation commands:
  - `npm run test`
  - `npm run build`
  - `npm run pack:dry-run`
