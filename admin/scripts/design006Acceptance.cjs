// Controlled release acceptance: public GETs only; list writes stay in a fresh browser.
const { chromium } = require(process.argv[2]);
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { clickWithVisiblePointer, visibleListAction } = require('./design005Pointer.cjs');
const base = process.argv[3];
const fixture = process.argv[4] || '';
const out = `evidence/design-006-2026-11-02/${fixture ? 'local' : 'live'}`;
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/Nutzer/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe' });
  const result = { base, fixture: Boolean(fixture), views: [], runs: [], pageErrors: [], api5xx: [], blockedWrites: 0 };
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(30000);
      page.on('pageerror', e => result.pageErrors.push(e.message));
      page.on('response', r => { if (r.status() >= 500 && new URL(r.url()).pathname.startsWith('/api/')) result.api5xx.push(new URL(r.url()).pathname); });
      await page.route('**/*', async route => {
        const req = route.request(), u = new URL(req.url());
        if (req.method() !== 'GET') { result.blockedWrites++; return route.fulfill({ status: 204, body: '' }); }
        if (fixture && u.pathname.startsWith('/api/')) {
          try { return await route.fulfill({ response: await route.fetch({ url: fixture + u.pathname + u.search, maxRetries: 2 }) }); }
          catch (error) {
            if (!page.isClosed()) result.pageErrors.push(`Fixture transport: ${error.message}`);
            return route.abort().catch(() => {});
          }
        }
        if (fixture && !['127.0.0.1', 'localhost'].includes(u.hostname)) return route.abort();
        return route.continue();
      });
      const go = async path => { await page.goto(base + path, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('.app-shell'); };
      const cards = n => page.waitForFunction(n => document.querySelectorAll('article.user-card').length === n, n);
      const run = { width, passed: [] }; result.runs.push(run);
      await go('/');
      const cookie = page.getByRole('button', { name: 'Verstanden', exact: true });
      if (await cookie.count()) await cookie.click();
      await page.waitForFunction(() => document.querySelector('.category-map[aria-busy="false"]'));
      const home = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, evidence: [...document.querySelectorAll('.category-map__tile')].map(e => e.dataset.evidence), tiles: [...document.querySelectorAll('.category-map__tile')].map(e => ({ text: e.textContent, href: e.getAttribute('href') })) }));
      assert.ok(home.scroll <= width); assert.equal(home.evidence.length, 5); assert.ok(home.evidence.every(e => e === 'unknown'));
      result.views.push({ name: 'home', ...home });
      await page.screenshot({ path: `${out}/home-${width}.png`, timeout: 20000 });
      const category = page.locator('.category-map__tile[href]').first();
      assert.ok(await category.count());
      const categoryHref = await category.getAttribute('href');
      await category.click(); await page.waitForURL('**/stoebern?**');
      assert.equal(new URL(page.url()).search, new URL(categoryHref, base).search);
      await page.waitForFunction(() => document.querySelectorAll('article.user-card').length > 0);
      run.passed.push('neutral category opens complete browse selection');
      await go('/suche?q=waschmittel'); await cards(60);
      await page.locator('.load-more-results__button').click(); await cards(120);
      run.passed.push('pagination 60/120');
      const selected = await visibleListAction(page);
      const card = page.locator('article.user-card').nth(selected.index);
      const title = (await card.locator('h3 > span').first().textContent()).trim();
      run.selected = { title, index: selected.index };
      run.pointer = await clickWithVisiblePointer(page, selected.button);
      assert.equal(await selected.button.isDisabled(), true);
      await page.locator('.page-nav__main a[href*="einkaufsliste"]').click();
      await page.waitForURL('**/einkaufsliste'); await page.getByText(title, { exact: true }).waitFor();
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByText(title, { exact: true }).waitFor();
      await page.goBack({ waitUntil: 'domcontentloaded' }); await page.waitForURL('**/suche?q=waschmittel');
      await page.goForward({ waitUntil: 'domcontentloaded' }); await page.waitForURL('**/einkaufsliste');
      await page.getByText(title, { exact: true }).waitFor();
      run.passed.push('exact selected article add/reload/history');
      await clickWithVisiblePointer(page, page.locator('.shopping-list-item__remove').first());
      await page.getByRole('heading', { name: 'Noch keine Angebote gemerkt.', exact: true }).waitFor();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Noch keine Angebote gemerkt.', exact: true }).waitFor();
      run.passed.push('remove and reload persist empty list');
      await go('/suche?q=waschmittel'); await cards(60);
      await page.locator('.keyword-search-sort select').selectOption('retailer');
      await page.waitForURL('**/suche?q=waschmittel&sort=retailer');
      await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 60 && !document.querySelector('.keyword-search-sort-progress'));
      await page.locator('.load-more-results__button').click(); await cards(120);
      await page.reload({ waitUntil: 'domcontentloaded' }); await cards(60);
      assert.equal(new URL(page.url()).searchParams.get('sort'), 'retailer');
      run.passed.push('retailer sort/pagination/reload');
      await go('/suche?q=waschmittel&markets=dm'); await cards(60);
      assert.equal(await page.locator('article.user-card:not([data-retailer-key="dm"])').count(), 0);
      await page.reload({ waitUntil: 'domcontentloaded' }); await cards(60);
      assert.equal(new URL(page.url()).searchParams.get('markets'), 'dm');
      run.passed.push('market filter/reload');
      await go('/top-deals/');
      await page.waitForFunction(() => document.querySelectorAll('article.user-card').length > 0);
      const deals = await page.locator('article.user-card').count(); assert.ok(deals <= 20); run.topDeals = deals;
      await go('/angebote/unknown/top-deals/');
      const unknown = await page.evaluate(() => ({ robots: document.querySelector('meta[name="robots"]')?.content, canonical: document.querySelector('link[rel="canonical"]')?.href || null }));
      assert.match(unknown.robots, /noindex/); assert.equal(unknown.canonical, null);
      run.passed.push('top deals cap and unknown noindex/no canonical');
      await page.close();
      await fs.writeFile(`${out}/results.json`, JSON.stringify(result, null, 2));
      console.log(width, run.passed);
    }
    assert.equal(result.pageErrors.length, 0); assert.equal(result.api5xx.length, 0);
  } catch (e) { result.blocker = e.message; process.exitCode = 1; }
  finally { await fs.writeFile(`${out}/results.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); await browser.close(); }
})();
