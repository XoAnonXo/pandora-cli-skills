#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const promoDir = path.join(repoRoot, 'docs', 'promo');
const indexPath = path.join(promoDir, 'index.html');
const stylesPath = path.join(promoDir, 'styles.css');
const appPath = path.join(promoDir, 'app.js');
const researchPath = path.join(repoRoot, 'references', 'promo-website-research.md');
const promoReadmePath = path.join(promoDir, 'README.md');
const rootReadmePath = path.join(repoRoot, 'README.md');
const skillReadmePath = path.join(repoRoot, 'SKILL.md');
const shareableReadmePath = path.join(repoRoot, 'README_FOR_SHARING.md');
const packageJsonPath = path.join(repoRoot, 'package.json');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseHtml(html) {
  const state = {
    h1Count: 0,
    ids: new Set(),
    sectionIds: new Set(),
    actionButtons: new Set(),
    variationButtons: 0,
    hasSkipLink: false,
    hasLiveRegion: false,
    hasNoscript: false,
    localRefs: new Set(),
  };
  const tagMatches = html.matchAll(/<([a-z0-9-]+)\b([^>]*)>/gi);

  for (const [, name, rawAttrs] of tagMatches) {
    const attrs = {};
    const attrMatches = rawAttrs.matchAll(/([:@a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g);

    for (const [, key, value] of attrMatches) {
      attrs[key] = value;
    }

    if (name === 'h1') {
      state.h1Count += 1;
    }

    if (attrs.id) {
      state.ids.add(attrs.id);
    }

    if (name === 'section' && attrs.id) {
      state.sectionIds.add(attrs.id);
    }

    if (name === 'a' && attrs.href === '#mainContent') {
      state.hasSkipLink = true;
    }

    if (name === 'noscript') {
      state.hasNoscript = true;
    }

    if (attrs['aria-live'] === 'polite') {
      state.hasLiveRegion = true;
    }

    for (const attrName of ['href', 'src']) {
      const value = attrs[attrName];
      if (
        value &&
        !value.startsWith('#') &&
        !value.startsWith('data:') &&
        !value.startsWith('http://') &&
        !value.startsWith('https://') &&
        !value.startsWith('mailto:') &&
        !value.startsWith('tel:')
      ) {
        state.localRefs.add(value);
      }
    }

    if (name === 'button') {
      if (attrs['data-action']) {
        state.actionButtons.add(attrs['data-action']);
      }

      if (attrs['data-variation']) {
        state.variationButtons += 1;
      }
    }
  }

  return state;
}

function checkHtml(indexHtml) {
  const parsed = parseHtml(indexHtml);
  const requiredIds = [
    'mainContent',
    'heroTitle',
    'heroDescription',
    'heroFacts',
    'heroTone',
    'actionStatus',
    'actionPreview',
    'variationList',
    'variationStatus',
    'audienceGrid',
    'proofGrid',
    'skillGrid',
    'researchGrid',
  ];
  const requiredSections = ['hero', 'concepts', 'audiences', 'proof', 'skills', 'research'];
  const requiredActions = ['codex', 'claude', 'mcp', 'sdk', 'bootstrap'];

  assert(parsed.h1Count === 1, `Expected exactly 1 h1, found ${parsed.h1Count}`);
  assert(parsed.hasSkipLink, 'Expected skip link to #mainContent');
  assert(parsed.hasLiveRegion, 'Expected a polite aria-live region');
  assert(parsed.hasNoscript, 'Expected a noscript fallback block');
  assert(parsed.variationButtons === 4, `Expected 4 variation buttons, found ${parsed.variationButtons}`);
  assert(indexHtml.includes('role="radiogroup"'), 'Expected variation picker radiogroup semantics');
  assert(indexHtml.includes('role="radio"'), 'Expected variation buttons to expose radio semantics');
  assert(indexHtml.includes('aria-checked="true"'), 'Expected an active variation with aria-checked="true"');
  assert(indexHtml.includes('id="variationStatus"') && indexHtml.includes('aria-atomic="true"'), 'Expected variationStatus live region with aria-atomic="true"');
  assert(!indexHtml.includes('fonts.googleapis.com') && !indexHtml.includes('fonts.gstatic.com'), 'Promo HTML should not depend on remote Google Fonts');
  assert(indexHtml.includes('name="theme-color"'), 'Expected theme-color metadata in promo HTML');
  assert(indexHtml.includes('property="og:title"'), 'Expected og:title metadata in promo HTML');
  assert(indexHtml.includes('property="og:description"'), 'Expected og:description metadata in promo HTML');
  assert(indexHtml.includes('name="twitter:card"'), 'Expected twitter:card metadata in promo HTML');
  assert(indexHtml.includes('rel="icon"'), 'Expected favicon metadata in promo HTML');
  assert(indexHtml.includes('<script src="./app.js" defer></script>'), 'Expected promo HTML to load app.js with a deferred classic script');
  assert(!indexHtml.includes('<script type="module" src="./app.js"></script>'), 'Promo HTML should not load app.js as a module');
  assert(!indexHtml.includes('>Open source<'), 'Promo HTML should not use repeated generic research link text');

  for (const id of requiredIds) {
    assert(parsed.ids.has(id), `Missing required HTML id: ${id}`);
  }

  for (const sectionId of requiredSections) {
    assert(parsed.sectionIds.has(sectionId), `Missing required section id: ${sectionId}`);
  }

  for (const action of requiredActions) {
    assert(parsed.actionButtons.has(action), `Missing required action button: ${action}`);
  }

  for (const ref of parsed.localRefs) {
    const resolvedPath = path.resolve(promoDir, ref);
    assert(fs.existsSync(resolvedPath), `Missing local asset/link target referenced from promo HTML: ${ref}`);
  }
}

function checkCss(stylesCss) {
  const requiredSnippets = [
    '.skip-link',
    ':focus-visible',
    '@media (prefers-reduced-motion: reduce)',
    '.variation-mood',
    '.variation-card.is-active',
    '.hero-copy,\n.hero-stage {\n  position: relative;\n  min-width: 0;',
  ];

  for (const snippet of requiredSnippets) {
    assert(stylesCss.includes(snippet), `Missing required CSS snippet: ${snippet}`);
  }
}

function checkJs(appJs) {
  const requiredSnippets = [
    'const variations = [',
    'const audiences = [',
    'const proofBlocks = [',
    'const skillCards = [',
    'const researchItems = [',
    'const actionMap = {',
    'updateVariationButtons()',
    'const variationIds = new Set(',
    'const baseDocumentTitle =',
    "searchParams.get('variation')",
    'history.replaceState',
    'document.execCommand',
    'legacyCopyToClipboard',
    'target instanceof Element',
    "elements.variationList?.addEventListener('keydown'",
    "case 'ArrowRight':",
    "case 'ArrowLeft':",
    "case 'Home':",
    "case 'End':",
    'button.tabIndex = isActive ? 0 : -1',
    "button.setAttribute('aria-checked', isActive ? 'true' : 'false')",
    'document.title =',
    'variationStatus',
    'themeColorMeta',
    'themeColor:',
    'openPendingWindow',
    'location.replace(action.url)',
    "prefers-reduced-motion: reduce",
    'copyToClipboard',
    'linkAriaLabel:',
    'linkLabel:',
    'https://openai.com/codex/',
    'https://claude.ai',
    'https://claude.com/product/claude-code',
  ];

  for (const snippet of requiredSnippets) {
    assert(appJs.includes(snippet), `Missing required JS snippet: ${snippet}`);
  }
}

function checkResearch(researchMd) {
  const requiredSources = [
    'https://thisispandora.ai',
    'https://modelcontextprotocol.io',
    'https://stripe.com',
    'https://supabase.com',
    'https://vercel.com/ai',
    'https://openai.com/codex/',
    'https://claude.com/product/claude-code',
  ];

  for (const source of requiredSources) {
    assert(researchMd.includes(source), `Missing research source: ${source}`);
  }
}

function checkPromoReadme(promoReadme) {
  const requiredSnippets = [
    '## Validation',
    'npm run check:promo',
    'npm run check:promo:browser',
    'node scripts/check_promo_browser.cjs',
    '?variation=signal-deck',
    '?variation=operator-ledger',
    '?variation=arena-tape',
    '?variation=protocol-garden',
    'npm-managed Chrome launches',
    'promo.local',
    'local font stacks',
    'document.execCommand',
    'radio semantics',
    'share metadata',
    'descriptive outbound labels',
    'deferred classic script',
  ];

  for (const snippet of requiredSnippets) {
    assert(promoReadme.includes(snippet), `Missing promo README snippet: ${snippet}`);
  }
}

function checkRootReadme(rootReadme) {
  const requiredSnippets = [
    'docs/promo/README.md',
    'npm run check:promo',
    'node scripts/check_promo_browser.cjs',
    'npm-managed Chrome launches are unreliable here',
  ];

  for (const snippet of requiredSnippets) {
    assert(rootReadme.includes(snippet), `Missing root README promo entrypoint: ${snippet}`);
  }
}

function checkSkillReadme(skillReadme) {
  const requiredSnippets = ['docs/promo/README.md'];

  for (const snippet of requiredSnippets) {
    assert(skillReadme.includes(snippet), `Missing SKILL.md promo entrypoint: ${snippet}`);
  }
}

function checkShareableReadme(shareableReadme) {
  const requiredSnippets = [
    'promo/                promotional website concepts and static assets',
    '`docs/promo/**`',
    '`docs/promo/README.md`',
    '`references/promo-website-research.md`',
    '`scripts/check_promo_surface.cjs`',
    '`scripts/check_promo_browser.cjs`',
    'npm run check:promo',
    'node scripts/check_promo_browser.cjs',
    'npm-managed Chrome launches are unreliable here',
  ];

  for (const snippet of requiredSnippets) {
    assert(shareableReadme.includes(snippet), `Missing shareable README snippet: ${snippet}`);
  }
}

function checkPackageJson(packageJsonRaw) {
  const packageJson = JSON.parse(packageJsonRaw);
  const files = packageJson.files || [];
  const scripts = packageJson.scripts || {};

  assert(files.includes('docs/promo/**'), 'package.json files allowlist is missing docs/promo/**');
  assert(files.includes('references/promo-website-research.md'), 'package.json files allowlist is missing references/promo-website-research.md');
  assert(files.includes('scripts/check_promo_surface.cjs'), 'package.json files allowlist is missing scripts/check_promo_surface.cjs');
  assert(files.includes('scripts/check_promo_browser.cjs'), 'package.json files allowlist is missing scripts/check_promo_browser.cjs');
  assert(scripts['check:promo'] === 'node scripts/check_promo_surface.cjs', 'package.json check:promo script is missing or changed');
  assert(scripts['check:promo:browser'] === 'node scripts/check_promo_browser.cjs', 'package.json check:promo:browser script is missing or changed');
  assert(typeof scripts.build === 'string' && scripts.build.includes('npm run check:promo'), 'package.json build script is missing npm run check:promo');
  assert(typeof scripts.prepack === 'string' && scripts.prepack.includes('npm run check:promo'), 'package.json prepack script is missing npm run check:promo');
}

function main() {
  const indexHtml = read(indexPath);
  const stylesCss = read(stylesPath);
  const appJs = read(appPath);
  const researchMd = read(researchPath);
  const promoReadme = read(promoReadmePath);
  const rootReadme = read(rootReadmePath);
  const skillReadme = read(skillReadmePath);
  const shareableReadme = read(shareableReadmePath);
  const packageJsonRaw = read(packageJsonPath);

  checkHtml(indexHtml);
  checkCss(stylesCss);
  checkJs(appJs);
  checkResearch(researchMd);
  checkPromoReadme(promoReadme);
  checkRootReadme(rootReadme);
  checkSkillReadme(skillReadme);
  checkShareableReadme(shareableReadme);
  checkPackageJson(packageJsonRaw);

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        checked: [
          'docs/promo/index.html',
          'docs/promo/styles.css',
          'docs/promo/app.js',
          'README.md',
          'SKILL.md',
          'README_FOR_SHARING.md',
          'references/promo-website-research.md',
        ],
      },
      null,
      2,
    ) + '\n',
  );
}

main();
