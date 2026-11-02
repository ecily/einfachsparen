// Read-only API smoke; list interaction stays in this fresh browser context.
const { chromium } = require(process.argv[2]);
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { clickWithVisiblePointer, visibleListAction } = require('./design005Pointer.cjs');
const base = process.argv[3];
const label = process.argv[4];
const fixture = process.argv[5] || '';
const out = `evidence/design-004-2026-11-01/${label}`;
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/Nutzer/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe' });
  const result = { base, fixture: Boolean(fixture), views: [], flows: [], pageErrors: [], api5xx: [], blockedWrites: 0 };
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', e => result.pageErrors.push(e.message));
    page.on('response', r => { if (r.status() >= 500 && new URL(r.url()).pathname.startsWith('/api/')) result.api5xx.push(new URL(r.url()).pathname); });
    await page.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url());
      if (req.method() !== 'GET') { result.blockedWrites++; return route.fulfill({ status: 204, body: '' }); }
      if (fixture && u.pathname.startsWith('/api/')) return route.fulfill({ response: await page.request.get(fixture + u.pathname + u.search) });
      if (fixture && !['localhost', '127.0.0.1'].includes(u.hostname)) return route.abort();
      return route.continue();
    });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [name, path] of [['home','/'], ['search','/suche?q=waschmittel'], ['top-deals','/top-deals/'], ['list','/einkaufsliste'], ['unknown','/angebote/unknown/top-deals/']]) {
        await page.goto(base + path, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.app-shell');
        if (name === 'search') await page.waitForFunction(() => document.querySelectorAll('article.user-card').length > 0);
        if (name === 'top-deals') await page.waitForFunction(() => document.querySelectorAll('article.user-card').length > 0);
        const row = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, navCount: document.querySelectorAll('.page-nav__main a').length, canonical: document.querySelector('link[rel="canonical"]')?.href || null, robots: document.querySelector('meta[name="robots"]')?.content, cards: document.querySelectorAll('article.user-card').length, evidence: [...document.querySelectorAll('.category-map__tile')].map(e => e.dataset.evidence) }));
        assert.equal(row.navCount, 3); assert.ok(row.scroll <= width);
        if (name === 'unknown') { assert.match(row.robots, /noindex/); assert.equal(row.canonical, null); }
        if (name === 'top-deals') assert.ok(row.cards <= 20);
        if (name === 'home') assert.ok(row.evidence.every(value => value === 'unknown'));
        result.views.push({ name, ...row });
        if (name === 'home') {
          const cookie = page.getByRole('button', { name: 'Verstanden', exact: true });
          if (await cookie.count()) await cookie.click();
          await page.screenshot({ path: `${out}/home-${width}.png`, timeout: 15000 });
        }
      }
    }
    await page.goto(base + '/suche?q=waschmittel', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 60);
    await page.locator('.load-more-results__button').click();
    await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 120);
    result.flows.push('pagination 60/120');
    const selected = await visibleListAction(page);
    await clickWithVisiblePointer(page, selected.button);
    await page.waitForFunction(index => document.querySelectorAll('article.user-card')[index].querySelector('.shopping-list-button').disabled, selected.index);
    await page.locator('.page-nav__main a[href*="einkaufsliste"]').click();
    await page.waitForURL('**/einkaufsliste');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.shopping-check');
    result.flows.push('local list add/reload');
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/suche?q=waschmittel');
    await page.goForward({ waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/einkaufsliste');
    result.flows.push('history back/forward');
    assert.equal(result.pageErrors.length, 0); assert.equal(result.api5xx.length, 0);
  } catch (error) { result.blocker = error.message; process.exitCode = 1; }
  finally { await fs.writeFile(`${out}/results.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); await browser.close(); }
})();
