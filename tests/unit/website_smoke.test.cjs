"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const websiteDir = path.join(repoRoot, "website");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("website surface includes expected core files", () => {
  const expected = [
    "website/index.html",
    "website/src/App.tsx",
    "website/src/site-data.ts",
    "website/src/index.css",
    "website/public/pandora-logo.svg",
    "website/public/pandora-og-card.png",
    "website/public/pandora-mark.svg",
    "website/check.cjs",
    "website/serve.cjs",
  ];

  for (const file of expected) {
    assert.ok(fs.existsSync(path.join(repoRoot, file)), `${file} should exist`);
  }

  assert.ok(fs.statSync(websiteDir).isDirectory());
});

test("website app exposes skip link, main landmark, and mobile navigation", () => {
  const app = read("website/src/App.tsx");
  assert.match(app, /Skip to content/);
  assert.match(app, /id="main"/);
  assert.match(app, /Sheet/);
  assert.match(app, /aria-label="Open navigation"/);
  assert.match(app, /ThemeToggle/);
  assert.match(app, /navigator\.clipboard\.writeText/);
  assert.match(app, /pandora-logo\.svg/);
});

test("website content data contains the expected portal primitives", () => {
  const content = read("website/src/site-data.ts");
  assert.match(content, /surfaces =/);
  assert.match(content, /workflows =/);
  assert.match(content, /recipeCards =/);
  assert.match(content, /trustLayers =/);
  assert.match(content, /docTracks =/);
  assert.match(content, /releaseStages =/);
  assert.match(content, /const docsBase = `\$\{repoBase\}\/blob\/main`/);
  assert.match(content, /const latestRelease = `\$\{repoBase\}\/releases\/latest`/);
});

test("website preview server serves the built dist directory", () => {
  const script = read("website/serve.cjs");
  assert.match(script, /const root = path\.join\(__dirname, "dist"\);/);
  assert.match(script, /http:\/\/127\.0\.0\.1:/);
  assert.match(script, /index\.html/);
});

test("website theme tokens are Pandora-aligned", () => {
  const css = read("website/src/index.css");
  assert.match(css, /--background: #f5f5f7/);
  assert.match(css, /--primary: #151820/);
  assert.match(css, /--brand-blue: #0071e3/);
  assert.match(css, /SF Pro Display/);
});

test("website build is safe for repo-scoped GitHub Pages", () => {
  const viteConfig = read("website/vite.config.ts");
  const indexHtml = read("website/index.html");
  const app = read("website/src/App.tsx");
  assert.match(viteConfig, /base: "\.\/"/);
  assert.match(indexHtml, /%BASE_URL%pandora-logo\.svg/);
  assert.match(app, /import\.meta\.env\.BASE_URL/);
});

test("website metadata is specific to Pandora and exposes a branded preview", () => {
  const indexHtml = read("website/index.html");
  assert.match(indexHtml, /Pandora for agents, builders, and operators/);
  assert.match(indexHtml, /MCP for agents/);
  assert.match(indexHtml, /pandora-og-card\.png/);
  assert.match(indexHtml, /twitter:card/);
  assert.match(indexHtml, /rel="canonical"/);
});
