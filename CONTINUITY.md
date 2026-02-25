Goal (incl. success criteria):
- Ship and publish `Pandora CLI & Skills` with production-ready install/release quality.
- Success criteria:
  - `main` CI passes across Linux/macOS/Windows.
  - npm package `pandora-cli-skills` is published.
  - Signed release tag exists and is verified.

Constraints/Assumptions:
- Follow AGENTS.md continuity process every turn.
- Keep existing `launch`/`clone-bet` behavior unchanged unless fixing defects.
- Prefer deterministic local tests; do not rely on live network for CI.
- npm publish requires authenticated npm session and (if enabled) 2FA.

Key decisions:
- Repository/package branding renamed to `Pandora CLI & Skills` / `pandora-cli-skills`.
- Use signed git tags for releases (`v1.0.0`, `v1.0.1` already created).
- Address cross-platform smoke test gap (`spawnSync npm ENOENT` on Windows) before final publish confidence.

State:
  - Done:
    - Repo renamed to `XoAnonXo/pandora-cli-skills` and remote updated.
    - Package renamed to `pandora-cli-skills`; docs and tests updated.
    - Signed tags created/pushed: `v1.0.0`, `v1.0.1`.
    - Local validation succeeded after rename:
      - `npm test`
      - `npm run build`
      - `npm run pack:dry-run`
    - Release workflow for `v1.0.1` succeeded.
    - `npm publish --access public` attempted and failed with `ENEEDAUTH` (not logged in).
    - Fixed cross-platform smoke test command resolution:
      - `tests/smoke/pack-install-smoke.cjs` now uses `npm.cmd` on Windows.
    - Post-fix validation passed:
      - `npm test`
      - `npm run build`
      - `npm run pack:dry-run`
  - Now:
    - Commit and push Windows smoke test fix, then verify CI status.
  - Next:
    - Confirm green CI on `main` after fix.
    - Publish to npm once auth is available.
    - If publish happens after additional fixes, consider bumping from `1.0.1` to `1.0.2`.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: npm auth + 2FA availability in this environment for final `npm publish`.
- UNCONFIRMED: publish target version after CI fix (`1.0.1` vs bump to `1.0.2`).

Working set (files/ids/commands):
- Active files:
  - `/Users/mac/Desktop/pandora-market-setup-shareable/tests/smoke/pack-install-smoke.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/CONTINUITY.md`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/package.json`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/.github/workflows/ci.yml`
- Recent refs:
  - HEAD: `30879a4` (`v1.0.1`, `origin/main`)
  - Prior: `df1a21a` (`v1.0.0`)
