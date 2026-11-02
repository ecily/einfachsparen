// Local test helper: real wheel/mouse input, no forced click, DOM mutation or dispatchEvent.
async function clickWithVisiblePointer(page, locator) {
  const observations = [];
  // Offscreen cards use content-visibility:auto. Scroll the rendered card box
  // into view before resolving geometry/actionability of its skipped children.
  const card = locator.locator('xpath=ancestor::article[1]');
  let cardBefore = null;
  if (await card.count()) {
    cardBefore = await card.evaluate(e => ({ y: e.getBoundingClientRect().y,
      contentVisibility: getComputedStyle(e).contentVisibility,
      intrinsicSize: getComputedStyle(e).containIntrinsicSize }));
    for (let attempt = 0; attempt < 24; attempt++) {
      const box = await card.boundingBox();
      if (!box) throw Error('Card detached during wheel scroll');
      const viewport = page.viewportSize();
      if (box.y >= 180 && box.y < viewport.height - 220) break;
      await page.mouse.wheel(0, Math.max(-1800, Math.min(1800, box.y - 240)));
      await page.waitForTimeout(120);
      if (attempt === 23) throw Error('Could not reach card with wheel');
    }
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const state = await locator.evaluate(e => {
      const r = e.getBoundingClientRect(), s = getComputedStyle(e);
      return { x: r.x, y: r.y, width: r.width, height: r.height,
        viewportHeight: innerHeight, disabled: e.disabled,
        display: s.display, visibility: s.visibility };
    });
    observations.push(state);
    if (state.disabled) throw Error('Pointer target disabled before click');
    if (state.width <= 0 || state.height <= 0 || state.display === 'none' || state.visibility !== 'visible') throw Error('Pointer target hidden');
    const center = state.y + state.height / 2;
    if (center > 180 && center < state.viewportHeight - 100) break;
    await page.mouse.wheel(0, Math.max(-1800, Math.min(1800, center - state.viewportHeight / 2)));
    await page.waitForTimeout(120);
    if (attempt === 19) throw Error('Could not reach pointer target with wheel');
  }
  let stable = 0, previous = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const box = await locator.boundingBox();
    if (!box) throw Error('Pointer target detached');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const state = await locator.evaluate(e => {
      const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { x: r.x, y: r.y, width: r.width, height: r.height,
        hit: hit === e || e.contains(hit), disabled: e.disabled };
    });
    const same = previous && ['x', 'y', 'width', 'height'].every(k => Math.abs(state[k] - previous[k]) < 0.5);
    stable = same && state.hit && !state.disabled ? stable + 1 : 0;
    previous = state;
    if (stable >= 3) {
      await locator.click({ timeout: 20000 });
      return { cardBefore, wheelSteps: observations.length - 1, before: observations[0], clickState: state };
    }
    await page.waitForTimeout(120);
  }
  throw Error('Pointer target never became stable and unobscured');
}
async function visibleListAction(page) {
  const index = await page.locator('article.user-card').evaluateAll(cards => {
    const positions = cards.map((e, index) => ({ index, rect: e.getBoundingClientRect() }));
    return positions.find(({ rect }) => rect.top >= 180 && rect.bottom <= innerHeight - 80)?.index
      ?? positions.find(({ rect }) => rect.top < innerHeight - 120 && rect.bottom > 220)?.index ?? -1;
  });
  if (index < 0) throw Error('No visible offer card after pagination');
  const card = page.locator('article.user-card').nth(index);
  const title = await card.locator('h3').innerText();
  return { button: card.locator('.shopping-list-button'), title, index };
}
module.exports = { clickWithVisiblePointer, visibleListAction };
