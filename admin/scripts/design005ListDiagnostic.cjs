const { chromium } = require(process.argv[2]);
const fs = require('node:fs/promises');
const out = 'evidence/design-005-2026-11-01';
(async () => {
  await fs.mkdir(out, { recursive: true }); console.log('START');
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/Nutzer/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe' });
  console.log('BROWSER'); const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(20000);
  const result = { snapshots: [], pageErrors: [] };
  page.on('pageerror', e => result.pageErrors.push(e.message));
  await page.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    if (req.method() !== 'GET') return route.fulfill({ status: 204, body: '' });
    if (u.pathname.startsWith('/api/')) return route.fulfill({ response: await page.request.get('http://127.0.0.1:4239' + u.pathname + u.search) });
    if (u.hostname !== '127.0.0.1') return route.abort();
    return route.continue();
  });
  const snapshot = () => page.locator('.shopping-list-button').first().evaluate(e => {
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const cover = document.elementFromPoint(x, y);
    return { time: performance.now(), rect: r.toJSON(), disabled: e.disabled, connected: e.isConnected,
      display: s.display, visibility: s.visibility, opacity: s.opacity, pointerEvents: s.pointerEvents,
      animations: e.getAnimations().map(a => ({ state: a.playState })), fonts: document.fonts.status,
      scroll: scrollY, viewport: [innerWidth, innerHeight], hitOwn: cover === e || e.contains(cover),
      hitClass: cover?.className || null, text: e.textContent };
  });
  try {
    console.log('HOME'); await page.goto('http://127.0.0.1:4238/', { waitUntil: 'domcontentloaded', timeout: 10000 }); console.log('COOKIE');
    await page.getByRole('button', { name: 'Verstanden', exact: true }).click();
    console.log('SEARCH'); await page.goto('http://127.0.0.1:4238/suche?q=waschmittel', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 60);
    console.log('MORE'); await page.locator('.load-more-results__button').click();
    await page.waitForFunction(() => document.querySelectorAll('article.user-card').length === 120);
    console.log('SNAPSHOTS'); for (let i = 0; i < 5; i++) { result.snapshots.push(await snapshot()); await page.waitForTimeout(100); }
    console.log('CLICK'); const click = page.locator('.shopping-list-button').first().click({ timeout: 5000 }).then(() => ({ success: true }), e => ({ success: false, error: e.message }));
    for (let i = 0; i < 10; i++) { result.snapshots.push(await snapshot()); await page.waitForTimeout(100); }
    result.click = await click;
    result.after = await snapshot();
    await page.screenshot({ path: `${out}/diagnostic.png`, timeout: 10000 });
  } catch (e) { result.error = e.message; }
  finally { await fs.writeFile(`${out}/diagnostic.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); await browser.close(); }
})();
