#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

let chromium;

try {
  ({ chromium } = require('playwright-core'));
} catch (error) {
  process.stderr.write(`Unable to load playwright-core: ${error.message}\n`);
  process.exit(1);
}

const repoRoot = process.cwd();
const promoPath = path.join(repoRoot, 'docs', 'promo', 'index.html');
const outputDir = path.join(repoRoot, 'output', 'playwright');
const reportPath = path.join(outputDir, 'promo-validation.json');
const screenshots = {
  home: path.join(outputDir, 'promo-home.png'),
  interactions: path.join(outputDir, 'promo-interactions.png'),
  mobile: path.join(outputDir, 'promo-mobile.png'),
};

const expected = {
  signalDeckTitle: 'Prediction-market infrastructure for agents that move before the market does.',
  operatorLedgerTitle: 'A promotional surface that still reads like a serious control plane.',
  protocolGardenTitle: 'The warmest version of Pandora: still sharp, but easier to grow into.',
  mcpStatus: 'Local MCP command copied. Jumping to the matching section.',
  sdkStatus: 'SDK quickstart copied. Jumping to the matching section.',
  claudeStatus: 'Claude Code copied. Opening official destination.',
  claudeUrl: 'https://claude.ai',
  protocolGardenThemeColor: '#f2efe8',
  protocolGardenDocumentTitle: 'Pandora Promotional Website Concepts · Protocol Garden',
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runningUnderNpm() {
  return Boolean(process.env.npm_execpath || process.env.npm_lifecycle_event);
}

function writeFailureHints(error) {
  if (!runningUnderNpm()) {
    return;
  }

  const message = String(error && (error.stack || error.message) ? error.stack || error.message : error || '');
  if (!/browser|chrom(e|ium)|launch|playwright|target/i.test(message)) {
    return;
  }

  process.stderr.write(
    '\nThis sandbox can abort npm-managed Chrome launches before the browser stays up.\n' +
      'If that is the only failure mode here, rerun `node scripts/check_promo_browser.cjs` directly.\n',
  );
}

function detectBrowserExecutable() {
  const candidates = [
    process.env.PROMO_BROWSER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
  assert(
    executablePath,
    'Could not find a local Chrome/Chromium executable. Set PROMO_BROWSER_EXECUTABLE_PATH to continue.',
  );
  return executablePath;
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const map = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  return map[extension] || 'application/octet-stream';
}

function attachErrorCollectors(page, issues) {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      issues.push(message.text());
    }
  });

  page.on('pageerror', (error) => {
    issues.push(error.message);
  });
}

async function createContext(browser, baseUrl, viewport) {
  const context = await browser.newContext({ viewport });
  await context.route(`${baseUrl}/**`, async (route) => {
    try {
      const requestUrl = new URL(route.request().url());

      if (requestUrl.pathname === '/favicon.ico') {
        await route.fulfill({ status: 204, body: '' });
        return;
      }

      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname === '/') {
        pathname = '/docs/promo/index.html';
      } else if (pathname.endsWith('/')) {
        pathname += 'index.html';
      }

      const filePath = path.resolve(repoRoot, `.${pathname}`);
      const isInsideRoot = filePath === repoRoot || filePath.startsWith(`${repoRoot}${path.sep}`);

      if (!isInsideRoot) {
        await route.fulfill({ status: 403, body: 'Forbidden', contentType: 'text/plain; charset=utf-8' });
        return;
      }

      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile()) {
        await route.fulfill({ status: 404, body: 'Not found', contentType: 'text/plain; charset=utf-8' });
        return;
      }

      const body = await fs.promises.readFile(filePath);
      await route.fulfill({
        status: 200,
        body,
        contentType: contentTypeFor(filePath),
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      const status = error && error.code === 'ENOENT' ? 404 : 500;
      await route.fulfill({
        status,
        body: status === 404 ? 'Not found' : 'Internal server error',
        contentType: 'text/plain; charset=utf-8',
      });
    }
  });
  await context.addInitScript(() => {
    window.__promoOpenedUrls = [];
    window.open = function promoValidationOpen(url) {
      if (url) {
        window.__promoOpenedUrls.push(String(url));
      }

      return {
        opener: null,
        closed: false,
        close() {},
        focus() {},
        location: {
          replace(nextUrl) {
            if (nextUrl) {
              window.__promoOpenedUrls.push(String(nextUrl));
            }
          },
        },
      };
    };
  });
  return context;
}

async function run() {
  assert(fs.existsSync(promoPath), `Promo entrypoint not found: ${promoPath}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const executablePath = detectBrowserExecutable();
  const baseUrl = 'http://promo.local';
  let browser;
  let desktopContext;
  let mobileContext;

  try {
    browser = await chromium.launch({ headless: true, executablePath });
    const issues = [];

    desktopContext = await createContext(browser, baseUrl, { width: 1440, height: 1100 });
    const desktopPage = await desktopContext.newPage();
    attachErrorCollectors(desktopPage, issues);
    await desktopPage.goto(`${baseUrl}/docs/promo/index.html`, { waitUntil: 'networkidle' });
    await desktopPage.screenshot({ path: screenshots.home, fullPage: true });

    const initialTitle = (await desktopPage.locator('#heroTitle').textContent()).trim();

    await desktopPage.locator('[data-variation="signal-deck"]').focus();
    await desktopPage.locator('[data-variation="signal-deck"]').press('ArrowRight');
    await desktopPage.waitForFunction(
      (title) => document.getElementById('heroTitle')?.textContent?.trim() === title,
      expected.operatorLedgerTitle,
    );
    const afterArrowRightTitle = (await desktopPage.locator('#heroTitle').textContent()).trim();
    const afterArrowRightStates = await desktopPage.locator('[data-variation]').evaluateAll((buttons) =>
      buttons.map((button) => ({
        variation: button.getAttribute('data-variation'),
        checked: button.getAttribute('aria-checked'),
        tabIndex: String(button.tabIndex),
        focused: button === document.activeElement,
      })),
    );

    await desktopPage.locator('[data-variation="operator-ledger"]').press('End');
    await desktopPage.waitForFunction(
      (title) => document.getElementById('heroTitle')?.textContent?.trim() === title,
      expected.protocolGardenTitle,
    );
    const afterEndTitle = (await desktopPage.locator('#heroTitle').textContent()).trim();

    await desktopPage.locator('[data-variation="protocol-garden"]').press('Home');
    await desktopPage.waitForFunction(
      (title) => document.getElementById('heroTitle')?.textContent?.trim() === title,
      expected.signalDeckTitle,
    );
    const afterHomeTitle = (await desktopPage.locator('#heroTitle').textContent()).trim();

    await desktopPage.locator('[data-action="mcp"]').click();
    await desktopPage.waitForFunction(
      (status) => document.getElementById('actionStatus')?.textContent?.trim() === status,
      expected.mcpStatus,
    );
    const mcpStatus = (await desktopPage.locator('#actionStatus').textContent()).trim();
    const mcpPreview = (await desktopPage.locator('#actionPreview').textContent()).trim();

    await desktopPage.locator('[data-action="sdk"]').click();
    await desktopPage.waitForFunction(
      (status) => document.getElementById('actionStatus')?.textContent?.trim() === status,
      expected.sdkStatus,
    );
    const sdkStatus = (await desktopPage.locator('#actionStatus').textContent()).trim();
    const sdkPreview = (await desktopPage.locator('#actionPreview').textContent()).trim();

    await desktopPage.locator('[data-action="claude"]').click();
    await desktopPage.waitForFunction(
      (status) => document.getElementById('actionStatus')?.textContent?.trim() === status,
      expected.claudeStatus,
    );
    const claudeStatus = (await desktopPage.locator('#actionStatus').textContent()).trim();
    const claudePreview = (await desktopPage.locator('#actionPreview').textContent()).trim();
    const openedUrls = await desktopPage.evaluate(() => window.__promoOpenedUrls || []);
    const claudePopupUrl = openedUrls[openedUrls.length - 1] || null;

    await desktopPage.screenshot({ path: screenshots.interactions, fullPage: true });

    const reviewPage = await desktopContext.newPage();
    attachErrorCollectors(reviewPage, issues);
    await reviewPage.goto(`${baseUrl}/docs/promo/index.html?variation=protocol-garden`, { waitUntil: 'networkidle' });
    await reviewPage.waitForFunction(
      (title) => document.getElementById('heroTitle')?.textContent?.trim() === title,
      expected.protocolGardenTitle,
    );
    const directLink = await reviewPage.evaluate(() => ({
      activeVariation: document.querySelector('[data-variation][aria-checked="true"]')?.getAttribute('data-variation') || null,
      bodyClass: document.body.className,
      documentTitle: document.title,
      heroTitle: document.getElementById('heroTitle')?.textContent?.trim() || null,
      themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') || null,
    }));

    mobileContext = await createContext(browser, baseUrl, { width: 390, height: 844 });
    const mobilePage = await mobileContext.newPage();
    attachErrorCollectors(mobilePage, issues);
    await mobilePage.goto(`${baseUrl}/docs/promo/index.html`, { waitUntil: 'networkidle' });
    await mobilePage.screenshot({ path: screenshots.mobile, fullPage: true });
    const narrowViewport = await mobilePage.evaluate(() => ({
      bodyScrollWidth: document.body.scrollWidth,
      heroCopyWidth: document.querySelector('.hero-copy')?.getBoundingClientRect().width ?? null,
      heroStageWidth: document.querySelector('.hero-stage')?.getBoundingClientRect().width ?? null,
      heroWidth: document.querySelector('.hero')?.getBoundingClientRect().width ?? null,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    const consoleErrors = issues.filter((issue) => !/favicon/i.test(issue));
    const report = {
      browserExecutable: executablePath,
      pageUrl: `${baseUrl}/docs/promo/index.html`,
      screenshots,
      directLink,
      variationKeyboard: {
        afterArrowRightStates,
        afterArrowRightTitle,
        afterEndTitle,
        afterHomeTitle,
      },
      ctaChecks: {
        claudePopupUrl,
        claudePreview,
        claudeStatus,
        mcpPreview,
        mcpStatus,
        sdkPreview,
        sdkStatus,
      },
      narrowViewport,
      initialTitle,
      consoleErrors,
    };

    assert(afterArrowRightTitle === expected.operatorLedgerTitle, 'ArrowRight should select Operator Ledger.');
    assert(afterEndTitle === expected.protocolGardenTitle, 'End should select Protocol Garden.');
    assert(afterHomeTitle === expected.signalDeckTitle, 'Home should return to Signal Deck.');
    assert(mcpStatus === expected.mcpStatus, 'MCP CTA status did not update as expected.');
    assert(sdkStatus === expected.sdkStatus, 'SDK CTA status did not update as expected.');
    assert(claudeStatus === expected.claudeStatus, 'Claude CTA status did not update as expected.');
    assert(claudePopupUrl === expected.claudeUrl, 'Claude CTA should resolve to https://claude.ai.');
    assert(directLink.activeVariation === 'protocol-garden', 'Protocol Garden direct review link should hydrate the matching variation.');
    assert(directLink.documentTitle === expected.protocolGardenDocumentTitle, 'Direct review link should update the document title.');
    assert(directLink.heroTitle === expected.protocolGardenTitle, 'Direct review link should update the hero title.');
    assert(directLink.themeColor === expected.protocolGardenThemeColor, 'Direct review link should update the theme color metadata.');
    assert(narrowViewport.horizontalOverflow === false, 'Promo page should not overflow horizontally at 390px width.');
    assert(consoleErrors.length === 0, `Browser validation reported console errors: ${consoleErrors.join(' | ')}`);

    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (mobileContext) {
      await mobileContext.close();
    }

    if (desktopContext) {
      await desktopContext.close();
    }

    if (browser) {
      await browser.close();
    }
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  writeFailureHints(error);
  process.exit(1);
});
