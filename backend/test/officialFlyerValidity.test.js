const assert = require('node:assert/strict');
const test = require('node:test');
const {
  dateKey,
  extractOfficialFlyerValidityFromText,
} = require('../src/services/crawl/officialFlyerValidity');
const {
  normalizeSparPdfCandidatesToOffers,
} = require('../src/services/crawl/sparOfficialFlyerPdfParser');

function sparSource(overrides = {}) {
  return {
    _id: '000000000000000000000321',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    channel: 'official-flyer',
    sourceUrl: 'https://flugblatt.spar.at/steiermark/spar/260528-1-flugblatt-kw-22/getPdf.ashx',
    sourceType: 'pdf',
    sourceRetailerName: 'SPAR',
    sourceRetailerFormat: 'spar',
    appliesToRetailerFormats: ['spar'],
    retailerFormatLabel: 'nur SPAR',
    ...overrides,
  };
}

function offerCandidate(id, title = 'Puntigamer Maerzen') {
  return {
    id,
    page: 1,
    productKind: 'beer',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
    title,
    brand: title.split(/\s+/)[0],
    price: 14.9,
    referencePrice: 29.8,
    quantityText: '20 x 0.5 l',
    conditionsText: '1+1 gratis / ab 2 Kisten',
    rawText: `${title} 20 x 0,5 Liter 1+1 gratis ab 2 Kisten je 14,90`,
    comparisonSafe: true,
  };
}

test('extracts official flyer-level validity ranges from Austrian title-page formats', () => {
  const cases = [
    'Angebote gueltig von Do. 28.5. bis Di. 2.6.2026',
    'von Donnerstag 28.5. bis Dienstag 2.6.2026',
    'gueltig von 28.05. bis 02.06.2026',
    'Angebote gultig von Do. 28.5. bis Di. 2.6.2026',
    'Angebote g\u00fcltig von Do. 28.5. bis Di. 2.6.2026',
  ];

  for (const text of cases) {
    const parsed = extractOfficialFlyerValidityFromText(text, { contextYear: 2026 });

    assert.equal(dateKey(parsed.validFrom), '2026-05-27');
    assert.equal(dateKey(parsed.validTo), '2026-06-02');
    assert.equal(parsed.validitySource, 'official-pdf-page-1');
    assert.ok(parsed.validityConfidence >= 0.9);
  }
});

test('extracts official flyer-level valid-to when only a clear until date exists', () => {
  const parsed = extractOfficialFlyerValidityFromText('Angebote gueltig bis 02.06.2026', { contextYear: 2026 });

  assert.equal(parsed.validFrom, null);
  assert.equal(dateKey(parsed.validTo), '2026-06-02');
  assert.equal(parsed.validitySource, 'official-pdf-page-1');
});

test('infers missing start year from end year and handles year changes conservatively', () => {
  const regular = extractOfficialFlyerValidityFromText('Angebote gueltig von Do. 28.5. bis Di. 2.6.2026');
  const yearChange = extractOfficialFlyerValidityFromText('Angebote gueltig von Do. 28.12. bis Di. 2.1.2027');

  assert.equal(dateKey(regular.validFrom), '2026-05-27');
  assert.equal(dateKey(regular.validTo), '2026-06-02');
  assert.equal(dateKey(yearChange.validFrom), '2026-12-27');
  assert.equal(dateKey(yearChange.validTo), '2027-01-02');
});

test('does not treat short subconditions as flyer-level base validity', () => {
  const subconditions = [
    'Zusaetzlich -25% am Fr., 29.5. und Sa., 30.5.',
    'Zus\u00e4tzlich -25% am Fr., 29.5. und Sa., 30.5.',
    'nur Fr./Sa.',
    'Joker moeglich am Fr., 29.5.',
  ];

  for (const text of subconditions) {
    const parsed = extractOfficialFlyerValidityFromText(text, { contextYear: 2026 });

    assert.equal(parsed.validFrom, null);
    assert.equal(parsed.validTo, null);
    assert.equal(parsed.validityConfidence, 0);
  }
});

test('SPAR PDF offer normalization propagates validity only within the given PDF reference', () => {
  const firstValidity = {
    validFrom: new Date('2026-05-27T22:00:00.000Z'),
    validTo: new Date('2026-06-02T21:59:59.999Z'),
    validityText: 'Angebote gueltig von Do. 28.5. bis Di. 2.6.2026',
    validitySource: 'official-pdf-page-1',
    validityConfidence: 0.92,
  };
  const secondValidity = {
    validFrom: new Date('2026-06-03T22:00:00.000Z'),
    validTo: new Date('2026-06-09T21:59:59.999Z'),
    validityText: 'Angebote gueltig von Do. 4.6. bis Di. 9.6.2026',
    validitySource: 'official-pdf-page-1',
    validityConfidence: 0.92,
  };
  const [firstA, firstB] = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: firstValidity,
      candidates: [offerCandidate('a'), offerCandidate('b', 'Schwechater Bier')],
    },
    source: sparSource(),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://example.test/kw22.pdf',
  });
  const [second] = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: secondValidity,
      candidates: [offerCandidate('c')],
    },
    source: sparSource({ sourceUrl: 'https://example.test/kw23.pdf' }),
    crawlJobId: '000000000000000000000655',
    region: 'Grossraum Graz',
    pdfUrl: 'https://example.test/kw23.pdf',
  });

  assert.equal(dateKey(firstA.validTo), '2026-06-02');
  assert.equal(dateKey(firstB.validTo), '2026-06-02');
  assert.equal(dateKey(second.validTo), '2026-06-09');
  assert.equal(firstA.rawFacts.validitySource, 'official-pdf-page-1');
  assert.equal(second.rawFacts.validitySource, 'official-pdf-page-1');
});

test('SPAR PDF offer normalization keeps crawlPolicy fallback when no flyer validity exists', () => {
  const fallbackValidity = {
    validFrom: new Date('2026-05-20T22:00:00.000Z'),
    validTo: new Date('2026-06-02T21:59:59.999Z'),
    validityText: 'Do., 21.05.26 - Di., 02.06.26',
    validitySource: 'crawlPolicy',
    validityConfidence: 0.62,
  };
  const [offer] = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: fallbackValidity,
      candidates: [offerCandidate('fallback')],
    },
    source: sparSource(),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://example.test/fallback.pdf',
  });

  assert.equal(dateKey(offer.validFrom), '2026-05-20');
  assert.equal(dateKey(offer.validTo), '2026-06-02');
  assert.equal(offer.rawFacts.validitySource, 'crawlPolicy');
  assert.equal(offer.rawFacts.validityConfidence, 0.62);
});
