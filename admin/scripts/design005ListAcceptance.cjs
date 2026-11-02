const { chromium } = require(process.argv[2]);
const { clickWithVisiblePointer, visibleListAction } = require('./design005Pointer.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const out = 'evidence/design-005-2026-11-01';
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/Nutzer/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe' });
  const result = { fixtureOnly: true, runs: [] };
  try {
    for (const width of (process.env.DESIGN_TEST_WIDTH ? [Number(process.env.DESIGN_TEST_WIDTH)] : [390, 1440])) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(20000);
      await page.route('**/*', async route => {
        const r = route.request(), u = new URL(r.url());
        if (r.method() !== 'GET') return route.fulfill({ status: 204, body: '' });
        if (u.pathname.startsWith('/api/')) return route.fulfill({ response: await page.request.get('http://127.0.0.1:4239' + u.pathname + u.search) });
        return u.hostname === '127.0.0.1' ? route.continue() : route.abort();
      });
      const run = { width, passed: [] }; result.runs.push(run);
      await page.goto('http://127.0.0.1:4238/', { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Verstanden', exact: true }).click();
      await page.goto('http://127.0.0.1:4238/suche?q=waschmittel', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 60);
      await page.locator('.load-more-results__button').click();
      await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 120);
      run.passed.push('pagination 60/120'); console.log(width, 'pagination 60/120');
      const selected = await visibleListAction(page);
      const add = selected.button;
      run.selected = { title: selected.title, index: selected.index };
      run.pointer = await clickWithVisiblePointer(page, add);
      await page.waitForFunction(index => document.querySelectorAll('article.user-card')[index].querySelector('.shopping-list-button').disabled, selected.index);
      assert.match(await add.innerText(), /Auf der Einkaufsliste/);
      run.passed.push('visible selected article added by normal pointer'); console.log(width, 'visible selected article added by normal pointer');
      await page.locator('.page-nav__main a[href*="einkaufsliste"]').click();
      await page.waitForURL('**/einkaufsliste');
      await page.getByText(selected.title, { exact: true }).waitFor();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByText(selected.title, { exact: true }).waitFor();
      run.passed.push('list reload restored exact article'); console.log(width, 'list reload restored exact article');
      await page.screenshot({ path: `${out}/list-${width}.png`, timeout: 15000 });
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await page.waitForURL('**/suche?q=waschmittel');
      await page.goForward({ waitUntil: 'domcontentloaded' });
      await page.waitForURL('**/einkaufsliste');
      await page.getByText(selected.title, { exact: true }).waitFor();
      run.passed.push('history restored list'); console.log(width, 'history restored list');
      await clickWithVisiblePointer(page, page.locator('.shopping-list-item__remove').first());
      await page.getByRole('heading', { name: 'Noch keine Angebote gemerkt.', exact: true }).waitFor();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.app-shell');
      assert.equal(await page.getByText(selected.title, { exact: true }).count(), 0);
      run.passed.push('remove and reload persist empty list'); console.log(width, 'remove and reload persist empty list');
      await page.goto('http://127.0.0.1:4238/suche?q=waschmittel', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 60);
      if (selected.index >= 60) {
        await page.locator('.load-more-results__button').click();
        await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 120);
      }
      const restoredCard = page.locator('article.user-card').nth(selected.index);
      const restored = restoredCard.locator('.shopping-list-button');
      // Offscreen content-visibility:auto cards may be absent from the AX tree.
      // Inspect the exact restored DOM identity/state without forcing its rendering.
      const restoredTitle = await restoredCard.locator('h3 > span').first().textContent();
      assert.equal(restoredTitle.trim(), selected.title);
      assert.equal(await restored.getAttribute('disabled'), null);
      assert.match(await restored.textContent(), /Auf die Einkaufsliste/);
      run.passed.push('search add action restored after removal'); console.log(width, 'search add action restored after removal');
      await page.close();
      await fs.writeFile(`${out}/list-acceptance.json`, JSON.stringify(result, null, 2));
    }
  } catch (e) { result.blocker = e.message; process.exitCode = 1; }
  finally { await fs.writeFile(`${out}/list-acceptance.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); await browser.close(); }
})();
