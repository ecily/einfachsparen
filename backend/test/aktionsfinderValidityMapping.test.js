const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildSafeOfferValidityEvidence,
  normalizePromotionToOffer,
} = require('../src/services/crawl/offerNormalizer');

function promotion(overrides = {}) {
  return {
    id: 'aktionsfinder-penny-123',
    title: 'PENNY Gouda 400 g',
    fullDisplayName: 'PENNY Gouda 400 g',
    description: 'Kaese / 400 g',
    discountedPrice: 2.49,
    originalPrice: 3.49,
    currency: {
      iso: 'EUR',
      symbol: 'EUR',
    },
    image: {
      small: 'https://example.test/gouda.jpg',
      medium: 'https://example.test/gouda.jpg',
    },
    productGroups: [{ title: 'Lebensmittel' }],
    product: {
      productQuantity: 400,
      productQuantityUnit: {
        shortName: 'g',
        type: 'PRODUCT',
      },
    },
    ...overrides,
  };
}

function normalize(overrides = {}, retailerKey = 'penny') {
  return normalizePromotionToOffer({
    promotion: promotion(overrides),
    retailerKey,
    retailerName: retailerKey === 'penny' ? 'PENNY' : 'BILLA',
    sourceId: 'source-a',
    crawlJobId: 'crawl-a',
    region: 'Grossraum Graz',
    sourceUrl: `https://www.aktionsfinder.at/pv/${retailerKey}/`,
  });
}

test('direct offer-level leafletHref range maps to validFrom and validTo', () => {
  const offer = normalize({
    leafletHref: '/l/penny-flugblatt-30-04-2026-27-05-2026/',
    clickoutUrl: 'https://www.aktionsfinder.at/l/penny-flugblatt-30-04-2026-27-05-2026/',
  });

  assert.equal(offer.validFrom.toISOString(), '2026-04-30T12:00:00.000Z');
  assert.equal(offer.validTo.toISOString(), '2026-05-27T23:59:59.999Z');
  assert.equal(offer.rawFacts.validitySource, 'aktionsfinder-leaflet-range');
  assert.equal(offer.rawFacts.validityText, 'ab 2026-04-30 bis 2026-05-27');
  assert.equal(offer.rawFacts.validFrom, '2026-04-30T12:00:00.000Z');
  assert.equal(offer.rawFacts.validTo, '2026-05-27T23:59:59.999Z');
  assert.equal(offer.rawFacts.leafletHref, '/l/penny-flugblatt-30-04-2026-27-05-2026/');
  assert.equal(offer.rawFacts.clickoutUrl, 'https://www.aktionsfinder.at/l/penny-flugblatt-30-04-2026-27-05-2026/');
  assert.equal(offer.rawFacts.promotionId, 'aktionsfinder-penny-123');
});

test('page-level leafletHref is not treated as offer validity', () => {
  const offer = normalize({
    sourceMetadata: {
      leafletHref: '/l/penny-flugblatt-30-04-2026-27-05-2026/',
    },
    clickoutUrl: 'https://www.aktionsfinder.at/ppcv/kaese/penny/',
  });

  assert.equal(offer.validFrom, null);
  assert.equal(offer.validTo, null);
  assert.equal(offer.rawFacts.validitySource, undefined);
  assert.equal(offer.rawFacts.validFrom, undefined);
  assert.equal(offer.rawFacts.validTo, undefined);
});

test('fetchedAt and observedAt are never used as offer validity', () => {
  const evidence = buildSafeOfferValidityEvidence({
    id: 'unsafe',
    fetchedAt: '2026-05-08T12:00:00.000Z',
    observedAt: '2026-05-08T12:00:00.000Z',
    clickoutUrl: 'https://www.aktionsfinder.at/pv/penny/',
  });
  const offer = normalize({
    id: 'unsafe',
    fetchedAt: '2026-05-08T12:00:00.000Z',
    observedAt: '2026-05-08T12:00:00.000Z',
    clickoutUrl: 'https://www.aktionsfinder.at/pv/penny/',
  });

  assert.equal(evidence.isSafe, false);
  assert.equal(offer.validFrom, null);
  assert.equal(offer.validTo, null);
  assert.equal(offer.rawFacts.validitySource, undefined);
});

test('other retailers only get validity with the same direct offer-level proof', () => {
  const safeBilla = normalize({
    id: 'aktionsfinder-billa-123',
    leafletHref: '/l/billa-flugblatt-30-04-2026-27-05-2026/',
    clickoutUrl: 'https://www.aktionsfinder.at/l/billa-flugblatt-30-04-2026-27-05-2026/',
  }, 'billa');
  const unsafeBilla = normalize({
    id: 'aktionsfinder-billa-unsafe',
    clickoutUrl: 'https://www.aktionsfinder.at/pv/billa/',
  }, 'billa');

  assert.equal(safeBilla.validFrom.toISOString(), '2026-04-30T12:00:00.000Z');
  assert.equal(safeBilla.validTo.toISOString(), '2026-05-27T23:59:59.999Z');
  assert.equal(safeBilla.rawFacts.validitySource, 'aktionsfinder-leaflet-range');
  assert.equal(unsafeBilla.validFrom, null);
  assert.equal(unsafeBilla.validTo, null);
  assert.equal(unsafeBilla.rawFacts.validitySource, undefined);
});

test('uses product brand as category context for oral care offers with generic titles', () => {
  const offer = normalize({
    id: 'aktionsfinder-bipa-oral-b-io',
    title: 'IO Series 10 Black',
    fullDisplayName: 'IO Series 10 Black',
    description: '',
    productGroups: [{ title: 'Drogerie' }],
    product: {
      brand: { name: 'Oral-B' },
      productQuantity: 1,
      productQuantityUnit: {
        shortName: 'Stk',
        type: 'PRODUCT',
      },
    },
  }, 'bipa');

  assert.equal(offer.categoryPrimary, 'Drogerie / Hygiene');
  assert.equal(offer.categorySecondary, 'Mund- & Zahnpflege');
});

test('Aktionsfinder URL ranges parse requested date formats until end of day', () => {
  const first = buildSafeOfferValidityEvidence({
    clickoutUrl: 'https://www.aktionsfinder.at/l/spar-flugblatt-16-04-2026-06-05-2026/',
  });
  const second = buildSafeOfferValidityEvidence({
    clickoutUrl: 'https://www.aktionsfinder.at/l/spar-flugblatt-26-02-2026-11-03-2026/',
  });

  assert.equal(first.validFrom.toISOString(), '2026-04-16T12:00:00.000Z');
  assert.equal(first.validTo.toISOString(), '2026-05-06T23:59:59.999Z');
  assert.equal(second.validFrom.toISOString(), '2026-02-26T12:00:00.000Z');
  assert.equal(second.validTo.toISOString(), '2026-03-11T23:59:59.999Z');
});

test('explicit expired status overrides missing validTo and snapshotCurrent', () => {
  const offer = normalize({
    id: 'aktionsfinder-spar-goesser-expired',
    title: 'Goesser Maerzen SPAR 0.50 Liter 20 Stueck',
    fullDisplayName: 'Goesser Maerzen SPAR 0.50 Liter 20 Stueck',
    clickoutUrl: 'https://www.aktionsfinder.at/pv/spar/',
    status: 'abgelaufen',
    snapshotCurrent: true,
  }, 'spar');

  assert.equal(offer.status, 'expired');
  assert.equal(offer.isActiveNow, false);
  assert.equal(offer.rawFacts.explicitExpired, true);
  assert.equal(offer.isMultiBuy, false);
  assert.equal(offer.minimumPurchaseQty, 1);
});

test('past Aktionsfinder URL validity is stored as expired and not active', () => {
  const offer = normalize({
    id: 'aktionsfinder-spar-goesser-past-range',
    title: 'Goesser Maerzen EUROSPAR 0.50 Liter 20 Stueck',
    fullDisplayName: 'Goesser Maerzen EUROSPAR 0.50 Liter 20 Stueck',
    clickoutUrl: 'https://www.aktionsfinder.at/l/spar-flugblatt-26-02-2026-11-03-2026/',
  }, 'spar');

  assert.equal(offer.validTo.toISOString(), '2026-03-11T23:59:59.999Z');
  assert.equal(offer.status, 'expired');
  assert.equal(offer.isActiveNow, false);
  assert.equal(offer.isMultiBuy, false);
  assert.equal(offer.minimumPurchaseQty, 1);
});

test('missing validTo without expiry evidence remains active for current source snapshots', () => {
  const offer = normalize({
    clickoutUrl: 'https://www.aktionsfinder.at/pv/billa/',
    snapshotCurrent: true,
  }, 'billa');

  assert.equal(offer.validTo, null);
  assert.equal(offer.status, 'active');
  assert.equal(offer.isActiveNow, true);
});
