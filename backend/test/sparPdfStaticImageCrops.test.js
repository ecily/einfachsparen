const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getStaticSparPdfCropForCandidate,
} = require('../src/services/crawl/sparPdfStaticImageCrops');
const {
  normalizeSparPdfCandidatesToOffers,
} = require('../src/services/crawl/sparOfficialFlyerPdfParser');

const monatssparerUrl = 'https://flugblatt.spar.at/steiermark/spar/260513-3-monatssparer-kw-20/getPdf.ashx';
const grillfolderUrl = 'https://flugblatt.spar.at/steiermark/spar/260513-2-grillen-kw-20/getPdf.ashx';

function source(format = 'spar') {
  const retailerKey = format === 'interspar' ? 'interspar' : format === 'eurospar' ? 'eurospar' : 'spar';
  const retailerName = format === 'interspar' ? 'INTERSPAR' : format === 'eurospar' ? 'EUROSPAR' : 'SPAR';

  return {
    _id: '000000000000000000000321',
    retailerKey,
    retailerName,
    channel: 'official-flyer',
    sourceUrl: monatssparerUrl,
    sourceType: 'pdf',
    sourceRetailerName: retailerName,
    sourceRetailerFormat: format,
    appliesToRetailerFormats: [format],
    retailerFormatLabel: format.toUpperCase(),
  };
}

function monthCandidate(overrides = {}) {
  return {
    id: 'spar-p2-7',
    page: 2,
    title: 'SPAR Muellsack mit Zugband',
    brand: 'SPAR',
    price: 1.99,
    referencePrice: 2.19,
    quantityText: '1 Pkg.',
    conditionsText: 'ab 2 Packungen je 1,99 / 2+1 gratis',
    rawText: 'SPAR Muellsack mit Zugband 35, 45 oder 70 Liter 1 Pkg. 2,19 ab 2 Pkg. je 1,99',
    comparisonSafe: false,
    parserHint: 'known-layout-offer',
    ...overrides,
  };
}

test('returns a static SPAR PDF crop only for exact source, candidate, title, page and price', () => {
  const result = getStaticSparPdfCropForCandidate({
    sourceUrl: monatssparerUrl,
    candidate: monthCandidate(),
  });

  assert.ok(result);
  assert.equal(result.imageUrl, 'https://www.kaufklug.at/offer-assets/spar-pdf-crops/monatssparer-p2-spar-muellsack.png');
  assert.equal(result.imageSourceType, 'pdf-static-crop');
  assert.equal(result.imageConfidence, 0.96);
  assert.deepEqual(result.imageEvidence.gates, [
    'static-official-pdf-crop',
    'exact-source-url-fragment',
    'exact-candidate-id',
    'exact-title',
    'exact-price',
    'manual-visual-review',
  ]);
});

test('matches static SPAR PDF crop when downloader canonicalizes away the source slug', () => {
  const result = getStaticSparPdfCropForCandidate({
    sourceUrl: 'https://viewer.ipaper.io/spar/hashed-download.pdf',
    sourceUrls: [monatssparerUrl],
    candidate: monthCandidate(),
  });

  assert.ok(result);
  assert.equal(result.imageEvidence.sourceUrl, 'https://viewer.ipaper.io/spar/hashed-download.pdf');
  assert.deepEqual(result.imageEvidence.sourceUrls, [monatssparerUrl]);
  assert.equal(result.imageUrl, 'https://www.kaufklug.at/offer-assets/spar-pdf-crops/monatssparer-p2-spar-muellsack.png');
});

test('rejects static SPAR PDF crops when any safety gate changes', () => {
  assert.equal(getStaticSparPdfCropForCandidate({
    sourceUrl: monatssparerUrl,
    candidate: monthCandidate({ price: 1.98 }),
  }), null);

  assert.equal(getStaticSparPdfCropForCandidate({
    sourceUrl: monatssparerUrl,
    candidate: monthCandidate({ title: 'SPAR Muellsack' }),
  }), null);

  assert.equal(getStaticSparPdfCropForCandidate({
    sourceUrl: 'https://flugblatt.spar.at/steiermark/spar/260603-1-flugblatt-kw-23/getPdf.ashx',
    candidate: monthCandidate(),
  }), null);

  assert.equal(getStaticSparPdfCropForCandidate({
    sourceUrl: monatssparerUrl,
    candidate: monthCandidate({ id: 'spar-p2-8' }),
  }), null);
});

test('does not map visually rejected or generic SPAR PDF candidates', () => {
  assert.equal(getStaticSparPdfCropForCandidate({
    sourceUrl: grillfolderUrl,
    candidate: {
      id: 'spar-p2-1',
      page: 2,
      title: 'SPAR BBQ Hendl-Grillteller',
      price: 4.39,
    },
  }), null);

  assert.equal(getStaticSparPdfCropForCandidate({
    sourceUrl: monatssparerUrl,
    candidate: {
      id: 'spar-p2-99',
      page: 2,
      title: 'Noch zusaetzlich',
      price: 1.99,
    },
  }), null);
});

test('normalizes accepted static crop into SPAR official PDF offer evidence', () => {
  const validity = {
    validFrom: new Date('2026-05-12T22:00:00.000Z'),
    validTo: new Date('2026-06-10T21:59:59.999Z'),
  };
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: { validity, candidates: [monthCandidate()] },
    source: source('spar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: monatssparerUrl,
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].imageUrl, 'https://www.kaufklug.at/offer-assets/spar-pdf-crops/monatssparer-p2-spar-muellsack.png');
  assert.equal(offers[0].rawFacts.imageSourceType, 'pdf-static-crop');
  assert.equal(offers[0].rawFacts.imageEvidence.asset, 'monatssparer-p2-spar-muellsack.png');
  assert.equal(offers[0].sourceType, 'spar-official-pdf');
});
