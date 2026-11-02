// Independent local-only Chromium acceptance. Usage: node script <playwright-core path>.
const { chromium } = require(process.argv[2]);
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const out = path.resolve(__dirname, '../../evidence/design-003-2026-11-01');
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/Nutzer/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe' });
  const results = { fixtureOnly: true, matrix: [], interactions: [], errors: [] };
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      return ['127.0.0.1', 'localhost'].includes(u.hostname) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => results.errors.push(e.message));
    for (const width of [320, 375, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [name, url] of [['home','/'], ['search','/suche?q=waschmittel'], ['top-deals','/top-deals/'], ['list','/einkaufsliste'], ['browse','/stoebern?retailers=dm,bipa'], ['landing','/angebote/billa/'], ['unknown','/angebote/unknown/top-deals/']]) {
        await page.goto(`http://127.0.0.1:4228${url}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.app-shell .page-nav__main');
        await page.waitForTimeout(200);
        const info = await page.evaluate(() => ({
          url: location.pathname + location.search,
          width: innerWidth, scroll: document.documentElement.scrollWidth,
          mainCount: document.querySelectorAll('main').length,
          h1Count: document.querySelectorAll('h1').length,
          primaryLinks: document.querySelectorAll('.page-nav__main a').length,
          canonical: document.querySelector('link[rel="canonical"]')?.href || null,
          robots: document.querySelector('meta[name="robots"]')?.content || '',
          cards: document.querySelectorAll('article.user-card').length,
          qualityStates: [...document.querySelectorAll('.category-map__tile')].map(e => e.dataset.evidence),
        }));
        console.log('CAPTURE', name, width);
        await page.screenshot({ animations: 'disabled', timeout: 10000, path: path.join(out, `${name}-${width}-viewport.png`), fullPage: false });
        results.matrix.push({ name, ...info, noOverflow: info.scroll <= width });
        await fs.writeFile(path.join(out, 'browser-results.json'), JSON.stringify(results, null, 2));
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://127.0.0.1:4228/suche?q=waschmittel', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 60);
    const more = page.locator('.load-more-results__button');
    await more.click();
    await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 120);
    await more.click();
    await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 135);
    results.interactions.push('search pagination 60/120/135');
    await page.getByRole('button', { name: /Auf die Einkaufsliste/ }).first().click();
    await page.locator('.page-nav__main a[href*="einkaufsliste"]').click();
    await page.waitForURL('**/einkaufsliste');
    await page.reload();
    await page.waitForSelector('.app-shell .page-nav__main');
        await page.waitForTimeout(200);
    results.interactions.push({ listAfterReload: (await page.locator('main').innerText()).includes('UX Test Waschmittel') });
    await page.goBack();
    await page.waitForURL('**/suche?q=waschmittel');
    await page.goForward();
    await page.waitForURL('**/einkaufsliste');
    results.interactions.push('back/forward preserved search URL and list');
    await page.goto('http://127.0.0.1:4228/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.app-shell .page-nav__main');
        await page.waitForTimeout(200);
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => ({ text: document.activeElement.textContent, outline: getComputedStyle(document.activeElement).outlineStyle }));
    results.interactions.push({ keyboardFirstFocus: focus });
    await page.keyboard.press('Enter');
    results.interactions.push({ skipTarget: await page.evaluate(() => document.activeElement.id) });
    await page.locator('.category-map__tile[href]').click();
    await page.waitForURL('**/stoebern?**');
    results.interactions.push({ heatmapDeepLink: new URL(page.url()).pathname + new URL(page.url()).search });
    assert.ok(results.matrix.every(row => row.mainCount === 1 && row.primaryLinks === 3));
  } catch (error) {
    results.blocker = error.message;
  } finally {
    await fs.writeFile(path.join(out, 'browser-results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ rows: results.matrix.length, overflow: results.matrix.filter(r => !r.noOverflow).map(r => `${r.name}/${r.width}`), interactions: results.interactions, errors: results.errors, blocker: results.blocker || null }));
    await browser.close();
  }
})().catch(() => { process.exitCode = 1; });
