Goal (incl. success criteria):
- Create a new git repository for this project and push the full codebase.
- Success criteria:
  - Ensure local git repo is initialized/clean with all intended files committed.
  - Create remote repository (GitHub) and set origin.
  - Push default branch and verify remote linkage.

Constraints/Assumptions:
- Follow AGENTS.md continuity process every turn.
- Keep existing `launch`/`clone-bet` behavior intact.
- Prefer deterministic tests using local mocks (no live-network dependency in tests).
- Ignore unrelated edits from parallel agents.

Key decisions:
- Use GraphQL (`POST /`) for indexer commands; REST endpoints are currently 404.
- Keep dual output modes (`table` default, `json` for machine-readable workflows).
- Address review findings from spawned audit agents (phase 1 and phase 2) as part of this pass.

State:
  - Done:
    - Spawned agents for phase audits + implementation:
      - Phase 1 audit: `019c9641-78a2-77b0-9927-6a4c5a72c366`
      - Phase 2 audit: `019c9641-7be9-77b3-803e-b0902dbd504a`
      - Phase 3/4 implementation: `019c9641-7ebc-7f42-a652-18e9b681d4dc`
    - Core Phase 3/4 CLI implementation landed in `cli/pandora.cjs`.
    - Integration test suite was expanded with mock RPC/indexer coverage.
    - Phase 1/2 audit findings captured (test discovery gaps, smoke scope, workflow/action hardening, installer safety gaps).
    - Resolved integration timeout deadlock by adding async CLI runner for mock-server tests.
    - Updated CLI GraphQL list handling to page-shape (`items` + `pageInfo`) and verified against live indexer.
    - Hardened workflows and release installer:
      - pinned GitHub Actions to immutable SHAs
      - release trigger narrowed to `v*`
      - added test gate in release workflow
      - installer now validates asset basename, handles ambiguity, adds curl retry/timeouts, and supports `--expected-sha256`.
    - Updated docs (`README_FOR_SHARING.md`, `SKILL.md`) for new commands and output modes.
    - Full validation passed:
      - `npm test`
      - `npm run build`
      - `npm run pack:dry-run`
    - Live indexer smoke passed for new read-only commands:
      - `markets list`
      - `polls list`
      - `events list/get`
      - `positions list`
    - P3 fixed:
      - CI matrix now includes `windows-latest`.
      - CI switched to cross-platform `npm test` step instead of shell-specific smoke snippet.
    - P2 fixed:
      - Release workflow now installs cosign, keylessly signs tarball, verifies signature in workflow, and publishes `.sig` + `.pem`.
      - Release workflow permissions include `id-token: write` for OIDC signing.
      - Installer now verifies cosign signature by default and supports identity/issuer overrides.
      - Installer keeps explicit `--skip-signature-verify` escape hatch for legacy unsigned releases.
    - Validation after P2/P3 fixes passed:
      - `npm test`
      - `npm run build`
      - `npm run pack:dry-run`
      - `bash -n scripts/release/install_release.sh`
      - installer argument-path checks for cosign requirement and path traversal rejection.
    - Completed full audit + P2/P3 remediations and retained green validation.
    - Checked npm publish prerequisites:
      - package name `pandora-market-setup` currently returns npm 404 (appears available).
      - local npm session is not authenticated (`npm whoami` => not-logged-in).
    - Initialized local git history and created first commit:
      - `b1c8490` ("Initial commit: pandora market setup CLI").
    - Created and pushed remote repository:
      - `https://github.com/XoAnonXo/pandora-market-setup-shareable`
      - `origin` configured and `main` tracks `origin/main`.
  - Now:
    - Repository creation/push task is complete.
  - Next:
    - Optional: publish npm package and cut signed `v*` release tag.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- Files in active scope:
  - `/Users/mac/Desktop/pandora-market-setup-shareable/cli/pandora.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/tests/helpers/cli_runner.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/tests/cli/cli.integration.test.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/tests/smoke/pack-install-smoke.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/tests/unit/sanity.test.cjs`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/package.json`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/.github/workflows/ci.yml`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/.github/workflows/release.yml`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/scripts/release/install_release.sh`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/README_FOR_SHARING.md`
  - `/Users/mac/Desktop/pandora-market-setup-shareable/SKILL.md`
- Recent command outcomes:
  - `npm test` passed.
  - `npm run build` passed.
  - `npm run pack:dry-run` passed.
  - `bash -n scripts/release/install_release.sh` passed.
  - `scripts/release/install_release.sh --repo owner/repo --tag v1 --no-install` now fails fast with `Missing required command: cosign` (expected secure default).
  - `scripts/release/install_release.sh ... --asset '../evil.tgz'` rejected with `Invalid asset name...` (path traversal prevention).
  - External comparison data collected from cloned `Polymarket/polymarket-cli` snapshot.
  - `gh repo create pandora-market-setup-shareable --public --source=. --remote=origin --push` succeeded.
  - `git status -sb` => `main...origin/main` (clean tracking state).
