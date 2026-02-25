# Pandora CLI & Skills — Shareable Package

This is a sanitized, shareable copy of the Pandora market setup skill.

## What is included
- `SKILL.md` (usage/behavior)
- `package.json`
- `package-lock.json`
- `.gitignore`
- `scripts/.env.example`
- `scripts/create_market_launcher.ts`
- `scripts/create_polymarket_clone_and_bet.ts`
- `references/creation-script.md`
- `references/contracts.md`
- `references/checklist.md`

## What is intentionally omitted
- `.env` (contains PRIVATE_KEY / RPC overrides)
- `wallet.json` (contains privateKey/address)
- any local runtime secrets
- `node_modules`

## Setup
Prerequisite: Node.js `>=18`.

1. Install dependencies:
   - `npm install`
2. Initialize env file:
   - `npm run init-env`
   - or one-shot guided flow: `npm run setup`
3. Fill `scripts/.env`:
   - `CHAIN_ID`
   - `PRIVATE_KEY`
   - `RPC_URL`
   - `ORACLE`
   - `FACTORY`
   - `USDC`
4. Validate and build:
   - `npm run doctor`
   - `npm run build`
5. Run:
   - `npm run dry-run`
   - `npm run dry-run:clone`
   - `node cli/pandora.cjs help`

## New CLI capabilities
- Global machine-readable output:
  - `pandora --output json doctor`
  - `pandora --output table polls list --limit 10`
  - `--output json` is for non-execution commands; `launch`/`clone-bet` stream script output directly.
- Guided setup:
  - `pandora setup`
  - `pandora setup --check-usdc-code`
- Stronger doctor checks:
  - Required env and value validation
  - RPC reachability + chain-id match
  - Contract bytecode checks (`ORACLE`, `FACTORY`, optional `USDC`)
- Read-only indexer commands (GraphQL-backed):
  - `pandora markets list|get`
  - `pandora polls list|get`
  - `pandora events list|get`
  - `pandora positions list`

## Read-only examples
- `pandora markets list --limit 20 --order-by createdAt --order-direction desc`
- `pandora markets get --id <market-id>`
- `pandora polls list --status 1 --category 3`
- `pandora events list --type all --wallet <0x...> --limit 25`
- `pandora positions list --wallet <0x...> --limit 50`

## Release and verified install
- CI workflow: `.github/workflows/ci.yml` runs on Linux/macOS/Windows and covers install, lint/typecheck, full tests, and `npm pack --dry-run`.
- Release workflow: `.github/workflows/release.yml` runs on pushed `v*` tags, runs tests, builds `npm pack`, generates `checksums.sha256`, and uploads both workflow artifacts + GitHub Release assets.
- Verified install helper:
  - `scripts/release/install_release.sh --repo <owner/repo> --tag <tag> --no-install`
  - `scripts/release/install_release.sh --repo <owner/repo> --tag <tag>`
  - optional out-of-band digest pin: `scripts/release/install_release.sh --repo <owner/repo> --tag <tag> --expected-sha256 <64-hex>`
- The helper downloads `checksums.sha256` from the tag release, verifies SHA-256 for the tarball, verifies keyless cosign signature (`<asset>.sig` + `<asset>.pem`) against the release workflow identity, then installs via npm (global by default).
- `cosign` is required for default secure install. Use `--skip-signature-verify` only for legacy unsigned releases.

## CLI
- Entry command: `pandora` (from package `bin`) or `node cli/pandora.cjs`.
- Commands:
  - `pandora init-env`
  - `pandora setup`
  - `pandora doctor`
  - `pandora markets list|get`
  - `pandora polls list|get`
  - `pandora events list|get`
  - `pandora positions list`
  - `pandora launch ...`
  - `pandora clone-bet ...`
- Optional global link in this checkout:
  - `npm link`
  - then run `pandora help`

## Security
Never share real private keys. Use environment files only locally.
