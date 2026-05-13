const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  PARSER_VERSION,
  SOURCE_TYPE,
  extractSparPdfCandidates,
  normalizeSparPdfCandidatesToOffers,
  priceFromUnitPrice,
  sourceKeyForFormat,
  summarizeRejections,
} = require('../src/services/crawl/sparOfficialFlyerPdfParser');
const { enrichOfferForStorage } = require('../src/services/crawl/offerAuditEnrichment');

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'spar-official-flyer-pdf-textlayers.json'),
  'utf8'
));

function source(format = 'eurospar') {
  return {
    _id: '000000000000000000000321',
    retailerKey: 'spar',
    retailerName: 'Spar',
    channel: 'official-flyer',
    sourceUrl: `https://flugblatt.spar.at/steiermark/${format}/260507-1-flugblatt-kw-19/getPdf.ashx`,
    sourceType: 'pdf',
    sourceRetailerName: format === 'interspar' ? 'INTERSPAR' : format === 'eurospar' ? 'EUROSPAR' : 'SPAR',
    sourceRetailerFormat: format,
    appliesToRetailerFormats: [format],
    retailerFormatLabel: format.toUpperCase(),
  };
}

test('derives granular SPAR official PDF source keys', () => {
  assert.equal(sourceKeyForFormat('spar'), 'spar-official-flyer-pdf');
  assert.equal(sourceKeyForFormat('eurospar'), 'eurospar-official-flyer-pdf');
  assert.equal(sourceKeyForFormat('interspar'), 'interspar-official-flyer-pdf');
});

test('computes article price from printed unit price only when quantity is clear', () => {
  assert.equal(priceFromUnitPrice('500 g', '14,50'), 7.25);
  assert.equal(priceFromUnitPrice('500 g', '23,98'), 11.99);
  assert.equal(priceFromUnitPrice('', '14,50'), null);
});

test('extracts concrete EUROSPAR coffee offers from textlayer fixtures', () => {
  const pages = fixture.pages.filter((page) => page.sourceRetailerFormat === 'eurospar');
  const candidates = extractSparPdfCandidates({
    pages,
    sourceRetailerFormat: 'eurospar',
    validity: fixture.validity,
  }).filter((candidate) => !candidate.exclusionReason);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].brand, 'Meinl');
  assert.equal(candidates[0].price, 7.25);
  assert.equal(candidates[0].quantityText, '500 g');
  assert.equal(candidates[1].brand, 'Lavazza');
  assert.equal(candidates[1].price, 22.99);
  assert.equal(candidates[1].referencePrice, 28.99);
  assert.equal(candidates[1].quantityText, '1 kg');
});

test('rejects campaign-only coffee blocks as non-product diagnostics', () => {
  const page = fixture.pages.find((item) => item.pageNumber === 4);
  const candidates = extractSparPdfCandidates({
    pages: [page],
    sourceRetailerFormat: 'interspar',
    validity: fixture.validity,
  });

  assert.deepEqual(summarizeRejections(candidates), [
    { reason: 'campaign-not-product', count: 1 },
  ]);
  assert.equal(candidates.filter((candidate) => !candidate.exclusionReason).length, 0);
});

test('rejects unclear product blocks without price', () => {
  const page = fixture.pages.find((item) => item.pageNumber === 5);
  const candidates = extractSparPdfCandidates({
    pages: [page],
    sourceRetailerFormat: 'spar',
    validity: fixture.validity,
  });

  assert.equal(candidates.some((candidate) => candidate.exclusionReason === 'missing-price'), true);
});

test('normalizes SPAR PDF candidates with source metadata and distinguishable retailer formats', () => {
  const pages = fixture.pages.filter((page) => page.sourceRetailerFormat === 'interspar');
  const candidates = extractSparPdfCandidates({
    pages,
    sourceRetailerFormat: 'interspar',
    validity: {
      validFrom: new Date(fixture.validity.validFrom),
      validTo: new Date(fixture.validity.validTo),
    },
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: {
        validFrom: new Date(fixture.validity.validFrom),
        validTo: new Date(fixture.validity.validTo),
      },
      candidates,
    },
    source: source('interspar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.interspar.at/steiermark/steiermark_kw19/getPdf.ashx',
    pdfSha256: 'abc123',
  });

  const activeOffer = offers.find((offer) => offer.status === 'active');
  const stored = enrichOfferForStorage(activeOffer, {
    source: source('interspar'),
    sourceType: SOURCE_TYPE,
    parserVersion: PARSER_VERSION,
  });

  assert.ok(offers.length >= 4);
  assert.ok(activeOffer);
  assert.equal(stored.sourceType, 'spar-official-pdf');
  assert.equal(stored.retailerKey, 'spar');
  assert.equal(stored.sourceRetailerFormat, 'interspar');
  assert.deepEqual(stored.appliesToRetailerFormats, ['interspar']);
  assert.equal(stored.rawFacts.sourceKey, 'interspar-official-flyer-pdf');
  assert.equal(stored.rawFacts.sourceMetadata.pdfSha256, 'abc123');
  assert.equal(stored.rawFacts.sourceMetadata.extractionMethod, 'text-layer');
  assert.equal(stored.categorySecondary, 'Kaffee & Tee');
});

test('SPAR PDF dedupe keys are source-specific and do not blindly replace aggregators', () => {
  const pages = fixture.pages.filter((page) => page.sourceRetailerFormat === 'eurospar');
  const [offer] = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: {
        validFrom: new Date(fixture.validity.validFrom),
        validTo: new Date(fixture.validity.validTo),
      },
      candidates: extractSparPdfCandidates({
        pages,
        sourceRetailerFormat: 'eurospar',
        validity: fixture.validity,
      }),
    },
    source: source('eurospar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/eurospar/260507-1-flugblatt-kw-19/getPdf.ashx',
  });

  assert.match(offer.dedupeKey, /eurospar-official-flyer-pdf/);
  assert.doesNotMatch(offer.dedupeKey, /aktionsfinder/);
});
