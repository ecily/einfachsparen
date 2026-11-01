const test = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const { __private } = require('../src/services/crawl/officialSourceCrawler');
const { determineCategoryDecision } = require('../src/services/crawl/categoryClassifier');
const { isPublicValidityEligible } = require('../src/services/offers/publicValidity');
const { buildRankedOffer } = require('../src/services/offers/offerRankingService');
const { buildCandidateDecision } = require('../src/services/offers/topDealsService');

function parse(body, extra = {}) {
  return __private.parseBipaOffersFromHtml({
    html: `<html><body>${body}</body></html>`,
    source: { _id: new Types.ObjectId(), retailerKey: 'bipa', retailerName: 'BIPA', channel: 'official-site', sourceUrl: 'https://www.bipa.at/cp/onlineonly' },
    crawlJobId: new Types.ObjectId(), region: 'AT', pageUrl: 'https://www.bipa.at/cp/onlineonly', ...extra,
  });
}
function card(date = '') {
  return `<a href="/p/dipping-powder/B3-514819"><p>DOONAILS</p><p>Dipping Powder Espresso</p><p>15 g</p><p>€ 15,99</p><p>€ 3,00</p>${date}</a>`;
}

function parseValidityFixture(path, label, { footer = '', badges = [], tileCount = 1, productLinkId = '514819', wrapper = '' } = {}) {
  const wrap = (html) => wrapper ? `<${wrapper}>${html}</${wrapper}>` : html;
  if (path === 'legacy') return parse(`${wrap(card(`<span>${label}</span>`))}${footer}`)[0];
  const hit = {
    productId: 'B3-514819', productName: 'Dipping Powder Espresso', c_brand: 'DOONAILS',
    c_kundenbezeichnung: 'Dipping Powder Espresso', c_inhalt: '15 g',
    c_displayedPrice: 3, c_insteadPrice: 15.99, c_effectiveCornerBadges: badges,
  };
  const payload = { pageProps: { pageProps: { productSearchResult: { hits: [hit] } } } };
  const tile = `<a data-testid="product-tile-B3-514819" href="/p/powder/B3-${productLinkId}">Dipping Powder Espresso<span>${label}</span></a>`;
  return parse(`${wrap(tile.repeat(tileCount))}${footer}<script id="mobify-data" type="application/json">${JSON.stringify(payload)}</script>`)[0];
}

test('BIPA ignores page, footer and caller-wide validity hints including SALE exclusions', () => {
  for (const footer of ['<p>Gültig bis 11.11.2099. Ausgenommen SALE-Produkte.</p>', '<footer>Gültig bis 26.11.2099</footer>']) {
    const [offer] = parse(`${card()}${footer}`, { validToHint: new Date('2099-11-11T23:59:59Z') });
    assert.equal(offer.validTo, null);
    assert.equal(offer.rawFacts.snapshotCurrent, true);
  }
});

test('BIPA product-local dates use Vienna end of day in winter, summer and on DST transitions', () => {
  for (const [date, expected] of [
    ['15.01.2099', '2099-01-15T22:59:59.999Z'],
    ['15.07.2099', '2099-07-15T21:59:59.999Z'],
    ['29.03.2026', '2026-03-29T21:59:59.999Z'],
    ['25.10.2026', '2026-10-25T22:59:59.999Z'],
  ]) {
    const [offer] = parse(card(`<span>Aktionspreis gültig bis ${date}</span>`));
    assert.equal(offer.validTo.toISOString(), expected, date);
  }
});

test('BIPA ambiguous, impossible and excluded product-local dates stay unknown', () => {
  for (const text of ['Gültig bis 31.02.2099', 'Gültig bis 11.11.2099 und Gültig bis 26.11.2099', 'SALE – Gültig bis 11.11.2099. Ausgenommen SALE-Produkte.', '*⁴ Gültig bis 11.11.2099']) {
    assert.equal(parse(card(`<span>${text}</span>`))[0].validTo, null, text);
  }
});

test('BIPA Mobify dates belong only to the uniquely identified product tile', () => {
  const hits = ['514819', '514820'].map((id) => ({
    productId: `B3-${id}`, productName: 'Dipping Powder Espresso', c_brand: 'DOONAILS',
    c_kundenbezeichnung: 'Dipping Powder Espresso', c_inhalt: '15 g',
    c_displayedPrice: 3, c_insteadPrice: 15.99,
  }));
  const payload = { pageProps: { pageProps: { productSearchResult: { hits } } } };
  const tiles = hits.map((hit, index) => `<a data-testid="product-tile-${hit.productId}" href="/p/powder/${hit.productId}">${hit.productName}${index ? '' : '<span>Aktionspreis gueltig bis 15.07.2099</span>'}</a>`).join('');
  const offers = parse(`${tiles}<footer>Gueltig bis 11.11.2099. Ausgenommen SALE.</footer><script id="mobify-data" type="application/json">${JSON.stringify(payload)}</script>`);
  assert.equal(offers.length, 2);
  assert.equal(offers[0].validTo.toISOString(), '2099-07-15T21:59:59.999Z');
  assert.equal(offers[1].validTo, null);
  assert.equal(offers[0].categoryPrimary, 'Drogerie / Hygiene');
});

for (const path of ['legacy', 'mobify']) {
  test(`BIPA ${path}: exact Vienna price deadlines, calendar dates and DST transitions`, (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01T12:00:00Z') });
    for (const [label, expected] of [
      ['Aktionspreis gültig bis 15.07.2099, 12:00 Uhr', '2099-07-15T10:00:00.000Z'],
      ['Angebotspreis gueltig bis 15.01.2099 um 12:00 Uhr', '2099-01-15T11:00:00.000Z'],
      ['Produktpreis gültig bis 15.07.2099, 12:34:56 Uhr', '2099-07-15T10:34:56.000Z'],
      ['Preis gültig bis 15.01.2099', '2099-01-15T22:59:59.999Z'],
      ['Preis gültig bis 15.07.2099', '2099-07-15T21:59:59.999Z'],
      ['Preis gültig bis 29.02.2028', '2028-02-29T22:59:59.999Z'],
      ['Preis gültig bis 29.03.2026, 01:30 Uhr', '2026-03-29T00:30:00.000Z'],
      ['Preis gültig bis 29.03.2026, 03:30 Uhr', '2026-03-29T01:30:00.000Z'],
      ['Preis gültig bis 25.10.2026, 01:30 Uhr', '2026-10-24T23:30:00.000Z'],
      ['Preis gültig bis 25.10.2026, 03:30 Uhr', '2026-10-25T02:30:00.000Z'],
      ['Preis gültig bis 15.07.2099, 00:00 Uhr', '2099-07-14T22:00:00.000Z'],
    ]) {
      assert.equal(parseValidityFixture(path, label).validTo?.toISOString(), expected, label);
    }
  });

  test(`BIPA ${path}: ambiguous, unrelated and excluded deadlines remain unknown`, (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01T12:00:00Z') });
    for (const label of [
      'Gültig bis 15.07.2099, 12:00 Uhr',
      'Gutschein: Gültig bis 15.07.2099',
      'Gutschein: Aktionspreis gültig bis 15.07.2099',
      'Coupon: Produktpreis gültig bis 15.07.2099',
      'SALE: Preis gültig bis 15.07.2099. Ausgenommen SALE-Produkte.',
      'SALE Preis gültig bis 15.07.2099',
      'Preis gültig bis 15.07.2099*',
      'Preis gültig bis 15.07.2099<sup>4</sup>',
      'Preis gültig bis 15.07.2099; Preis gültig bis 16.07.2099',
      'Preis gültig bis 15.07.2099; Preis gültig bis 15.07.2099',
      'Preis gültig bis 29.02.2027',
      'Preis gültig bis 31.02.2099',
      'Preis gültig bis 15.07.2099, 24:00 Uhr',
      'Preis gültig bis 15.07.2099, 12:60 Uhr',
      'Preis gültig bis 15.07.2099, 12:00:60 Uhr',
      'Preis gültig bis 15.07.2099, 12 Uhr',
      'Preis gültig bis 15.07.2099, 12:00 oder 14:00 Uhr',
      'Preis gültig bis 15.07.2099, 12:00 Uhr MESZ',
      'Preis gültig bis 29.03.2026, 02:30 Uhr',
      'Preis gültig bis 25.10.2026, 02:30 Uhr',
    ]) assert.equal(parseValidityFixture(path, label).validTo, null, label);
    assert.equal(parseValidityFixture(path, '', { footer: '<footer>Aktionspreis gültig bis 15.07.2099</footer>' }).validTo, null);
    for (const wrapper of ['footer', 'nav']) {
      assert.equal(parseValidityFixture(path, 'Preis gültig bis 15.07.2099', { wrapper }).validTo, null);
    }
    if (path === 'mobify') {
      assert.equal(parseValidityFixture(path, 'Preis gültig bis 15.07.2099', { badges: ['SALE'] }).validTo, null);
      assert.equal(parseValidityFixture(path, 'Preis gültig bis 15.07.2099', { tileCount: 2 }).validTo, null);
      assert.equal(parseValidityFixture(path, 'Preis gültig bis 15.07.2099', { productLinkId: '514820' }).validTo, null);
    }
  });

  test(`BIPA ${path}: explicit cutoffs and unknown validity retain Public-Validity and Top Deals guards`, (t) => {
    const now = new Date('2026-07-15T09:00:00Z');
    t.mock.timers.enable({ apis: ['Date'], now });
    const confirm = (offer) => ({
      ...offer, sourceRunStatus: 'success', publishStatus: 'crawl-run-success',
      sourceType: 'bipa-official-onlineonly', crawlRunId: 'run', lastSeenRunId: 'run', lastSeenAt: now,
      priceReferenceSource: 'prospect', priceReferenceConfidence: 0.95,
    });
    const explicit = confirm(parseValidityFixture(path, 'Aktionspreis gültig bis 15.07.2026, 12:00 Uhr'));
    const cutoff = new Date('2026-07-15T10:00:00Z');
    assert.equal(isPublicValidityEligible(explicit, cutoff).eligible, true);
    assert.equal(buildCandidateDecision(explicit, now).accepted, true);
    const after = new Date(cutoff.getTime() + 1);
    assert.equal(isPublicValidityEligible(explicit, after).eligible, false);
    assert.equal(buildCandidateDecision(explicit, after).accepted, false);
    const unknown = confirm(parseValidityFixture(path, 'Gutschein: Gültig bis 15.07.2099'));
    assert.equal(unknown.validTo, null);
    assert.equal(isPublicValidityEligible(unknown, now).publicUntil, '2026-07-19T09:00:00.000Z');
    assert.equal(buildCandidateDecision(unknown, now).accepted, true);
    assert.equal(buildCandidateDecision(unknown, new Date('2026-07-19T09:00:00.001Z')).accepted, false);
    assert.equal(isPublicValidityEligible({ ...unknown, crawlRunId: null }, now).eligible, false);
  });
}

test('response guards repair unequivocal stale food categories without changing stored objects', () => {
  for (const [title, primary, secondary] of [
    ['Dipping Powder Espresso', 'Getraenke', 'Kaffee & Tee'],
    ['Handfluid Zitronentraum', 'Lebensmittel', 'Obst & Gemuese'],
  ]) {
    const stored = { title, categoryPrimary: primary, categorySecondary: secondary, priceCurrent: { amount: 3 }, rawFacts: {} };
    const ranked = buildRankedOffer(stored, null, null);
    assert.equal(ranked.categoryPrimary, 'Drogerie / Hygiene');
    assert.notEqual(ranked.categorySecondary, secondary);
    assert.equal(stored.categoryPrimary, primary);
  }
});

test('personal-care product types beat flavor, color and stale food category signals', () => {
  for (const [title, sub] of [
    ['Dipping Powder Espresso', 'Kosmetik & Make-up'],
    ['Nagelpuder Cappuccino', 'Kosmetik & Make-up'],
    ['Handfluid Zitronentraum, 75 ml', 'Koerperpflege'],
    ['Handcreme Orange & Mango', 'Koerperpflege'],
  ]) {
    const result = determineCategoryDecision({ title, sourceCategory: 'Kaffee & Tee Obst & Gemüse' });
    assert.equal(result.primaryCategory, 'Drogerie / Hygiene', title);
    assert.equal(result.secondaryCategory, sub, title);
  }
});

test('real coffee, citrus and fruit foods retain their categories', () => {
  for (const [title, primary, secondary] of [
    ['Espresso ganze Bohne 1 kg', 'Getraenke', 'Kaffee & Tee'],
    ['Cappuccino Kaffee 250 g', 'Getraenke', 'Kaffee & Tee'],
    ['Bio Zitronen frisch 500 g', 'Lebensmittel', 'Obst & Gemuese'],
    ['Orangen Mango 1 kg', 'Lebensmittel', 'Obst & Gemuese'],
  ]) {
    const result = determineCategoryDecision({ title });
    assert.equal(result.primaryCategory, primary, title);
    assert.equal(result.secondaryCategory, secondary, title);
  }
});

test('unknown BIPA validity follows existing TTL and fails closed without offer lineage', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const [offer] = parse(`${card()}<footer>Gültig bis 11.11.2099</footer>`);
  const confirmed = { ...offer, sourceType: 'bipa-official-onlineonly', sourceId: 'source', crawlRunId: 'run', crawlJobId: 'job', sourceRunStatus: 'success', publishStatus: 'crawl-run-success', lastSeenAt: now, validFrom: now };
  const active = isPublicValidityEligible(confirmed, now);
  assert.equal(active.validityClass, 'snapshot-confirmed');
  assert.equal(active.publicUntil, '2026-11-05T12:00:00.000Z');
  assert.equal(isPublicValidityEligible(confirmed, new Date('2026-11-05T12:00:00.001Z')).eligible, false);
  assert.equal(isPublicValidityEligible({ ...confirmed, crawlRunId: null }, now).eligible, false);
});
