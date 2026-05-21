const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractAndNormalizeOfficialCategoryPromotions,
  extractOfficialCategoryPromotionCandidates,
  sourceKeyForActionSource,
} = require('../src/services/crawl/officialCategoryPromotionParser');
const { enrichOffersForStorage } = require('../src/services/crawl/offerAuditEnrichment');

const SPAR_SOURCE = {
  _id: 'source-spar-actions',
  retailerKey: 'spar',
  retailerName: 'SPAR',
  channel: 'official-site',
  sourceUrl: 'https://www.spar.at/aktionen/steiermark',
  sourceRetailerName: 'SPAR',
  sourceRetailerFormat: 'spar',
  appliesToRetailerFormats: ['spar'],
  retailerFormatLabel: 'nur SPAR',
  regionScope: 'Steiermark',
};

const INTERSPAR_SOURCE = {
  _id: 'source-interspar-actions',
  retailerKey: 'interspar',
  retailerName: 'INTERSPAR',
  channel: 'official-site',
  sourceUrl: 'https://www.interspar.at/aktionen',
  sourceRetailerName: 'INTERSPAR',
  sourceRetailerFormat: 'interspar',
  appliesToRetailerFormats: ['interspar'],
  retailerFormatLabel: 'nur INTERSPAR',
  regionScope: 'Austria',
};

test('sourceKeyForActionSource distinguishes official SPAR and INTERSPAR action sources', () => {
  assert.equal(sourceKeyForActionSource(SPAR_SOURCE), 'spar-official-actions-steiermark');
  assert.equal(sourceKeyForActionSource(INTERSPAR_SOURCE), 'interspar-official-actions');
});

test('extracts official SPAR Steiermark category-wide beer and pet promotions without prices', () => {
  const html = `
    <main>
      <article>-25% auf alle Biere. Gueltig 21.05.2026 - 24.05.2026. Ausgenommen Pfand.</article>
      <article>-25% auf alle Tiernahrungs-Artikel. Gueltig 21.05.2026 - 24.05.2026.</article>
    </main>
  `;
  const candidates = extractOfficialCategoryPromotionCandidates({
    html,
    source: SPAR_SOURCE,
    now: new Date('2026-05-21T12:00:00.000Z'),
  });

  assert.deepEqual(candidates.map((candidate) => candidate.promotionScope).sort(), ['bier', 'tiernahrung']);
  assert.equal(candidates.find((candidate) => candidate.promotionScope === 'bier').discountPercent, 25);
  assert.equal(candidates.find((candidate) => candidate.promotionScope === 'bier').regionScope, 'Steiermark');

  const { offers } = extractAndNormalizeOfficialCategoryPromotions({
    html,
    source: SPAR_SOURCE,
    crawlJobId: 'crawl-spar-actions',
    region: 'Steiermark',
    now: new Date('2026-05-21T12:00:00.000Z'),
  });

  assert.equal(offers.length, 2);
  assert.equal(offers[0].offerType, 'category-promotion');
  assert.equal(offers[0].retailerKey, 'spar');
  assert.equal(offers[0].priceCurrent.amount, null);
  assert.equal(offers[0].rawFacts.sourceType, 'official-action');
});

test('extracts official INTERSPAR up-to category promotions and search-relevant scopes', () => {
  const html = `
    <section>bis zu -25% auf alle Waschmittel, Fein- & Spezialwaschmittel inkl. Weichspueler. 21.05.2026 - 24.05.2026.</section>
    <section>bis zu -25% auf alle Frotteewaren inkl. Strandtuecher und Badematten. 21.05.2026 - 24.05.2026.</section>
    <section>bis zu -25% auf alle Biere. 21.05.2026 - 24.05.2026.</section>
    <section>bis zu -25% auf die gesamte Tiernahrung und Tierzubehoer. 21.05.2026 - 24.05.2026.</section>
  `;
  const { offers } = extractAndNormalizeOfficialCategoryPromotions({
    html,
    source: INTERSPAR_SOURCE,
    crawlJobId: 'crawl-interspar-actions',
    region: 'Austria',
    now: new Date('2026-05-21T12:00:00.000Z'),
  });

  assert.deepEqual(offers.map((offer) => offer.promotionScope).sort(), [
    'bier',
    'frotteewaren',
    'tiernahrung',
    'waschmittel',
  ]);
  assert.ok(offers.every((offer) => offer.retailerKey === 'interspar'));
  assert.ok(offers.every((offer) => offer.discountUpToPercent === 25));
});

test('price-optional category promotions enrich without missing price or unit review noise', () => {
  const html = '<article>-25% auf alle Biere. Gueltig 21.05.2026 - 24.05.2026.</article>';
  const { offers } = extractAndNormalizeOfficialCategoryPromotions({
    html,
    source: SPAR_SOURCE,
    crawlJobId: 'crawl-spar-actions',
    region: 'Steiermark',
    now: new Date('2026-05-21T12:00:00.000Z'),
  });
  const [stored] = enrichOffersForStorage(offers, {
    source: SPAR_SOURCE,
    sourceType: 'official-action',
    parserVersion: 'official-category-promotions-v1',
  });

  assert.equal(stored.offerType, 'category-promotion');
  assert.equal(stored.priceCurrent.amount, null);
  assert.equal(stored.hasReferencePrice, false);
  assert.equal(stored.isActionPriceOnly, false);
  assert.equal(stored.reviewReasons.includes('missing-current-price'), false);
  assert.equal(stored.reviewReasons.includes('missing-quantity'), false);
  assert.equal(stored.reviewReasons.includes('Vergleichseinheit unklar'), false);
  assert.equal(stored.searchTokens.includes('bier'), true);
  assert.equal(stored.searchTokens.includes('maerzen'), true);
});
