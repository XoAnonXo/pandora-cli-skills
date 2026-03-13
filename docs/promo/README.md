# Pandora Promotional Website Concepts

This folder contains a lightweight static concept deck for `PAN-7`.

## Files

- `index.html`: main promotional surface
- `styles.css`: visual system and four concept themes
- `app.js`: concept data, CTA wiring, and theme switching

## Local preview

Open `docs/promo/index.html` directly in a browser, or serve the repo root locally and visit `/docs/promo/`.

## Direct Review Links

- Signal Deck: `./index.html?variation=signal-deck`
- Operator Ledger: `./index.html?variation=operator-ledger`
- Arena Tape: `./index.html?variation=arena-tape`
- Protocol Garden: `./index.html?variation=protocol-garden`

## Validation

Run:

```bash
npm run check:promo
npm run check:promo:browser
```

`npm run check:promo` validates the required structure, CTA wiring, accessibility hooks, and research/source coverage for the promo surface.

`npm run check:promo:browser` loads the promo deck through a routed `http://promo.local/...` origin inside Chrome via `playwright-core`, then refreshes `output/playwright/` with screenshots plus a JSON report.

In this Codex sandbox, npm-managed Chrome launches can still abort before the browser stays up. If that happens here, rerun `node scripts/check_promo_browser.cjs` directly; that is the validated browser path for this environment.

## Notes

- The first screen intentionally front-loads agent actions.
- The deck now loads `app.js` as a deferred classic script instead of a module, so direct `file://` previews keep the interactive variation picker and CTA wiring in Chromium-based browsers.
- The "Open in Codex" and "Open in Claude Code" actions copy a ready prompt first, then open the nearest official product destination because there is no verified official public deep-link format for prefilled tasks.
- Copy-first CTA behavior now falls back to a hidden textarea + `document.execCommand('copy')` path, so direct `file://` previews still copy in more restricted browsers.
- The checked-in browser validation script intentionally uses a routed `http://promo.local/...` origin because `file://` Chrome runs can block `app.js`, which would make CTA and variation checks misleading.
- The deck uses local font stacks instead of remote font CDNs so it still looks intentional in restricted or offline review environments.
- A `noscript` fallback keeps the hero usable when JavaScript is unavailable and the instant-action buttons cannot run.
- The variation chooser now behaves like a proper single-choice control with radio semantics plus arrow-key, Home, and End navigation.
- The hero grid items explicitly opt into `min-width: 0` so the primary stage and CTA stack do not force horizontal overflow on narrow viewports.
- The head includes lightweight share metadata, and the research cards now use descriptive outbound labels instead of repeated generic link text.
- The page is built as a concept comparison deck with four distinct visual directions rather than one locked final homepage.
