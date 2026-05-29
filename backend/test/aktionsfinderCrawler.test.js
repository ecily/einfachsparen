const assert = require('node:assert/strict');
const test = require('node:test');

const {
  _private: {
    buildCategoryPageLinks,
    buildSupplementalCategoryPageLinks,
    classifyAktionsfinderAuditDrop,
    classifyAktionsfinderNormalizationDrop,
    enrichAktionsfinderOffersForStorage,
    extractCategoryPageLinks,
    normalizeAktionsfinderPromotions,
    uniquePromotions,
  },
} = require('../src/services/crawl/aktionsfinderCrawler');

function source(overrides = {}) {
  return {
    _id: '000000000000000000000501',
    retailerKey: 'bipa',
    retailerName: 'BIPA',
    channel: 'aggregator',
    sourceUrl: 'https://www.aktionsfinder.at/pv/bipa/',
    ...overrides,
  };
}

function promotion(overrides = {}) {
  return {
    id: 'bipa-test-1',
    title: 'BIPA Testprodukt 250 ml',
    fullDisplayName: 'BIPA Testprodukt 250 ml',
    discountedPrice: 2.49,
    originalPrice: 3.49,
    currency: { iso: 'EUR', symbol: 'EUR' },
    productGroups: [{ title: 'Drogerie' }],
    product: {
      productQuantity: 250,
      productQuantityUnit: { shortName: 'ml', type: 'PRODUCT' },
    },
    image: {
      small: 'https://example.test/test.jpg',
      medium: 'https://example.test/test.jpg',
    },
    snapshotCurrent: true,
    ...overrides,
  };
}

test('Aktionsfinder category discovery keeps linked category pages', () => {
  const html = `
    <a href="/ppcv/lebensmittel/spar/">Lebensmittel</a>
    <a href="/ppcv/getraenke/spar/">Getraenke</a>
    <a href="/ppcv/lebensmittel/spar/">Duplicate</a>
  `;

  assert.deepEqual(
    extractCategoryPageLinks(html, 'https://www.aktionsfinder.at/pv/spar/'),
    [
      'https://www.aktionsfinder.at/ppcv/lebensmittel/spar/',
      'https://www.aktionsfinder.at/ppcv/getraenke/spar/',
    ]
  );
});

test('Aktionsfinder SPAR formats add only targeted reachable coverage categories', () => {
  const html = '<a href="/ppcv/lebensmittel/spar/">Lebensmittel</a>';
  const source = {
    retailerKey: 'spar',
    sourceUrl: 'https://www.aktionsfinder.at/pv/spar/',
  };

  assert.deepEqual(buildSupplementalCategoryPageLinks(source), [
    'https://www.aktionsfinder.at/ppcv/haushalt/spar/',
    'https://www.aktionsfinder.at/ppcv/milchprodukte/spar/',
  ]);

  assert.deepEqual(buildCategoryPageLinks(html, source), [
    'https://www.aktionsfinder.at/ppcv/lebensmittel/spar/',
    'https://www.aktionsfinder.at/ppcv/haushalt/spar/',
    'https://www.aktionsfinder.at/ppcv/milchprodukte/spar/',
  ]);
});

test('Aktionsfinder supplemental category discovery does not broaden non-SPAR retailers', () => {
  const source = {
    retailerKey: 'hofer',
    sourceUrl: 'https://www.aktionsfinder.at/pv/hofer/',
  };

  assert.deepEqual(buildSupplementalCategoryPageLinks(source), []);
  assert.deepEqual(buildCategoryPageLinks('', source), []);
});

test('Aktionsfinder taxonomy reports missing price and missing title during normalization', () => {
  const result = normalizeAktionsfinderPromotions({
    promotions: [
      promotion({ id: 'missing-price', discountedPrice: null, newPrice: null }),
      promotion({ id: 'missing-title', title: '', fullDisplayName: '', discountedPrice: 1.99 }),
    ],
    source: source(),
    crawlJobId: 'crawl-a',
    region: 'AT',
  });

  assert.equal(result.normalizedOffers.length, 0);
  assert.deepEqual(result.rejectionReasons, [
    { reason: 'price-missing', count: 1 },
    { reason: 'title-missing', count: 1 },
  ]);
});

test('Aktionsfinder taxonomy separates empty candidates from unexpected parse-failed fallbacks', () => {
  assert.equal(classifyAktionsfinderNormalizationDrop(
    promotion({ title: '', fullDisplayName: '', discountedPrice: null, newPrice: null })
  ), 'parser-no-offer-candidate');
  assert.equal(classifyAktionsfinderNormalizationDrop(promotion()), 'parse-failed');
});

test('Aktionsfinder taxonomy reports expired and upcoming audit-filtered offers from enrichment', () => {
  const normalizeResult = normalizeAktionsfinderPromotions({
    promotions: [
      promotion({
        id: 'expired',
        validFrom: '2000-01-01T12:00:00.000Z',
        validTo: '2000-01-02T23:59:59.999Z',
        snapshotCurrent: false,
      }),
      promotion({
        id: 'upcoming',
        validFrom: '2099-01-01T12:00:00.000Z',
        validTo: '2099-01-02T23:59:59.999Z',
        snapshotCurrent: false,
      }),
    ],
    source: source(),
    crawlJobId: 'crawl-a',
    region: 'AT',
  });
  const enrichResult = enrichAktionsfinderOffersForStorage({
    normalizedOffers: normalizeResult.normalizedOffers,
    source: source(),
  });

  assert.equal(normalizeResult.normalizedOffers.length, 2);
  assert.equal(enrichResult.offerDocuments.length, 0);
  assert.deepEqual(enrichResult.rejectionReasons, [
    { reason: 'validity-expired', count: 1 },
    { reason: 'validity-upcoming', count: 1 },
  ]);
  assert.equal(classifyAktionsfinderAuditDrop({ status: 'active' }), 'audit-filtered');
});

test('Aktionsfinder taxonomy counts source duplicate and id-less candidates before storage', () => {
  const diagnostics = {};
  const unique = uniquePromotions([
    promotion({ id: 'same-id', title: 'First' }),
    promotion({ id: 'same-id', title: 'Duplicate' }),
    promotion({ id: '', title: 'No stable source id' }),
    promotion({ id: 'other-id', title: 'Other' }),
  ], diagnostics);

  assert.equal(unique.length, 2);
  assert.equal(diagnostics.dedupeDropped, 1);
  assert.equal(diagnostics.parserNoOfferCandidate, 1);
});
