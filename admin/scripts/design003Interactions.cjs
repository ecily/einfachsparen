const { chromium } = require(process.argv[2]);
const fs = require('node:fs/promises');
const base = 'http://127.0.0.1:4228';
const file = 'evidence/design-003-2026-11-01/flows.json';
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/Nutzer/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe' });
  const result = { fixtureOnly: true, passed: [], observations: {} };
  const check = async (label, fn) => {
    await fn(); result.passed.push(label);
    await fs.writeFile(file, JSON.stringify(result, null, 2));
  };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(12000);
    await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    const go = async url => { await page.goto(base + url, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('.app-shell'); };
    await go('/');
    await page.getByRole('button', { name: 'Verstanden', exact: true }).click();
    await check('skip link focus and main target', async () => {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement.textContent) !== 'Zum Hauptinhalt') throw Error('skip link not first');
      await page.keyboard.press('Enter');
      if (await page.evaluate(() => document.activeElement.id) !== 'main-content') throw Error('main not focused');
    });
    await check('neutral heatmap deep link uses all fixture markets and category', async () => {
      await page.locator('.category-map__tile[href]').click();
      await page.waitForURL('**/stoebern?**');
      const u = new URL(page.url());
      if (u.searchParams.get('categories') !== 'main:drogerie-hygiene' || u.searchParams.get('retailers') !== 'dm,bipa') throw Error('scope lost');
    });
    await go('/suche?q=waschmittel');
    await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 60);
    await check('search pagination 60/120/135', async () => {
      for (const count of [120, 135]) {
        await page.locator('.load-more-results__button').click();
        await page.waitForFunction(n => document.querySelectorAll('article.user-card').length === n, count);
      }
    });
    result.observations.cardSemantics = await page.locator('article.user-card').first().ariaSnapshot();
    await check('add to list and reload persistence', async () => {
      await page.locator('.shopping-list-button').first().click();
      await page.locator('.page-nav__main a[href*="einkaufsliste"]').click();
      await page.waitForURL('**/einkaufsliste');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByText('UX Test Waschmittel 1', { exact: true }).waitFor();
    });
    await check('back/forward preserves search and list', async () => {
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await page.waitForURL('**/suche?q=waschmittel');
      await page.goForward({ waitUntil: 'domcontentloaded' });
      await page.waitForURL('**/einkaufsliste');
    });
    await go('/suche?q=waschmittel');
    await check('global retailer sort retains pagination and URL', async () => {
      await page.locator('.keyword-search-sort select').selectOption('retailer');
      await page.waitForURL('**/suche?q=waschmittel&sort=retailer');
      await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 60 && !document.querySelector('.keyword-search-sort-progress'));
      await page.locator('.load-more-results__button').click();
      await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 120);
    });
    await go('/suche?q=waschmittel&markets=dm');
    await check('market filter URL and complete 68-result scope', async () => {
      await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 60);
      await page.locator('.load-more-results__button').click();
      await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 68);
      if (await page.locator('article[data-retailer-key="bipa"]').count()) throw Error('wrong market');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 60);
    });
    await go('/top-deals/');
    await check('top deals remains 20', async () => { await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 20); });
  } catch (error) { result.blocker = error.message; }
  finally {
    await fs.writeFile(file, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ passed: result.passed, blocker: result.blocker || null }));
    await browser.close();
  }
})();
