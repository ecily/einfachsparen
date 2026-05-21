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
  const retailerKey = format === 'interspar' ? 'interspar' : format === 'eurospar' ? 'eurospar' : 'spar';
  const retailerName = format === 'interspar' ? 'INTERSPAR' : format === 'eurospar' ? 'EUROSPAR' : 'SPAR';

  return {
    _id: '000000000000000000000321',
    retailerKey,
    retailerName,
    channel: 'official-flyer',
    sourceUrl: `https://flugblatt.spar.at/steiermark/${format}/260507-1-flugblatt-kw-19/getPdf.ashx`,
    sourceType: 'pdf',
    sourceRetailerName: retailerName,
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

test('extracts concrete beer offers from SPAR KW21 textlayer snippets', () => {
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: fixture.validity,
    pages: [
      {
        pageNumber: 3,
        text: [
          'Gilt auch auf ALLE Aktionspreise! -25% auf alle BIERE',
          'Hirter Privat Pils 0,5 Liter Mengenvorteil 1 Fl. 1,47 ab 6 Fl. je 1,19 0,89',
          'Schwechater Bier 0,5 Liter Im Einzelverkauf: 0,97 Mengenvorteil 20er-Kiste statt 19,40 16,80 12,60',
          'Gösser Märzen Naturradler Zitrone, alkoholfrei, 0,5 Liter Mengenvorteil 1 Ds. 1,59 ab 6 Ds. je 0,99 0,74',
          'Ottakringer Helles oder Frucade Radler 0,5 Liter 6+6 GRATIS 1 Ds. 1,39 ab 12 Ds. je 0,69 0,52',
        ].join(' '),
      },
    ],
  }).filter((candidate) => !candidate.exclusionReason);

  assert.ok(candidates.some((candidate) => candidate.title === 'Hirter Privat Pils'));
  assert.ok(candidates.some((candidate) => candidate.title === 'Schwechater Bier 20 x 0,5 Liter'));
  assert.ok(candidates.some((candidate) => candidate.title.includes('Goesser Maerzen')));
  assert.ok(candidates.every((candidate) => candidate.productKind === 'beer'));
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
  const currentValidity = {
    validFrom: new Date('2026-05-20T12:00:00.000Z'),
    validTo: new Date('2026-06-02T12:00:00.000Z'),
  };
  const pages = fixture.pages.filter((page) => page.sourceRetailerFormat === 'interspar');
  const candidates = extractSparPdfCandidates({
    pages,
    sourceRetailerFormat: 'interspar',
    validity: currentValidity,
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
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
  assert.equal(stored.retailerKey, 'interspar');
  assert.equal(stored.sourceRetailerFormat, 'interspar');
  assert.deepEqual(stored.appliesToRetailerFormats, ['interspar']);
  assert.equal(stored.rawFacts.sourceKey, 'interspar-official-flyer-pdf');
  assert.equal(stored.rawFacts.sourceMetadata.pdfSha256, 'abc123');
  assert.equal(stored.rawFacts.sourceMetadata.extractionMethod, 'text-layer');
  assert.equal(stored.categorySecondary, 'Kaffee & Tee');
});

test('normalizes SPAR PDF beer candidates as beer with format metadata', () => {
  const currentValidity = {
    validFrom: new Date('2026-05-20T12:00:00.000Z'),
    validTo: new Date('2026-06-02T12:00:00.000Z'),
  };
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'eurospar',
    validity: currentValidity,
    pages: [
      {
        pageNumber: 1,
        text: 'Gösser Märzen, Naturradler Zitrone oder Naturradler Zitrone alkoholfrei 0,5 Liter 1 DS 1,59 ab 6 DS. je 0,99 0,74',
      },
    ],
  });
  const [offer] = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates,
    },
    source: source('eurospar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/eurospar/260521-1-flugblatt-kw-21/getPdf.ashx',
  });
  const stored = enrichOfferForStorage(offer, {
    source: source('eurospar'),
    sourceType: SOURCE_TYPE,
    parserVersion: PARSER_VERSION,
  });

  assert.equal(stored.categorySecondary, 'Bier');
  assert.equal(stored.categoryKey, 'bier');
  assert.equal(stored.comparableUnit, 'l');
  assert.equal(stored.normalizedUnitPrice.amount, 1.98);
  assert.equal(stored.sourceRetailerFormat, 'eurospar');
  assert.equal(stored.retailerKey, 'eurospar');
  assert.equal(stored.rawFacts.sourceKey, 'eurospar-official-flyer-pdf');
  assert.match(stored.searchText, /bier/);
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
