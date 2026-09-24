const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/penny-pdf-validity-august-2026.json');
const {
  PENNY_PDF_VALIDITY_SOURCE, calendarDate, derivePennyLeafletValidity, periodFromOfficialUrl,
} = require('../src/services/offers/pennyPdfValidity');
const { isPublicValidityEligible } = require('../src/services/offers/publicValidity');
const { normalizePennyPdfCandidatesToOffers } = require('../src/services/crawl/pennyPdfLeafletParser');
const { enrichOfferForStorage } = require('../src/services/crawl/offerAuditEnrichment');
const { filterFreshActiveOffers } = require('../src/services/offers/offerRankingService');

const now = new Date('2026-09-24T12:00:00Z');
const key = (date) => date?.toISOString().slice(0, 10);
const pdf = (overrides = {}) => ({
  retailerKey: 'penny', sourceType: 'penny-official-pdf', sourceUrl: fixture.sourceUrl,
  validFrom: new Date('2026-08-20T12:00:00Z'), validTo: new Date('2030-01-06T12:00:00Z'),
  status: 'active', isActiveNow: true, title: 'Kaffee', priceCurrent: { amount: 4.99 },
  ...overrides,
});

test('real PDF token 6.49. reproduces the old month-overflow and cannot become a calendar date', () => {
  const text = fixture.pages[0].text;
  const token = [...text.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(?!\d)/g)].find((match) => match[0] === '6.49.');
  assert.ok(token);
  assert.match(text.slice(token.index - 20, token.index + 12), /Sonderpreis um € 6\.49\./);
  assert.equal(new Date(Date.UTC(2026, Number(token[2]) - 1, Number(token[1]), 12)).toISOString(), '2030-01-06T12:00:00.000Z');
  assert.equal(calendarDate(Number(token[1]), Number(token[2]), 2026), null);
  assert.equal(calendarDate(31, 2, 2026), null);
  assert.equal(calendarDate(29, 2, 2026), null);
  assert.equal(key(calendarDate(29, 2, 2028)), '2028-02-29');
});

test('real cover selects the explicit leaflet period, not loyalty dates or price fragments', () => {
  for (const url of ['', fixture.sourceUrl]) {
    const period = derivePennyLeafletValidity(fixture.pages, url);
    assert.equal(key(period.validFrom), '2026-08-20');
    assert.equal(key(period.validTo), '2026-08-26');
    assert.deepEqual(period.detectedDates, ['2026-08-20', '2026-08-26']);
  }
});

test('explicit periods validate calendar, order, year and campaign agreement fail-closed', () => {
  for (const text of [
    '20.08. 26.08.2026 Sonderpreis 6.49.',
    'Gültig von 31.02.2026 bis 07.03.2026',
    'Gültig von 26.08.2026 bis 20.08.2026',
    'Gültig von Do 20.08. bis Mi 26.08.',
  ]) assert.equal(derivePennyLeafletValidity([{ text }]), null, text);
  assert.equal(derivePennyLeafletValidity([{ text: 'Gültig von 20.08.2026 bis 06.01.2030' }], fixture.sourceUrl), null);
  const explicit = derivePennyLeafletValidity([{ text: 'Gueltig von 24.09.2026 bis 30.09.2026' }]);
  assert.equal(key(explicit.validTo), '2026-09-30');
  assert.equal(key(derivePennyLeafletValidity([{ text: 'Gültig von Do 31.12. bis Mi 06.01.2027' }]).validFrom), '2026-12-31');
  assert.equal(periodFromOfficialUrl(fixture.sourceUrl.replace('issuu.com/pennyat', 'example.test/pennyat')), null);
});

test('a wider official URL never extends a narrower printed period or resolves competing printed periods', () => {
  const period = derivePennyLeafletValidity([{ text: 'Gültig von 21.08.2026 bis 22.08.2026' }], fixture.sourceUrl);
  assert.equal(key(period.validFrom), '2026-08-21');
  assert.equal(key(period.validTo), '2026-08-22');
  assert.equal(derivePennyLeafletValidity([{ text: 'Gültig von 21.08.2026 bis 22.08.2026\nGültig von 24.08.2026 bis 26.08.2026' }], fixture.sourceUrl), null);
});

function normalize(validity, rawText = 'Kaffee 500 g 4.99', pdfUrl = fixture.sourceUrl) {
  return normalizePennyPdfCandidatesToOffers({
    source: { _id: '000000000000000000000123', retailerKey: 'penny', retailerName: 'PENNY' },
    crawlJobId: '000000000000000000000456', region: 'AT', pdfUrl,
    pdfReference: { validity, candidates: [{ id: 'p1-1', page: 1, title: 'Kaffee', price: 4.99, quantityText: '500 g', rawText }] },
  });
}

test('normalization requires verified campaign evidence and rejects contradictory item periods', () => {
  assert.deepEqual(normalize({ validFrom: new Date('2026-08-20'), validTo: new Date('2030-01-06') }), []);
  const validity = derivePennyLeafletValidity(fixture.pages, fixture.sourceUrl);
  for (const rawText of [
    'Kaffee Gültig von 20.08.2026 bis 06.01.2030',
    'Kaffee Gültig von 31.08.2026 bis 26.08.2026',
    'Kaffee Gültig von 31.02.2026 bis 26.08.2026',
  ]) assert.deepEqual(normalize(validity, rawText), []);
  const [offer] = normalize(validity, 'Kaffee Gültig von Fr 21.08. bis Sa 22.08.2026');
  assert.equal(key(offer.validFrom), '2026-08-21');
  assert.equal(key(offer.validTo), '2026-08-22');
  assert.equal(offer.rawFacts.validitySource, PENNY_PDF_VALIDITY_SOURCE);
  assert.equal(key(offer.rawFacts.validTo), '2026-08-26');
  const [shortOffer] = normalize(validity, 'Kaffee Framstagspreis Fr 21.08. und Sa 22.08. Wochenstarter');
  assert.equal(key(shortOffer.validTo), '2026-08-22');
});

test('public boundary and ranking reject the legacy August PDF without mutating it', () => {
  const offer = pdf();
  const before = structuredClone(offer);
  assert.equal(isPublicValidityEligible(offer, now).eligible, false);
  assert.deepEqual(filterFreshActiveOffers([offer], now), []);
  assert.deepEqual(offer, before);
  assert.equal(isPublicValidityEligible(pdf({ validTo: new Date('2026-08-26T12:00:00Z') }), now).reasonCode, 'expired-validTo');
  assert.equal(isPublicValidityEligible(pdf({ validTo: new Date('2026-08-26T12:00:00Z') }), new Date('2026-08-24')).eligible, true);
});

test('verified current PDF survives enrichment and public validation without an URL date', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const validity = derivePennyLeafletValidity([{ text: 'Gültig von 24.09.2026 bis 30.09.2026' }]);
  assert.deepEqual(normalize(validity), []);
  const [offer] = normalize(validity, 'Kaffee 500 g 4.99', 'https://www.penny.at/current.pdf');
  const stored = enrichOfferForStorage(offer, { sourceType: 'penny-official-pdf' });
  assert.ok(stored);
  assert.equal(isPublicValidityEligible(stored, now).eligible, true);
  assert.equal(isPublicValidityEligible({ ...stored, rawFacts: {} }, now).eligible, false);
});

test('current HTML primary offers and their PDF supporting evidence remain unchanged', () => {
  const html = pdf({
    sourceType: 'penny-official-html', validFrom: new Date('2026-09-24T00:00:00Z'), validTo: new Date('2026-09-30T23:59:59Z'),
    sourceTypes: ['penny-official-html', 'penny-official-pdf'],
    rawFacts: { sourceType: 'penny-official-html' },
  });
  const before = structuredClone(html);
  assert.equal(isPublicValidityEligible(html, now).eligible, true);
  assert.equal(filterFreshActiveOffers([html], now).length, 1);
  assert.deepEqual(html, before);
});
