const assert = require('node:assert/strict');
const test = require('node:test');
const axios = require('axios');
const { Types } = require('mongoose');
const { __private } = require('../src/services/crawl/officialSourceCrawler');
const { enrichOffersForStorage } = require('../src/services/crawl/offerAuditEnrichment');
const { buildRankedOffer, buildValidityLabel } = require('../src/services/offers/offerRankingService');
const { RETAILER_DEFINITIONS } = require('../src/services/sources/sourceDefinitions');
const { deriveSourceKey } = require('../src/services/crawl/crawlSourceSelection');
const {
  PDF_WEB_PRICE_QUANTITY_CONFLICT_REASON,
  PUBLIC_PDF_WEB_PRICE_QUANTITY_HINT,
  buildPennyPdfEvidenceByProduct,
} = require('../src/services/crawl/evidenceConflictGuard');
const {
  extractBillaPdfCandidates,
  normalizeBillaPdfCandidatesToOffers,
  parseBillaFlyerValidity,
  parseCompressedPrice,
  sourceKeyForRetailer: billaPdfSourceKeyForRetailer,
  summarizeRejections: summarizeBillaPdfRejections,
} = require('../src/services/crawl/billaOfficialFlyerPdfParser');

function source(overrides = {}) {
  return {
    _id: new Types.ObjectId(),
    retailerKey: 'bipa',
    retailerName: 'BIPA',
    channel: 'official-site',
    sourceUrl: 'https://www.bipa.at/cp/aktionen',
    label: 'BIPA Aktionen',
    sourceType: 'offers-page',
    ...overrides,
  };
}

function formatDateAt(date) {
  return [
    String(date.getUTCDate()).padStart(2, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCFullYear()),
  ].join('.');
}

function parseBipaOffers(bodyHtml) {
  return __private.parseBipaOffersFromHtml({
    html: `<html><body>${bodyHtml}</body></html>`,
    source: source(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.bipa.at/cp/aktionen',
  });
}

function bipaMobifyHit(id, overrides = {}) {
  return {
    hitType: 'product',
    productId: `B3-${id}`,
    representedProduct: { id: `B3-${id}` },
    image: {
      link: `https://www.bipa.at/on/demandware.static/-/Sites-catalog/de_AT/v1/original/${id}.png`,
      disBaseLink: `https://www.bipa.at/dw/image/v2/AAFT_PRD/on/demandware.static/-/Sites-catalog/de_AT/v1/original/${id}.png`,
      alt: `Bild: Test Produkt ${id}`,
    },
    productName: 'BIPA Test Produkt',
    c_brand: 'BIPA',
    c_kundenbezeichnung: 'Test Produkt',
    c_inhalt: '250 ml',
    c_category: 'pflege-koerper-duschgel',
    c_displayedPrice: 2.49,
    c_insteadPrice: 3.49,
    c_basePrice: '100 ml 1,00',
    c_effectivePriceBadges: ['Aktion'],
    c_effectiveCornerBadges: [],
    ...overrides,
  };
}

function bipaMobifyHtml(hits, { bodyPrefix = '' } = {}) {
  const payload = {
    pageProps: {
      pageProps: {
        productSearchResult: {
          limit: hits.length,
          offset: 0,
          total: hits.length,
          hits,
        },
      },
    },
  };
  const links = hits.map((hit) => {
    const id = String(hit.productId || '').replace(/^B3-/, '');
    return `<a data-testid="product-tile-B3-${id}" href="/p/test-product-${id}/B3-${id}">${hit.productName || ''}</a>`;
  }).join('');

  return `
    <html><body>
      ${bodyPrefix}
      ${links}
      <script id="mobify-data" type="application/json">${JSON.stringify(payload)}</script>
    </body></html>
  `;
}

test('BIPA official parser extracts current sale price, reference price and perfume offers from current product-card markup', () => {
  const html = `
    <html><body>
      <p>Gueltig bis 20.05.2099</p>
      <a href="/p/calvin-klein-eternity/B3-123">
        <p>Calvin Klein</p>
        <p>Eternity Eau de Parfum 50ml</p>
        <p>50 ml</p>
        <p>€ 39,99</p>
        <p>€ 23,99</p>
        <p>100 ml 47,98</p>
      </a>
    </body></html>
  `;

  const offers = __private.parseBipaOffersFromHtml({
    html,
    source: source(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.bipa.at/cp/aktionen',
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].brand, 'Calvin Klein');
  assert.equal(offers[0].title, 'Eternity Eau de Parfum 50ml');
  assert.equal(offers[0].quantityText, '50 ml');
  assert.equal(offers[0].priceCurrent.amount, 23.99);
  assert.equal(offers[0].priceReference.amount, 39.99);
  assert.match(offers[0].rawFacts.infoText, /100 ml 47,98/);
  assert.equal(offers[0].normalizedUnitPrice.amount, 479.8);
  assert.equal(offers[0].normalizedUnitPrice.unit, 'l');
  assert.equal(offers[0].validTo.toISOString(), '2099-05-20T23:59:59.999Z');
  assert.equal(offers[0].rawFacts.availabilityScope.type, 'unknown');
});

test('BIPA official parser normalizes srcset-like image URLs from product cards', () => {
  const offers = __private.parseBipaOffersFromHtml({
    html: `
      <html><body>
        <a href="/p/calvin-klein-eternity/B3-123">
          <img src="https://www.bipa.at/dw/image/v2/AAFT_PRD/original/123.png?sw=140 1x, https://www.bipa.at/dw/image/v2/AAFT_PRD/original/123.png?sw=280 2x">
          <p>Calvin Klein</p>
          <p>Eternity Eau de Parfum 50ml</p>
          <p>50 ml</p>
          <p>\u20ac 39,99</p>
          <p>\u20ac 23,99</p>
        </a>
      </body></html>
    `,
    source: source(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.bipa.at/cp/aktionen',
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].imageUrl, 'https://www.bipa.at/dw/image/v2/AAFT_PRD/original/123.png?sw=140');
});

test('BIPA official parser converts relative image URLs to absolute URLs', () => {
  const offers = __private.parseBipaOffersFromHtml({
    html: `
      <html><body>
        <a href="/p/nivea-shampoo/B3-456">
          <img data-src="/dw/image/v2/AAFT_PRD/original/456.png?sw=140">
          <p>Nivea</p>
          <p>Pflege Shampoo 250ml</p>
          <p>250 ml</p>
          <p>\u20ac 4,99</p>
          <p>\u20ac 2,99</p>
        </a>
      </body></html>
    `,
    source: source(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.bipa.at/cp/aktionen',
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].imageUrl, 'https://www.bipa.at/dw/image/v2/AAFT_PRD/original/456.png?sw=140');
});

test('BIPA official parser extracts picture source srcset image URLs from product cards', () => {
  const offers = parseBipaOffers(`
    <a href="/p/no-cosmetics-hydrator/B3-100">
      <picture>
        <source srcset="/dw/image/v2/AAFT_PRD/original/100.webp?sw=140 1x, /dw/image/v2/AAFT_PRD/original/100.webp?sw=280 2x">
        <img src="/placeholder.png">
      </picture>
      <p>No Cosmetics</p>
      <p>120h Liquid Hydrator</p>
      <p>100 ml</p>
      <p>\u20ac 9,99</p>
      <p>\u20ac 8,99</p>
    </a>
  `);

  assert.equal(offers.length, 1);
  assert.equal(offers[0].imageUrl, 'https://www.bipa.at/dw/image/v2/AAFT_PRD/original/100.webp?sw=140');
});

test('BIPA official parser extracts lazy source image attributes from product cards', () => {
  const cases = [
    {
      id: '101',
      html: '<source data-srcset="/dw/image/v2/AAFT_PRD/original/101.png?sw=140 1x, /dw/image/v2/AAFT_PRD/original/101.png?sw=280 2x">',
      expected: 'https://www.bipa.at/dw/image/v2/AAFT_PRD/original/101.png?sw=140',
    },
    {
      id: '102',
      html: '<source data-src="/dw/image/v2/AAFT_PRD/original/102.png?sw=140">',
      expected: 'https://www.bipa.at/dw/image/v2/AAFT_PRD/original/102.png?sw=140',
    },
  ];

  for (const { id, html, expected } of cases) {
    const offers = parseBipaOffers(`
      <a href="/p/bipa-source-test-${id}/B3-${id}">
        ${html}
        <p>BIPA</p>
        <p>Source Test 100ml</p>
        <p>100 ml</p>
        <p>\u20ac 4,99</p>
        <p>\u20ac 2,99</p>
      </a>
    `);

    assert.equal(offers.length, 1);
    assert.equal(offers[0].imageUrl, expected);
  }
});

test('BIPA official parser extracts data-original and data-lazy-src image attributes from product cards', () => {
  const cases = [
    {
      id: '201',
      imageHtml: '<img data-original="/dw/image/v2/AAFT_PRD/original/201.png?sw=140">',
      expected: 'https://www.bipa.at/dw/image/v2/AAFT_PRD/original/201.png?sw=140',
    },
    {
      id: '202',
      imageHtml: '<img data-lazy-src="/dw/image/v2/AAFT_PRD/original/202.png?sw=140">',
      expected: 'https://www.bipa.at/dw/image/v2/AAFT_PRD/original/202.png?sw=140',
    },
  ];

  for (const { id, imageHtml, expected } of cases) {
    const offers = parseBipaOffers(`
      <a href="/p/bipa-lazy-test-${id}/B3-${id}">
        ${imageHtml}
        <p>BIPA</p>
        <p>Lazy Test 250ml</p>
        <p>250 ml</p>
        <p>\u20ac 5,99</p>
        <p>\u20ac 3,99</p>
      </a>
    `);

    assert.equal(offers.length, 1);
    assert.equal(offers[0].imageUrl, expected);
  }
});

test('BIPA official parser does not copy image URLs from neighboring product cards', () => {
  const offers = parseBipaOffers(`
    <a href="/p/first-product-without-image/B3-301">
      <p>Erste Marke</p>
      <p>Produkt ohne Bild 100ml</p>
      <p>100 ml</p>
      <p>\u20ac 4,99</p>
      <p>\u20ac 2,99</p>
    </a>
    <a href="/p/second-product-with-image/B3-302">
      <img data-original="/dw/image/v2/AAFT_PRD/original/302.png?sw=140">
      <p>Zweite Marke</p>
      <p>Produkt mit Bild 100ml</p>
      <p>100 ml</p>
      <p>\u20ac 6,99</p>
      <p>\u20ac 3,99</p>
    </a>
  `);

  assert.equal(offers.length, 2);
  assert.equal(offers[0].title, 'Produkt ohne Bild 100ml');
  assert.equal(offers[0].imageUrl, '');
  assert.equal(offers[1].title, 'Produkt mit Bild 100ml');
  assert.equal(offers[1].imageUrl, 'https://www.bipa.at/dw/image/v2/AAFT_PRD/original/302.png?sw=140');
});

test('BIPA official parser keeps valid offers when product image is missing', () => {
  const offers = __private.parseBipaOffersFromHtml({
    html: `
      <html><body>
        <a href="/p/nivea-shampoo/B3-789">
          <p>Nivea</p>
          <p>Pflege Shampoo 250ml</p>
          <p>250 ml</p>
          <p>\u20ac 4,99</p>
          <p>\u20ac 2,99</p>
        </a>
      </body></html>
    `,
    source: source(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.bipa.at/cp/aktionen',
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].imageUrl, '');
});

test('BIPA category Mobify parser extracts product image, price fields and product-near badge condition', () => {
  const offers = __private.parseBipaOffersFromHtml({
    html: bipaMobifyHtml([
      bipaMobifyHit('716480', {
        c_brand: 'BI CARE',
        productName: 'BI CARE Deo Roll-On Woman Extra Dry',
        c_kundenbezeichnung: 'Deo Roll-On Woman Extra Dry',
        c_displayedPrice: 0.89,
        c_insteadPrice: 0.99,
        c_basePrice: '100 ml 1,78',
      }),
    ]),
    source: source({ sourceUrl: 'https://www.bipa.at/c/pflege?limit=20&refine_0=c_pricebadges%3DAktion' }),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.bipa.at/c/pflege?limit=20&refine_0=c_pricebadges%3DAktion',
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].brand, 'BI CARE');
  assert.equal(offers[0].title, 'Deo Roll-On Woman Extra Dry');
  assert.equal(offers[0].sourceUrl, 'https://www.bipa.at/p/test-product-716480/B3-716480');
  assert.equal(offers[0].imageUrl, 'https://www.bipa.at/on/demandware.static/-/Sites-catalog/de_AT/v1/original/716480.png');
  assert.equal(offers[0].priceCurrent.amount, 0.89);
  assert.equal(offers[0].priceReference.amount, 0.99);
  assert.equal(offers[0].normalizedUnitPrice.amount, 17.8);
  assert.equal(offers[0].normalizedUnitPrice.unit, 'l');
  assert.equal(offers[0].conditionsText, 'Aktion');
  assert.equal(offers[0].rawFacts.sourceType, __private.BIPA_OFFICIAL_CATEGORY_SOURCE_TYPE);
  assert.equal(offers[0].rawFacts.bipaProductId, '716480');
});

test('BIPA Online-only Mobify parser marks offers with explicit online-only condition', () => {
  const onlineSource = source({
    label: 'BIPA Online Only',
    sourceUrl: 'https://www.bipa.at/cp/onlineonly',
    sourceType: 'bipa-official-onlineonly',
    crawlPolicy: {
      forcedConditionText: 'Online only',
      landingPageOnly: true,
    },
  });
  const offers = __private.parseBipaOffersFromHtml({
    html: bipaMobifyHtml([
      bipaMobifyHit('716480', {
        c_brand: 'AIR WICK',
        productName: 'AIR WICK Raumduft Hawaii',
        c_kundenbezeichnung: 'Raumduft Hawaii',
        c_category: 'haushalt-raumduft',
        c_displayedPrice: 24.99,
        c_insteadPrice: null,
        c_basePrice: '',
        c_effectivePriceBadges: [],
      }),
    ]),
    source: onlineSource,
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: onlineSource.sourceUrl,
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].conditionsText, 'Online only');
  assert.equal(offers[0].customerProgramRequired, false);
  assert.equal(offers[0].rawFacts.sourceType, 'bipa-official-onlineonly');
  assert.equal(offers[0].categoryPrimary, 'Haushalt');
});

test('BIPA official enrichment keeps perfume unit prices comparable and ignores LSF plus signs as quantities', () => {
  const testSource = source({ sourceUrl: 'https://www.bipa.at/c/parfum?limit=20&refine_0=c_pricebadges%3DAktion' });
  const crawlJobId = new Types.ObjectId();
  const offers = __private.parseBipaOffersFromHtml({
    html: bipaMobifyHtml([
      bipaMobifyHit('364935', {
        c_brand: 'Hugo Boss',
        productName: 'Hugo Boss Man Eau de Toilette 75ml',
        c_kundenbezeichnung: 'Man Eau de Toilette',
        c_inhalt: '75 ml',
        c_category: 'parfum-herrenduefte',
        c_displayedPrice: 26.99,
        c_insteadPrice: 39.99,
        c_basePrice: '',
        c_effectivePriceBadges: ['Aktion'],
      }),
      bipaMobifyHit('681309', {
        c_brand: 'BI CARE',
        productName: 'BI CARE SUN After Sun Kuehlende Lotion 50ml',
        c_kundenbezeichnung: 'After Sun Kuehlende Lotion LSF 50+',
        c_inhalt: '50 ml',
        c_category: 'pflege-sonnenschutz',
        c_displayedPrice: 2.99,
        c_insteadPrice: null,
        c_basePrice: '',
        c_effectivePriceBadges: ['2+1 Gratis'],
      }),
    ]),
    source: testSource,
    crawlJobId,
    region: 'AT',
    pageUrl: testSource.sourceUrl,
  });
  const stored = enrichOffersForStorage(offers, {
    source: testSource,
    sourceType: 'bipa-official-html',
    parserVersion: 'official-v3-coverage',
    normalizationVersion: 'v3-audit',
  });
  const hugo = stored.find((offer) => offer.brand === 'Hugo Boss');
  const sun = stored.find((offer) => offer.brand === 'BI CARE');

  assert.equal(hugo.quantityText, '75 ml');
  assert.equal(hugo.totalComparableAmount, 0.075);
  assert.equal(hugo.comparableUnit, 'l');
  assert.equal(hugo.normalizedUnitPrice.amount, 359.87);
  assert.equal(hugo.quality.comparisonSafe, true);
  assert.equal(hugo.categoryPrimary, 'Drogerie / Hygiene');
  assert.equal(hugo.categorySecondary, 'Kosmetik & Make-up');
  assert.equal(sun.conditionsText, '2+1 Gratis');
  assert.equal(sun.minimumPurchaseQty, 3);
  assert.equal(sun.isMultiBuy, true);
  assert.doesNotMatch(sun.conditionsText, /50\+2/);
  assert.equal(sun.categoryPrimary, 'Drogerie / Hygiene');
  assert.equal(sun.categorySecondary, 'Koerperpflege');
});

test('BIPA category Mobify parser keeps offers without image and rejects mismatched product image IDs', () => {
  const offers = __private.parseBipaOffersFromHtml({
    html: bipaMobifyHtml([
      bipaMobifyHit('222111', {
        image: {
          link: 'https://www.bipa.at/on/demandware.static/-/Sites-catalog/de_AT/v1/original/999999.png',
        },
      }),
      bipaMobifyHit('333111', {
        image: {},
      }),
    ]),
    source: source({ sourceUrl: 'https://www.bipa.at/c/haushalt?limit=20&refine_0=c_pricebadges%3DAktion' }),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.bipa.at/c/haushalt?limit=20&refine_0=c_pricebadges%3DAktion',
  });

  assert.equal(offers.length, 2);
  assert.equal(offers[0].rawFacts.bipaProductId, '222111');
  assert.equal(offers[0].imageUrl, '');
  assert.equal(offers[1].rawFacts.bipaProductId, '333111');
  assert.equal(offers[1].imageUrl, '');
});

test('BIPA category Mobify parser does not copy global page badges as product conditions', () => {
  const offers = __private.parseBipaOffersFromHtml({
    html: bipaMobifyHtml([
      bipaMobifyHit('444111', {
        c_effectivePriceBadges: [],
      }),
    ], {
      bodyPrefix: '<div class="global-promo">1+1 gratis nur im Seitenbanner</div>',
    }),
    source: source({ sourceUrl: 'https://www.bipa.at/c/pflege?limit=20&refine_0=c_pricebadges%3DAktion' }),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.bipa.at/c/pflege?limit=20&refine_0=c_pricebadges%3DAktion',
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].conditionsText, '');
  assert.deepEqual(offers[0].rawFacts.priceBadges, []);
});

test('BIPA category action URL config uses pricebadge filters', () => {
  assert.ok(__private.BIPA_CATEGORY_ACTION_PAGES.length >= 10);
  assert.ok(__private.BIPA_CATEGORY_ACTION_PAGES.every((url) => url.startsWith('https://www.bipa.at/c/')));
  assert.ok(__private.BIPA_CATEGORY_ACTION_PAGES.every((url) => url.includes('refine_0=c_pricebadges')));
});

test('BIPA promotion link discovery ignores unfiltered category pages', () => {
  const links = __private.collectBipaPromotionLinks(`
    <a href="/c/pflege">Pflege</a>
    <a href="/c/pflege?limit=20&refine_0=c_pricebadges%3DAktion">Pflege Aktionen</a>
    <a href="/cp/onlineonly">Online Only</a>
  `, 'https://www.bipa.at/cp/aktionen');

  assert.deepEqual(links.map((link) => link.url), [
    'https://www.bipa.at/c/pflege?limit=20&refine_0=c_pricebadges%3DAktion',
    'https://www.bipa.at/cp/onlineonly',
  ]);
});

test('BIPA official dedupe prefers product ID across category pages', () => {
  const offers = __private.dedupeBipaOffers([
    {
      title: 'Test Produkt',
      brand: 'BIPA',
      sourceUrl: 'https://www.bipa.at/p/test-product/B3-555111',
      priceCurrent: { amount: 1.99 },
      quantityText: '100 ml',
      rawFacts: { bipaProductId: '555111' },
    },
    {
      title: 'Test Produkt anderer Kategorie',
      brand: 'BIPA',
      sourceUrl: 'https://www.bipa.at/p/test-product/B3-555111',
      priceCurrent: { amount: 1.99 },
      quantityText: '100 ml',
      rawFacts: { bipaProductId: '555111' },
    },
  ]);

  assert.equal(offers.length, 1);
  assert.equal(offers[0].rawFacts.bipaProductId, '555111');
});

test('BIPA official parser keeps snapshot offers when stale page-level validity text is present', () => {
  const html = `
    <html><body>
      <p>Gueltig bis 01.01.2001</p>
      <a href="/p/calvin-klein-eternity-eau-de-parfum-50ml/B3-106734">
        <p>Calvin Klein</p>
        <p>Eternity Eau de Parfum 50ml</p>
        <p>50 ml</p>
        <p>€ 39,99</p>
        <p>€ 23,99</p>
        <p>100 ml 47,98</p>
      </a>
    </body></html>
  `;
  const testSource = source();
  const crawlJobId = new Types.ObjectId();

  const offers = __private.parseBipaOffersFromHtml({
    html,
    source: testSource,
    crawlJobId,
    region: 'AT',
    pageUrl: 'https://www.bipa.at/cp/aktionen',
  });
  const enriched = enrichOffersForStorage(offers, {
    source: testSource,
    sourceType: 'bipa-official-html',
    parserVersion: 'official-v3-coverage',
    normalizationVersion: 'v3-audit',
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].title, 'Eternity Eau de Parfum 50ml');
  assert.equal(offers[0].quantityText, '50 ml');
  assert.equal(offers[0].priceCurrent.amount, 23.99);
  assert.equal(offers[0].priceReference.amount, 39.99);
  assert.equal(offers[0].normalizedUnitPrice.amount, 479.8);
  assert.equal(offers[0].normalizedUnitPrice.unit, 'l');
  assert.equal(offers[0].validTo, null);
  assert.equal(offers[0].status, 'active');
  assert.equal(offers[0].isActiveNow, true);
  assert.equal(buildValidityLabel(enriched[0]), 'Aktuell gefunden - bitte im Markt pruefen.');
  assert.equal(enriched.length, 1);
  assert.equal(enriched[0].reviewReasons.includes('missing-title'), false);
  assert.equal(enriched[0].reviewReasons.includes('missing-current-price'), false);
});

test('BIPA official parser ignores same-day page-level validity and keeps future validity evidence', () => {
  const today = formatDateAt(new Date());
  const future = new Date();
  future.setUTCDate(future.getUTCDate() + 7);
  const futureLabel = formatDateAt(future);
  const productHtml = `
    <a href="/p/versace-bright-crystal-eau-de-toilette-30ml/B3-607900">
      <p>Versace</p>
      <p>Bright Crystal Eau de Toilette 30ml</p>
      <p>30 ml</p>
      <p>â‚¬ 44,99</p>
      <p>â‚¬ 32,99</p>
      <p>100 ml 109,97</p>
    </a>
  `;

  const sameDayOffers = __private.parseBipaOffersFromHtml({
    html: `<html><body><p>Gueltig bis ${today}</p>${productHtml}</body></html>`,
    source: source(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.bipa.at/cp/aktionen',
  });
  const futureOffers = __private.parseBipaOffersFromHtml({
    html: `<html><body><p>Gueltig bis ${futureLabel}</p>${productHtml}</body></html>`,
    source: source(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.bipa.at/cp/aktionen',
  });

  assert.equal(sameDayOffers.length, 1);
  assert.equal(sameDayOffers[0].validTo, null);
  assert.equal(sameDayOffers[0].status, 'active');
  assert.equal(sameDayOffers[0].isActiveNow, true);
  assert.ok(futureOffers[0].validTo instanceof Date);
  assert.equal(futureOffers[0].validTo.toISOString().slice(0, 10), future.toISOString().slice(0, 10));
});

test('BIPA official parser derives ml unit price from package size when source base price is missing', () => {
  const offers = __private.parseBipaOffersFromHtml({
    html: `
      <html><body>
        <a href="/p/calvin-klein-one-eau-de-toilette-100ml/B3-106748">
          <p>Calvin Klein</p>
          <p>One Eau de Toilette 100ml</p>
          <p>100 ml</p>
          <p>â‚¬ 26,99</p>
          <p>â‚¬ 18,99</p>
        </a>
      </body></html>
    `,
    source: source(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.bipa.at/cp/aktionen',
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].quantityText, '100 ml');
  assert.equal(offers[0].priceCurrent.amount, 18.99);
  assert.equal(offers[0].normalizedUnitPrice.amount, 189.9);
  assert.equal(offers[0].normalizedUnitPrice.unit, 'l');
});

test('BIPA official enrichment derives visible ml quantity from product title when package field is missing', () => {
  const testSource = source({ sourceUrl: 'https://www.bipa.at/c/parfum?limit=20&refine_0=c_pricebadges%3DAktion' });
  const rawOffers = __private.parseBipaOffersFromHtml({
    html: bipaMobifyHtml([
      bipaMobifyHit('123456', {
        c_brand: 'Hugo Boss',
        productName: 'Hugo Boss Bottled Eau de Toilette 100ml',
        c_kundenbezeichnung: 'Bottled Eau de Toilette 100ml',
        c_inhalt: '',
        c_category: 'parfum-herrenduefte',
        c_displayedPrice: 57.99,
        c_insteadPrice: 79.99,
        c_basePrice: '',
      }),
    ]),
    source: testSource,
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: testSource.sourceUrl,
  });
  const offers = enrichOffersForStorage(rawOffers, {
    source: testSource,
    sourceType: 'bipa-official-html',
    parserVersion: 'official-v3-coverage',
    normalizationVersion: 'v3-audit',
  });

  assert.equal(rawOffers.length, 1);
  assert.equal(rawOffers[0].quantityText, '');
  assert.equal(offers.length, 1);
  assert.equal(offers[0].quantityText, '100 ml');
  assert.equal(offers[0].priceCurrent.amount, 57.99);
  assert.equal(offers[0].normalizedUnitPrice.amount, 579.9);
  assert.equal(offers[0].normalizedUnitPrice.unit, 'l');
});

test('dm official sale parser only treats Ausverkauf product text as offers and preserves previous price evidence', () => {
  const html = `
    <html><body>
      <h1>Ausverkauf</h1>
      Marke: Sportness; Produktname: Proteinriegel Popcorn Salted Caramel Geschmack 30%, 40 g; Preis: 0,80 €; Grundpreis: 0,04 kg (20,00 € je 1 kg); Ausverkauf Grafik; Verfügbarkeit: Status Grün Lieferbar, Status Grau dm Markt wählen
      Aktueller Preis:0,80 € | Vorheriger Preis: 1,35 €
      Sportness Proteinriegel Popcorn Salted Caramel Geschmack 30%, 40 g
      Ende der Auflistung
    </body></html>
  `;

  const offers = __private.parseDmSaleOffersFromHtml({
    html,
    source: source({
      retailerKey: 'dm',
      retailerName: 'dm',
      sourceUrl: 'https://www.dm.at/ausverkauf',
      label: 'dm Ausverkauf',
    }),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.dm.at/ausverkauf',
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].brand, 'Sportness');
  assert.match(offers[0].title, /Proteinriegel/);
  assert.equal(offers[0].quantityText, '40 g');
  assert.equal(offers[0].priceCurrent.amount, 0.8);
  assert.equal(offers[0].priceReference.amount, 1.35);
  assert.equal(offers[0].conditionsText, 'Ausverkauf; nur solange der Vorrat reicht');
  assert.equal(offers[0].rawFacts.availabilityScope.type, 'unknown');
});

function dmProduct(overrides = {}) {
  return {
    gtin: overrides.gtin || 4067796100112,
    dan: overrides.dan || 3087729,
    brandName: overrides.brandName || 'Sportness',
    title: overrides.title || 'Proteinriegel Popcorn Salted Caramel Geschmack 30%, 40 g',
    tileData: {
      a11yLabel: overrides.a11yLabel || 'Marke: Sportness; Produktname: Proteinriegel Popcorn Salted Caramel Geschmack 30%, 40 g; Preis: 0,80\u00a0\u20ac; Grundpreis: 0,04 kg (20,00\u00a0\u20ac je 1 kg); Ausverkauf Grafik',
      brand: { name: overrides.brandName || 'Sportness' },
      dan: overrides.dan || 3087729,
      eyecatchers: overrides.eyecatchers || [{ alt: 'Ausverkauf Grafik' }],
      gtin: overrides.gtin || 4067796100112,
      images: overrides.images || [{ tileSrc: 'https://products.dm-static.com/example.jpg' }],
      price: overrides.price || {
        prefix: 'Einzelpreis',
        price: {
          current: { a11yLabel: 'Aktueller Preis:', value: '0,80\u00a0\u20ac' },
          previous: { a11yLabel: 'Vorheriger Preis:', value: '1,35\u00a0\u20ac' },
        },
        tileInfos: ['0,04 kg (20,00\u00a0\u20ac je 1 kg)'],
      },
      self: overrides.self || '/p/sportness-proteinriegel-popcorn-salted-caramel-geschmack-30-prozent-p3087729',
      title: overrides.title || 'Proteinriegel Popcorn Salted Caramel Geschmack 30%, 40 g',
    },
    ...overrides,
  };
}

function dmOfficialSource() {
  return source({
    retailerKey: 'dm',
    retailerName: 'dm',
    sourceUrl: 'https://www.dm.at/ausverkauf',
    label: 'dm Ausverkauf',
  });
}

test('dm product-search Ausverkauf parser stores current price, previous price, base price and quantity', () => {
  const diagnostics = {};
  const offers = __private.parseDmSaleOffersFromProductSearchJson({
    payload: { products: [dmProduct()], count: 1, currentPage: 0, pageSize: 48, totalPages: 1 },
    source: dmOfficialSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.dm.at/ausverkauf',
    diagnostics,
  });

  assert.equal(offers.length, 1);
  assert.equal(diagnostics.rawProducts, 1);
  assert.equal(diagnostics.parsedOffers, 1);
  assert.equal(offers[0].brand, 'Sportness');
  assert.match(offers[0].title, /Proteinriegel/);
  assert.equal(offers[0].quantityText, '40 g');
  assert.equal(offers[0].priceCurrent.amount, 0.8);
  assert.equal(offers[0].priceReference.amount, 1.35);
  assert.equal(offers[0].normalizedUnitPrice.amount, 20);
  assert.equal(offers[0].normalizedUnitPrice.unit, 'kg');
  assert.equal(offers[0].rawFacts.dmDan, 3087729);
});

test('dm content endpoint grid extraction finds nested DMSearchProductGrid sellout query', () => {
  const payload = {
    type: 'Page',
    mainData: [
      { type: 'DMText', data: { text: 'Ausverkauf' } },
      {
        type: 'Container',
        data: {
          children: [
            {
              type: 'DMSearchProductGrid',
              query: {
                queryTerms: '',
                sort: 'rating',
                filters: 'isSellout:true',
                numberOfProducts: { desktop: 10, mobile: 10 },
              },
            },
          ],
        },
      },
    ],
  };

  const query = __private.extractDmSaleGridQuery(payload);

  assert.equal(query.sort, 'rating');
  assert.equal(query.filters, 'isSellout:true');
});

test('dm product-search URL uses zero-based currentPage pagination', () => {
  const first = new URL(__private.buildDmSaleProductSearchUrl({ sort: 'rating', filters: 'isSellout:true' }, 0));
  const second = new URL(__private.buildDmSaleProductSearchUrl({ sort: 'rating', filters: 'isSellout:true' }, 1));

  assert.equal(first.searchParams.get('currentPage'), '0');
  assert.equal(first.searchParams.get('page'), null);
  assert.equal(second.searchParams.get('currentPage'), '1');
  assert.equal(second.searchParams.get('pageSize'), '48');
  assert.equal(second.searchParams.get('filters'), 'isSellout:true');
});

test('dm product-search pagination keeps already loaded pages when a later page is rate-limited', async () => {
  const originalGet = axios.get;
  const calls = [];

  axios.get = async (url) => {
    calls.push(url);

    if (url.includes('rootpage-dm-shop-de-at/ausverkauf')) {
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: {
          type: 'Page',
          mainData: [{ type: 'DMSearchProductGrid', query: { sort: 'rating', filters: 'isSellout:true' } }],
        },
        config: { url },
      };
    }

    if (url.includes('currentPage=0')) {
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: {
          products: [dmProduct()],
          count: 2,
          currentPage: 0,
          pageSize: 48,
          totalPages: 2,
        },
        config: { url },
      };
    }

    return {
      status: 429,
      headers: { 'content-type': 'application/json' },
      data: { message: 'Too many requests' },
      config: { url },
    };
  };

  try {
    const result = await __private.fetchDmSaleProductSearchPages({ sourceUrl: 'https://www.dm.at/ausverkauf' });

    assert.equal(result.pages.length, 1);
    assert.equal(result.pages[0].payload.products.length, 1);
    assert.equal(result.diagnostics.productSearchPages.length, 2);
    assert.equal(result.diagnostics.productSearchError.page, 1);
    assert.equal(result.diagnostics.productSearchError.diagnostic.httpStatus, 429);
    assert.ok(calls.some((url) => url.includes('currentPage=0')));
    assert.ok(calls.some((url) => url.includes('currentPage=1')));
  } finally {
    axios.get = originalGet;
  }
});

test('dm diagnostic message identifies product-search count=0', () => {
  const message = __private.summarizeDmOfficialSaleMessage({
    gridFound: true,
    rawProducts: 0,
    productSearchPages: [{ httpStatus: 200, isJson: true, count: 0, currentPage: 0, pageSize: 48, totalPages: 0, rawProducts: 0 }],
    parsedBeforeEnrichment: 0,
    enrichedBeforeDedupe: 0,
  });

  assert.equal(message, 'dm product search count=0.');
});

test('dm diagnostic message identifies non-json/html content response', () => {
  const message = __private.summarizeDmOfficialSaleMessage({
    error: 'dm endpoint returned non-json/html',
    failureStage: 'dm content endpoint',
    errorDiagnostic: {
      httpStatus: 200,
      isHtml: true,
      bodyPreview: '<!DOCTYPE html><html><body>blocked</body></html>',
    },
  });

  assert.match(message, /dm content endpoint failed: HTTP 200 html dm endpoint returned non-json\/html/);
  assert.match(message, /preview="<!DOCTYPE html>/);
});

test('dm diagnostic message identifies product-search HTTP errors', () => {
  const message = __private.summarizeDmOfficialSaleMessage({
    error: 'dm endpoint returned HTTP 403',
    failureStage: 'dm product search',
    errorDiagnostic: {
      httpStatus: 403,
      isHtml: false,
      bodyPreview: '{"message":"Forbidden"}',
    },
  });

  assert.match(message, /dm product search failed: HTTP 403 dm endpoint returned HTTP 403/);
});

test('dm diagnostic message identifies all-product skip reasons', () => {
  const diagnostics = {};
  const offers = __private.parseDmSaleOffersFromProductSearchJson({
    payload: {
      products: [
        dmProduct({
          a11yLabel: 'Marke: Balea; Produktname: Duschgel 300 ml; Ausverkauf Grafik',
          price: {
            prefix: 'Einzelpreis',
            price: { current: { value: '' } },
            tileInfos: ['0,30 l'],
          },
        }),
      ],
    },
    source: dmOfficialSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.dm.at/ausverkauf',
    diagnostics,
  });
  const message = __private.summarizeDmOfficialSaleMessage({
    rawProducts: diagnostics.rawProducts,
    parsedBeforeEnrichment: offers.length,
    enrichedBeforeDedupe: 0,
    skipReasons: diagnostics.skipReasons,
    productSearchPages: [{ httpStatus: 200, isJson: true, count: 1, currentPage: 0, pageSize: 48, totalPages: 1, rawProducts: 1 }],
  });

  assert.equal(offers.length, 0);
  assert.equal(diagnostics.skipReasons['missing-current-price'], 1);
  assert.match(message, /All dm products skipped: missing-current-price/);
});

test('dm product-search Ausverkauf parser keeps offers without validTo and labels validity conservatively', () => {
  const testSource = dmOfficialSource();
  const offers = __private.parseDmSaleOffersFromProductSearchJson({
    payload: { products: [dmProduct()] },
    source: testSource,
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.dm.at/ausverkauf',
  });
  const enriched = enrichOffersForStorage(offers, {
    source: testSource,
    sourceType: 'dm-official-product-search',
    parserVersion: 'official-v3-coverage',
    normalizationVersion: 'v3-audit',
  });

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0].validTo, null);
  assert.equal(enriched[0].status, 'active');
  assert.equal(enriched[0].isActiveNow, true);
  assert.equal(buildValidityLabel(enriched[0]), 'Aktuell gefunden - bitte im Markt pruefen.');
});

test('dm product-search parser rejects products without Ausverkauf context', () => {
  const product = dmProduct({
    a11yLabel: 'Marke: Balea; Produktname: Duschgel 300 ml; Preis: 0,95\u00a0\u20ac; Grundpreis: 0,30 l (3,17\u00a0\u20ac je 1 l)',
    brandName: 'Balea',
    title: 'Duschgel 300 ml',
    eyecatchers: [],
    price: {
      prefix: 'Einzelpreis',
      price: {
        current: { a11yLabel: 'Aktueller Preis:', value: '0,95\u00a0\u20ac' },
      },
      tileInfos: ['0,30 l (3,17\u00a0\u20ac je 1 l)'],
    },
  });
  const offers = __private.parseDmSaleOffersFromProductSearchJson({
    payload: { products: [product] },
    source: dmOfficialSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.dm.at/pflege-und-parfum/parfum',
  });

  assert.equal(offers.length, 0);
});

test('dm product-search parser ignores historical text as validTo and keeps direct source savings', () => {
  const offers = __private.parseDmSaleOffersFromProductSearchJson({
    payload: {
      products: [dmProduct({
        a11yLabel: 'Marke: Sportness; Produktname: Proteinriegel Popcorn Salted Caramel Geschmack 30%, 40 g; Preis: 0,80\u00a0\u20ac; Grundpreis: 0,04 kg (20,00\u00a0\u20ac je 1 kg); Ausverkauf Grafik; Gueltig bis 01.01.2001',
      })],
    },
    source: dmOfficialSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.dm.at/ausverkauf',
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].validTo, null);
  assert.equal(offers[0].benefitType, 'price-cut');
  assert.equal(offers[0].priceReference.amount, 1.35);
  assert.equal(offers[0].rawFacts.priceReferenceSource, 'dm-product-search-previous-price');
});

test('dm product-search parser normalizes 100 ml base prices and classifies perfume as drogerie', () => {
  const offers = __private.parseDmSaleOffersFromProductSearchJson({
    payload: {
      products: [dmProduct({
        brandName: 'Hugo Boss',
        title: 'Deep Red Eau de Parfum 50 ml',
        a11yLabel: 'Marke: Hugo Boss; Produktname: Deep Red Eau de Parfum 50 ml; Preis: 24,99\u00a0\u20ac; Grundpreis: 50 ml (49,98\u00a0\u20ac je 100 ml); Ausverkauf Grafik',
        price: {
          prefix: 'Einzelpreis',
          price: {
            current: { a11yLabel: 'Aktueller Preis:', value: '24,99\u00a0\u20ac' },
            previous: { a11yLabel: 'Vorheriger Preis:', value: '39,99\u00a0\u20ac' },
          },
          tileInfos: ['50 ml (49,98\u00a0\u20ac je 100 ml)'],
        },
      })],
    },
    source: dmOfficialSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.dm.at/ausverkauf',
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].quantityText, '50 ml');
  assert.equal(offers[0].normalizedUnitPrice.amount, 499.8);
  assert.equal(offers[0].normalizedUnitPrice.unit, 'l');
  assert.equal(offers[0].categoryPrimary, 'Drogerie / Hygiene');
  assert.equal(offers[0].categorySecondary, 'Kosmetik & Make-up');
});

function hoferOfficialSource() {
  return source({
    retailerKey: 'hofer',
    retailerName: 'Hofer',
    channel: 'official-flyer',
    sourceUrl: 'https://www.hofer.at/de/angebote/aktuelle-flugblaetter-und-broschuren.html',
    label: 'HOFER aktuelle Flugblaetter und Broschueren',
  });
}

function hoferCard({
  title = 'CUCINA Cantuccini, Klassik',
  price = '\u20ac 1,69',
  oldPrice = 'Statt \u20ac 2,49',
  additionalInfo = 'per Packung (100 per Gramm = \u20ac 0,56 )',
  href = '/de/p.cucina-cantuccini-klassik.000000000000700001.html',
  image = '/is/image/aldi/202605070007',
  extraText = '',
} = {}) {
  return `
    <a href="${href}">
      <div class="item plp_product">
        <img class="at-product-images_img" data-srcset="${image} 1x, ${image.replace('0007', '0007-large')} 2x">
        <h2 class="product-title">${title}</h2>
        <span class="at-product-price_lbl">${price}</span>
        ${oldPrice ? `<span class="price_before">${oldPrice}</span>` : ''}
        <span class="additional-product-info">${additionalInfo}</span>
        <span>${extraText}</span>
      </div>
    </a>
  `;
}

function hoferActionCard({
  title = 'HOFER MARKTPLATZ Gourmet Heidelbeeren, 200 g',
  text = 'Klasse I per Packung \u20ac 1,84 statt 3,69 9,20/kg',
  image = 'https://s7g10.scene7.com/is/image/aldi/852357_KW21_FrSa',
  extraLink = '',
} = {}) {
  return `
    <div class="wrapper">
      <div class="item">
        <img src="${image}">
        <h3>${title}</h3>
        <p>${text}</p>
        ${extraLink ? `<a href="${extraLink}">Ausnahmen finden Sie hier.</a>` : ''}
      </div>
    </div>
  `;
}

function formatHoferShortDate(date) {
  return `${date.getUTCDate()}.${date.getUTCMonth() + 1}.`;
}

function parseHoferFixture({ cards, pageUrl = 'https://www.hofer.at/de/angebote/hofer-preiswochen.html', pageDate = null, nextPageDate = null, diagnostics = {} }) {
  return __private.parseHoferOffersFromPage({
    html: `<html><body>${cards.join('')}</body></html>`,
    source: hoferOfficialSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl,
    pageDate,
    nextPageDate,
    diagnostics,
  });
}

test('HOFER official parser extracts multiple offer cards with prices, unit prices and image URLs', () => {
  const offers = parseHoferFixture({
    cards: [
      hoferCard(),
      hoferCard({
        title: 'AQUA+ Vitaminwater, Orange',
        price: '\u20ac 0,49',
        oldPrice: '',
        additionalInfo: 'per Flasche (1 L = \u20ac 0,98 )',
        href: '/de/p.aqua-vitaminwater-orange.000000000000700002.html',
        image: 'https://s7g10.scene7.com/is/image/aldi/202603300450',
      }),
    ],
  });

  assert.equal(offers.length, 2);
  assert.equal(offers[0].title, 'CUCINA Cantuccini, Klassik');
  assert.equal(offers[0].priceCurrent.amount, 1.69);
  assert.equal(offers[0].priceReference.amount, 2.49);
  assert.equal(offers[0].normalizedUnitPrice.amount, 5.6);
  assert.equal(offers[0].normalizedUnitPrice.unit, 'kg');
  assert.equal(offers[0].sourceUrl, 'https://www.hofer.at/de/p.cucina-cantuccini-klassik.000000000000700001.html');
  assert.equal(offers[0].imageUrl, 'https://www.hofer.at/is/image/aldi/202605070007');
  assert.equal(offers[1].normalizedUnitPrice.amount, 0.98);
  assert.equal(offers[1].normalizedUnitPrice.unit, 'l');
});

test('HOFER official parser keeps current snapshot offers without validTo and labels them conservatively', () => {
  const hoferSource = hoferOfficialSource();
  const offers = parseHoferFixture({
    cards: [hoferCard({ oldPrice: '', additionalInfo: 'per Packung (1 per Kilogramm = \u20ac 10,90 )' })],
  });
  const enriched = enrichOffersForStorage(offers, {
    source: hoferSource,
    sourceType: 'hofer-official-html',
    parserVersion: 'official-v3-coverage',
    normalizationVersion: 'v3-audit',
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].validTo, null);
  assert.equal(offers[0].status, 'active');
  assert.equal(offers[0].isActiveNow, true);
  assert.match(offers[0].conditionsText, /Aktuell gefunden - bitte im Markt pruefen/);
  assert.equal(enriched.length, 1);
  assert.equal(buildValidityLabel(enriched[0]), 'Aktuell gefunden - bitte im Markt pruefen.');
});

test('HOFER official parser derives dated-page validTo as full previous day and rejects future offers', () => {
  const today = new Date();
  const pageDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1, 12, 0, 0));
  const nextPageDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1, 12, 0, 0));
  const expectedValidTo = new Date(nextPageDate);
  expectedValidTo.setUTCDate(expectedValidTo.getUTCDate() - 1);
  expectedValidTo.setUTCHours(23, 59, 59, 999);
  const currentOffers = parseHoferFixture({
    pageUrl: 'https://www.hofer.at/de/angebote/d.13-05-2026.html',
    pageDate,
    nextPageDate,
    cards: [hoferCard()],
  });
  const futureDiagnostics = {};
  const futureOffers = parseHoferFixture({
    pageUrl: 'https://www.hofer.at/de/angebote/d.21-05-2026.html',
    pageDate: new Date(Date.UTC(2099, 4, 21, 12, 0, 0)),
    cards: [hoferCard({ extraText: 'verfuegbar ab 21.05.2099' })],
    diagnostics: futureDiagnostics,
  });

  assert.equal(currentOffers.length, 1);
  assert.equal(currentOffers[0].validTo.toISOString(), expectedValidTo.toISOString());
  assert.equal(futureOffers.length, 0);
  assert.equal(futureDiagnostics.skipReasons['status-upcoming'], 1);
});

test('HOFER official parser reports reject reasons for non-offer cards', () => {
  const diagnostics = {};
  const offers = parseHoferFixture({
    diagnostics,
    cards: [
      hoferCard({ title: '', price: '\u20ac 1,99' }),
      hoferCard({ title: 'Preisloses Produkt', price: '' }),
      hoferCard({ title: 'Ausverkauftes Produkt', extraText: 'Ausverkauft' }),
    ],
  });

  assert.equal(offers.length, 0);
  assert.equal(diagnostics.rawCards, 3);
  assert.equal(diagnostics.skipReasons['missing-title'], 1);
  assert.equal(diagnostics.skipReasons['missing-current-price'], 1);
  assert.equal(diagnostics.skipReasons['sold-out'], 1);
});

test('HOFER official source only treats explicit offer pages as additional HTML offer inputs', () => {
  assert.equal(__private.isHoferOfferPageUrl('https://www.hofer.at/de/angebote/hofer-preiswochen.html'), true);
  assert.equal(__private.isHoferOfferPageUrl('https://www.hofer.at/de/angebote/hofer-preis-dauerhaft-guenstiger.html'), true);
  assert.equal(__private.isHoferOfferPageUrl('https://www.hofer.at/de/angebote/aktionen.html'), true);
  assert.equal(__private.isHoferOfferPageUrl('https://www.hofer.at/de/angebote/technik-und-haushalt.html'), true);
  assert.equal(__private.isHoferOfferPageUrl('https://www.hofer.at/de/angebote/handys-und-router.html'), true);
  assert.equal(__private.isHoferOfferPageUrl('https://www.hofer.at/de/angebote/d.13-05-2026.html'), true);
  assert.equal(__private.isHoferOfferPageUrl('https://www.hofer.at/de/angebote/angebote-im-ueberblick.html'), true);
  assert.equal(__private.isHoferOfferPageUrl('https://www.hofer.at/de/sortiment/produktsortiment.html'), false);
});

test('HOFER official parser accepts offer overview product cards with product ids and conservative validity', () => {
  const offers = parseHoferFixture({
    pageUrl: 'https://www.hofer.at/de/angebote/angebote-im-ueberblick.html?productState=In+der+Filiale+erh%C3%A4ltlich',
    cards: [hoferCard({
      title: 'HISENSE 50 Zoll 4K Ultra HD Smart TV',
      price: '\u20ac 349,00',
      oldPrice: '',
      additionalInfo: 'per Stück',
      href: '/de/p.hisense---cm-k-ultra-hd-smart-tv.000000000000737290.html',
      image: '/is/image/aldi/202605140001',
    })],
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].rawFacts.pageContext, 'offers-overview');
  assert.equal(offers[0].rawFacts.productId, '000000000000737290');
  assert.match(offers[0].dedupeKey, /000000000000737290/);
  assert.match(offers[0].conditionsText, /Aktuell gefunden - bitte im Markt pruefen/);
});

test('HOFER official parser extracts Aktionen gallery cards with validity range, old price and image', () => {
  const now = new Date();
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 12, 0, 0));
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 12, 0, 0));
  const heading = `TIEFPREIS AKTIONEN - Wochenende: Fr. ${formatHoferShortDate(yesterday)} bis Sa. ${formatHoferShortDate(tomorrow)}`;
  const offers = parseHoferFixture({
    pageUrl: 'https://www.hofer.at/de/angebote/aktionen.html',
    cards: [
      `<h2>${heading}</h2><div class="gallery">${hoferActionCard({
        extraLink: 'https://s7g10.scene7.com/is/content/aldi/Filialliste_04-2026',
      })}</div>`,
    ],
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].title, 'HOFER MARKTPLATZ Gourmet Heidelbeeren, 200 g');
  assert.equal(offers[0].priceCurrent.amount, 1.84);
  assert.equal(offers[0].priceReference.amount, 3.69);
  assert.equal(offers[0].normalizedUnitPrice.amount, 9.2);
  assert.equal(offers[0].normalizedUnitPrice.unit, 'kg');
  assert.equal(offers[0].sourceUrl, 'https://www.hofer.at/de/angebote/aktionen.html');
  assert.equal(offers[0].imageUrl, 'https://s7g10.scene7.com/is/image/aldi/852357_KW21_FrSa');
  assert.equal(offers[0].rawFacts.pageContext, 'hofer-actions');
  assert.match(offers[0].conditionsText, /Aktion nicht in allen Filialen|Aktuell gefunden|^$/);
});

test('HOFER official parser rejects future Aktionen gallery cards', () => {
  const diagnostics = {};
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 12, 0, 0));
  const dayAfter = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2, 12, 0, 0));
  const heading = `TIEFPREIS AKTIONEN - Wochenstart: Mo. ${formatHoferShortDate(tomorrow)} bis Do. ${formatHoferShortDate(dayAfter)}`;
  const offers = parseHoferFixture({
    diagnostics,
    pageUrl: 'https://www.hofer.at/de/angebote/aktionen.html',
    cards: [`<h2>${heading}</h2><div class="gallery">${hoferActionCard()}</div>`],
  });

  assert.equal(offers.length, 0);
  assert.equal(diagnostics.skipReasons['status-upcoming'], 1);
});

test('HOFER official dedupe prefers dated offer evidence over overview duplicates', () => {
  const overview = parseHoferFixture({
    pageUrl: 'https://www.hofer.at/de/angebote/angebote-im-ueberblick.html',
    cards: [hoferCard()],
  })[0];
  const dated = parseHoferFixture({
    pageUrl: 'https://www.hofer.at/de/angebote/d.20-05-2026.html',
    pageDate: new Date(Date.UTC(2026, 4, 20, 12, 0, 0)),
    nextPageDate: new Date(Date.UTC(2026, 5, 2, 12, 0, 0)),
    cards: [hoferCard()],
  })[0];
  const diagnostics = {};
  const deduped = __private.dedupeHoferOffers([overview, dated], diagnostics);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].rawFacts.pageContext, 'dated-offers');
  assert.equal(diagnostics.skipReasons.duplicate, 1);
});

test('dm Ausverkauf source is active official-site input for normal full crawl selection', () => {
  const dmOfficial = RETAILER_DEFINITIONS.find((definition) =>
    definition.retailerKey === 'dm' && definition.channel === 'official-site'
  );

  assert.equal(dmOfficial.sourceUrl, 'https://www.dm.at/ausverkauf');
  assert.notEqual(dmOfficial.enabled, false);
  assert.equal(deriveSourceKey({ ...dmOfficial, sourceType: 'offers-page' }), 'dm-official-site');
});

function pennyOfficialSource(overrides = {}) {
  return source({
    retailerKey: 'penny',
    retailerName: 'PENNY',
    channel: 'official-site',
    sourceUrl: 'https://www.penny.at/angebote',
    label: 'PENNY Angebote',
    sourceType: 'offers-page',
    ...overrides,
  });
}

function pennyCard({
  href = '/produkte/auslese-klassisch-78114243',
  titleLine = 'Auslese klassisch* • Jacobs',
  quantity = '500 g Packung',
  validFrom = 'von Mi 10.06.2026',
  validTo = 'bis Di 30.06.2026',
  price = '5,99 €',
  reference = '9,99 €',
  basePrice = '1 kg 11,98 €',
  image = '',
} = {}) {
  return `
    <li class="ws-product-tile" data-test="product-tile">
      <a href="${href}" data-test="product-tile-link">${titleLine.split('•')[0].trim()}</a>
      ${image ? `<img data-srcset="${image} 1x, ${image.replace('140', '280')} 2x">` : '<img src="data:image/jpeg;base64,placeholder">'}
      <h3 data-test="product-title">${titleLine}</h3>
      <ul data-test="product-information-piece-description"><li>${quantity}</li></ul>
      <div data-test="product-price-validity">
        <div>${validFrom}</div>
        ${validTo ? `<div>${validTo}</div>` : ''}
      </div>
      <div data-test="product-price">
        <div data-test="product-price-type">
          <div data-test="product-price-type-value">
            <span class="ws-product-price-value__main">${price}</span>
            ${reference ? `<span class="ws-product-price-strike" aria-label="${reference} - Streichpreis"><s>${reference}</s></span>` : ''}
          </div>
          ${basePrice ? `<div data-test="product-price-type-label">${basePrice}</div>` : ''}
        </div>
      </div>
    </li>
  `;
}

function pennyNuxtPayload(products = []) {
  return `<script type="application/json" id="__NUXT_DATA__">${JSON.stringify(products)}</script>`;
}

function pennyProduct(overrides = {}) {
  const slug = overrides.slug || 'auslese-klassisch-78114243';
  const hasOverride = (key) => Object.prototype.hasOwnProperty.call(overrides, key);
  return {
    productId: overrides.productId || `product-${slug}`,
    sku: overrides.sku || '78-114243',
    slug,
    name: overrides.name || 'Auslese klassisch*',
    brand: overrides.brand === undefined ? { name: 'Jacobs', slug: 'jacobs' } : overrides.brand,
    images: overrides.images || ['https://images.example.test/jacobs.jpg'],
    amount: overrides.amount || '500',
    volumeLabelShort: overrides.volumeLabelShort || 'g',
    packageLabel: overrides.packageLabel || 'Packung',
    category: overrides.category || 'Kaffee, Tee & Co.',
    parentCategories: overrides.parentCategories || [[
      { name: 'Getränke' },
      { name: 'Kaffee, Tee & Co.' },
      { name: 'Angebote ab 13.05.' },
    ]],
    price: {
      validityStart: hasOverride('validityStart') ? overrides.validityStart : '2026-06-10',
      validityEnd: hasOverride('validityEnd') ? overrides.validityEnd : '2026-06-30',
      crossed: overrides.crossed === undefined ? 999 : overrides.crossed,
      regular: { value: overrides.priceCents || 599 },
    },
  };
}

function pennyApiProduct(overrides = {}) {
  const product = pennyProduct(overrides);
  const hasOverride = (key) => Object.prototype.hasOwnProperty.call(overrides, key);

  return {
    ...product,
    inPromotion: hasOverride('inPromotion') ? overrides.inPromotion : true,
    price: {
      baseUnitLong: overrides.baseUnitLong || 'Kilogramm',
      baseUnitShort: overrides.baseUnitShort || 'kg',
      basePriceFactor: hasOverride('basePriceFactor') ? overrides.basePriceFactor : '1',
      crossed: hasOverride('crossed') ? overrides.crossed : 999,
      discountPercentage: hasOverride('discountPercentage') ? overrides.discountPercentage : -40,
      regular: {
        perStandardizedQuantity: hasOverride('perStandardizedQuantity') ? overrides.perStandardizedQuantity : 1198,
        ...(hasOverride('promotionQuantity') ? { promotionQuantity: overrides.promotionQuantity } : {}),
        ...(hasOverride('promotionType') ? { promotionType: overrides.promotionType } : {}),
        tags: hasOverride('tags') ? overrides.tags : ['SO'],
        value: overrides.priceCents || 599,
      },
      validityStart: hasOverride('validityStart') ? overrides.validityStart : '2026-06-10',
      validityEnd: hasOverride('validityEnd') ? overrides.validityEnd : '2026-06-30',
    },
  };
}

function parsePennyFixture({ cards, products = [] }) {
  return __private.parsePennyOffersFromHtml({
    html: `<html><body><a href="/angebote?tab=angebote-ab-13-05">Angebote ab 13.05.</a>${cards.join('')}${pennyNuxtPayload(products)}</body></html>`,
    source: pennyOfficialSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.penny.at/angebote',
  });
}

test('PENNY official parser extracts offer card core fields and Nuxt payload image', () => {
  const offers = parsePennyFixture({
    cards: [pennyCard()],
    products: [pennyProduct()],
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].title, 'Auslese klassisch*');
  assert.equal(offers[0].brand, 'Jacobs');
  assert.equal(offers[0].quantityText, '500 g Packung');
  assert.equal(offers[0].validFrom.toISOString(), '2026-06-09T22:00:00.000Z');
  assert.equal(offers[0].validTo.toISOString(), '2026-06-30T21:59:59.999Z');
  assert.equal(offers[0].priceCurrent.amount, 5.99);
  assert.equal(offers[0].priceReference.amount, 9.99);
  assert.equal(offers[0].normalizedUnitPrice.amount, 11.98);
  assert.equal(offers[0].normalizedUnitPrice.unit, 'kg');
  assert.equal(offers[0].imageUrl, 'https://images.example.test/jacobs.jpg');
  assert.equal(offers[0].availabilityScope, 'unknown');
  assert.equal(offers[0].conditionsText, 'Bedingung im Angebotsbild pruefen');
  assert.equal(offers[0].hasConditions, true);
  assert.equal(offers[0].minimumPurchaseQty, 1);
  assert.equal(offers[0].effectiveDiscountType, 'unknown');
  assert.equal(offers[0].rawFacts.conditionExtraction.reason, 'unstructured-title-footnote-marker');
});

test('PENNY official parser normalizes relative srcset image URLs', () => {
  const offers = parsePennyFixture({
    cards: [pennyCard({
      href: '/produkte/cremereiniger-78107607',
      titleLine: 'Cremereiniger • CIF',
      quantity: '750 ml Flasche',
      price: '1,99 €',
      reference: '2,45 €',
      basePrice: '1 Liter 2,65 €',
      image: '/images/penny/cif-140.jpg',
    })],
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].imageUrl, 'https://www.penny.at/images/penny/cif-140.jpg');
});

test('PENNY official parser keeps offers without validTo and rejects expired validTo', () => {
  const current = parsePennyFixture({
    cards: [pennyCard({
      titleLine: 'Kinder Pingui',
      href: '/produkte/kinder-pingui-78102064',
      quantity: '120 g Packung',
      validTo: '',
      price: '1,59 €',
      reference: '',
      basePrice: '1 kg 13,25 €',
    })],
    products: [pennyProduct({
      slug: 'kinder-pingui-78102064',
      name: 'Kinder Pingui',
      brand: undefined,
      images: [],
      category: 'Süßwaren',
      parentCategories: [[{ name: 'Süßes & Salziges' }, { name: 'Süßwaren' }]],
      validityEnd: '',
      crossed: null,
      priceCents: 159,
    })],
  });
  const expired = parsePennyFixture({
    cards: [pennyCard({
      validFrom: 'von Mi 01.01.2001',
      validTo: 'bis Mi 02.01.2001',
    })],
  });

  assert.equal(current.length, 1);
  assert.equal(current[0].validTo, null);
  assert.equal(expired.length, 0);
});

test('PENNY official parser classifies coffee, cleaner, sweets and alcohol conservatively', () => {
  const offers = parsePennyFixture({
    cards: [
      pennyCard(),
      pennyCard({
        href: '/produkte/cremereiniger-78107607',
        titleLine: 'Cremereiniger • CIF',
        quantity: '750 ml Flasche',
        price: '1,99 €',
        reference: '2,45 €',
        basePrice: '1 Liter 2,65 €',
      }),
      pennyCard({
        href: '/produkte/naps-hauchzart-od-favourites-78112377',
        titleLine: 'Naps*, Hauchzart* od. Favourites* • Milka',
        quantity: '138 g Packung',
        price: '3,49 €',
        reference: '',
        basePrice: '100 g 2,53 €',
      }),
      pennyCard({
        href: '/produkte/bourbon-whiskey-78113169',
        titleLine: 'Bourbon Whiskey • Jim Beam',
        quantity: '0,7 liter Flasche',
        validFrom: 'von Mi 10.06.2026',
        validTo: 'bis Di 30.06.2026',
        price: '9,99 €',
        reference: '',
        basePrice: '1 Liter 14,27 €',
      }),
    ],
    products: [
      pennyProduct(),
      pennyProduct({
        slug: 'cremereiniger-78107607',
        name: 'Cremereiniger',
        brand: { name: 'CIF', slug: 'cif' },
        category: 'Reinigen & Pflegen',
        parentCategories: [[{ name: 'Haushalt' }, { name: 'Reinigen & Pflegen' }]],
      }),
      pennyProduct({
        slug: 'naps-hauchzart-od-favourites-78112377',
        name: 'Naps*, Hauchzart* od. Favourites*',
        brand: { name: 'Milka', slug: 'milka' },
        category: 'Schokolade',
        parentCategories: [[{ name: 'Süßes & Salziges' }, { name: 'Schokolade' }]],
        crossed: null,
      }),
      pennyProduct({
        slug: 'bourbon-whiskey-78113169',
        name: 'Bourbon Whiskey',
        brand: { name: 'Jim Beam', slug: 'jim-beam' },
        category: 'Spirituosen',
        parentCategories: [[{ name: 'Getränke' }, { name: 'Spirituosen' }]],
        crossed: null,
      }),
    ],
  });
  const byTitle = new Map(offers.map((offer) => [offer.title, offer]));

  assert.equal(byTitle.get('Auslese klassisch*').categorySecondary, 'Kaffee & Tee');
  assert.equal(byTitle.get('Cremereiniger').categoryPrimary, 'Haushalt');
  assert.equal(byTitle.get('Cremereiniger').categorySecondary, 'Waschmittel & Reiniger');
  assert.equal(byTitle.get('Naps*, Hauchzart* od. Favourites*').categorySecondary, 'Suesswaren & Knabbereien');
  assert.equal(byTitle.get('Bourbon Whiskey').categorySecondary, 'Spirituosen');
});

test('PENNY official-site is the prioritized stable source key', () => {
  const pennySources = RETAILER_DEFINITIONS.filter((definition) => definition.retailerKey === 'penny');
  const officialSite = pennySources.find((definition) => definition.channel === 'official-site');

  assert.equal(pennySources[0].channel, 'official-site');
  assert.equal(officialSite.sourceUrl, 'https://www.penny.at/angebote');
  assert.equal(officialSite.priority, 1);
  assert.equal(deriveSourceKey({ ...officialSite, sourceType: 'offers-page' }), 'penny-official-site');
});

test('PENNY official-site diagnostic reports tabs, counts and expected effect', () => {
  const html = `<html><body>
    <a href="/angebote?tab=angebote-ab-13-05">Angebote ab 13.05.</a>
    <a href="/angebote?tab=angebote/flugblaetter">Flugblätter</a>
    <a href="/angebote?page=2">2</a>
    ${pennyCard()}
    ${pennyNuxtPayload([pennyProduct()])}
  </body></html>`;
  const report = __private.diagnosePennyOfficialSiteHtml({
    html,
    sourceUrl: 'https://www.penny.at/angebote',
    response: { status: 200, headers: { 'content-type': 'text/html' } },
  });

  assert.equal(report.httpStatus, 200);
  assert.equal(report.recognizedOfferCards, 1);
  assert.equal(report.parsedRawOffers, 1);
  assert.equal(report.withImageUrl, 1);
  assert.equal(report.tabs.length, 2);
  assert.equal(report.paginationLinks.length, 1);
  assert.match(report.detailPagesOrApiNeeded, /Product-Discovery-API/);
});

test('PENNY official parser discovers the visible product-group API slug', () => {
  const html = `<html><body>
    <script id="__NUXT_DATA__" type="application/json">["product-group-angebote-ab-1305-\\{\\"page\\":0,\\"pageSize\\":30}"]</script>
    <a href="/angebote?tab=angebote-ab-13-05">Angebote ab 13.05.</a>
    <a href="/kategorie/angebote-ab-2105">Angebote ab 21.05.</a>
  </body></html>`;

  const slugs = __private.extractPennyProductGroupSlugsFromHtml(html);

  assert.deepEqual(slugs.slice(0, 2), ['angebote-ab-1305', 'angebote-ab-2105']);
});

test('PENNY official API normalizer keeps missing validTo offers and rejects normal products', () => {
  const offers = __private.normalizePennyApiProductsToOffers({
    products: [
      pennyApiProduct({
        slug: 'cremereiniger-78107607',
        name: 'Cremereiniger',
        brand: { name: 'CIF', slug: 'cif' },
        amount: '750',
        volumeLabelShort: 'ml',
        packageLabel: 'Flasche',
        baseUnitLong: 'Liter',
        baseUnitShort: 'Liter',
        perStandardizedQuantity: 265,
        priceCents: 199,
        crossed: 245,
        images: ['/images/penny/cif-140.jpg'],
      }),
      pennyApiProduct({
        slug: 'kinder-pingui-78102064',
        name: 'Kinder Pingui',
        brand: undefined,
        amount: '120',
        volumeLabelShort: 'g',
        packageLabel: 'Packung',
        validityEnd: '',
        crossed: null,
        priceCents: 159,
        perStandardizedQuantity: 1325,
        images: ['https://images.example.test/kinder.jpg'],
      }),
      {
        slug: 'normalprodukt-78000001',
        name: 'Normalprodukt',
        price: { regular: { value: 299 } },
        images: ['https://images.example.test/normal.jpg'],
      },
    ],
    source: pennyOfficialSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.penny.at/angebote',
    categorySlug: 'angebote-ab-1305',
  });

  assert.equal(offers.length, 2);
  assert.equal(offers[0].title, 'Cremereiniger');
  assert.equal(offers[0].brand, 'CIF');
  assert.equal(offers[0].priceCurrent.amount, 1.99);
  assert.equal(offers[0].priceReference.amount, 2.45);
  assert.equal(offers[0].normalizedUnitPrice.amount, 2.65);
  assert.equal(offers[0].normalizedUnitPrice.unit, 'l');
  assert.equal(offers[0].imageUrl, 'https://www.penny.at/images/penny/cif-140.jpg');
  assert.equal(offers[0].conditionsText, '');
  assert.equal(offers[0].hasConditions, false);
  assert.equal(offers[0].minimumPurchaseQty, 1);
  assert.equal(offers[1].validTo, null);
  assert.match(offers[1].conditionsText, /Aktuell gefunden/);
  assert.equal(offers[1].adminReview.status, 'pending');
});

test('PENNY official API normalizer handles current 11.06 reference products', () => {
  const products = [
    pennyApiProduct({
      slug: 'helles-78101754',
      name: 'Helles',
      brand: { name: 'Ottakringer', slug: 'ottakringer' },
      amount: '0.33',
      volumeLabelShort: 'liter',
      packageLabel: 'Flasche',
      priceCents: 69,
      crossed: null,
      promotionType: 'FROM',
      promotionQuantity: 24,
      validityStart: '2026-06-11',
      validityEnd: '2026-06-17',
    }),
    pennyApiProduct({
      slug: 'kinder-pingui-78102064',
      name: 'Kinder Pingui',
      brand: null,
      amount: '120',
      volumeLabelShort: 'g',
      packageLabel: 'Packung',
      priceCents: 159,
      crossed: null,
      tags: [],
      validityStart: '2026-06-11',
      validityEnd: '2026-06-17',
    }),
    pennyApiProduct({
      slug: 'joghurt-mit-der-ecke-78102841',
      name: 'Joghurt mit der Ecke',
      brand: { name: 'M\u00fcller', slug: 'mueller' },
      amount: '150',
      volumeLabelShort: 'g',
      packageLabel: 'Becher',
      priceCents: 52,
      crossed: null,
      validityStart: '2026-06-11',
      validityEnd: '2026-06-17',
    }),
    pennyApiProduct({
      slug: 'gelierzucker-21-78105219',
      name: 'Gelierzucker 2:1*',
      brand: { name: 'Wiener Zucker', slug: 'wiener-zucker' },
      amount: '500',
      volumeLabelShort: 'g',
      packageLabel: 'Paket',
      priceCents: 99,
      crossed: null,
      promotionType: 'FROM',
      promotionQuantity: 2,
      validityStart: '2026-06-11',
      validityEnd: '2026-06-17',
    }),
    pennyApiProduct({
      slug: 'kartoffelpueree-78103890',
      name: 'Kartoffelp\u00fcree',
      brand: { name: 'Pfanni', slug: 'pfanni' },
      amount: '240',
      volumeLabelShort: 'g',
      packageLabel: 'Packung',
      priceCents: 186,
      crossed: null,
      validityStart: '2026-06-11',
      validityEnd: '2026-06-17',
    }),
    pennyApiProduct({
      slug: 'kirschen-78108999',
      name: 'Kirschen',
      brand: null,
      amount: '500',
      volumeLabelShort: 'g',
      packageLabel: 'Tasse',
      priceCents: 299,
      crossed: null,
      validityStart: '2026-06-11',
      validityEnd: '2026-06-13',
    }),
    pennyApiProduct({
      slug: 'gouda-78110986',
      name: 'Gouda*',
      brand: { name: 'Sch\u00e4rdinger', slug: 'schaerdinger' },
      amount: '1',
      volumeLabelShort: 'kg',
      packageLabel: 'Packung',
      priceCents: 699,
      crossed: null,
      validityStart: '2026-06-11',
      validityEnd: '2026-06-13',
    }),
    pennyApiProduct({
      slug: 'polardorsch-78111437',
      name: 'Polardorsch*',
      brand: { name: 'Iglo', slug: 'iglo' },
      amount: '400',
      volumeLabelShort: 'g',
      packageLabel: 'Packung',
      priceCents: 449,
      crossed: null,
      validityStart: '2026-06-12',
      validityEnd: '2026-06-13',
    }),
    pennyApiProduct({
      slug: 'rosinenbroetchen-78112501',
      name: 'Rosinenbr\u00f6tchen*',
      brand: { name: '\u00d6lz', slug: 'oelz' },
      amount: '375',
      volumeLabelShort: 'g',
      packageLabel: 'Packung',
      priceCents: 399,
      crossed: null,
      validityStart: '2026-06-11',
      validityEnd: '2026-06-17',
    }),
    pennyApiProduct({
      slug: 'amicelli-78112199',
      name: 'Amicelli od. Amicelli Kokos*',
      brand: null,
      amount: '200',
      volumeLabelShort: 'g',
      packageLabel: 'Packung',
      priceCents: 349,
      crossed: null,
      validityStart: '2026-06-11',
      validityEnd: '2026-06-17',
    }),
  ];

  const offers = __private.normalizePennyApiProductsToOffers({
    products,
    source: pennyOfficialSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.penny.at/angebote',
    categorySlug: 'angebote-ab-1106',
  });
  const bySlug = new Map(offers.map((offer) => [offer.rawFacts.productSlug, offer]));

  assert.equal(offers.length, products.length);
  assert.equal(bySlug.get('helles-78101754').brand, 'Ottakringer');
  assert.equal(bySlug.get('helles-78101754').priceCurrent.amount, 0.69);
  assert.equal(bySlug.get('helles-78101754').conditionsText, 'ab 24 Flaschen');
  assert.equal(bySlug.get('helles-78101754').validFrom.toISOString(), '2026-06-10T22:00:00.000Z');
  assert.equal(bySlug.get('helles-78101754').validTo.toISOString(), '2026-06-17T21:59:59.999Z');
  assert.equal(bySlug.get('helles-78101754').status, 'active');
  assert.equal(bySlug.get('kinder-pingui-78102064').title, 'Kinder Pingui');
  assert.equal(bySlug.get('joghurt-mit-der-ecke-78102841').brand, 'M\u00fcller');
  assert.equal(bySlug.get('polardorsch-78111437').brand, 'Iglo');
  assert.equal(bySlug.get('gouda-78110986').brand, 'Sch\u00e4rdinger');
  assert.equal(bySlug.get('rosinenbroetchen-78112501').brand, '\u00d6lz');
  assert.equal(bySlug.get('amicelli-78112199').priceCurrent.amount, 3.49);
  assert.ok(offers.every((offer) => offer.rawFacts.sourceType === 'penny-official-html'));
});

test('PENNY PDF evidence bridge maps only tight pro-kg conflicts into official API normalizer', () => {
  const validFrom = new Date('2026-06-10T22:00:00.000Z');
  const validTo = new Date('2026-06-17T21:59:59.999Z');
  const pdfReferences = [{
    pdfReference: {
      validity: { validFrom, validTo },
      candidates: [
        {
          title: 'Schopf od. Karree',
          price: 6.99,
          quantityText: 'pro kg',
          rawText: 'Schopf od. Karree ohne Knochen geschnitten od. im Stueck natur od. gewuerzt pro kg 6.99',
          page: 6,
        },
        {
          title: 'Schweinefleisch fuer Reisfleisch/Gulasch',
          price: 7.99,
          quantityText: 'pro kg',
          rawText: 'Schweinefleisch fuer Reisfleisch/Gulasch geschnitten pro kg 7.99',
          page: 6,
        },
        {
          title: 'Rindsschnitzelfleisch',
          price: 15.99,
          quantityText: 'geschnitten od. im Stueck, pro kg',
          rawText: 'Rindsschnitzelfleisch geschnitten od. im Stueck pro kg 15.99',
          page: 7,
        },
        {
          title: 'Cevapcici',
          price: 2.59,
          quantityText: '480 g, 1 kg=5.39',
          rawText: 'Delikatessa Cevapcici 480 g 1 kg=5.39 2.59',
          page: 6,
        },
        {
          title: 'Hendl-Minutenschnitzel',
          price: 5.99,
          quantityText: '500 g, 1 kg=11.98',
          rawText: 'Hendl-Minutenschnitzel 500 g 1 kg=11.98 5.99',
          page: 7,
        },
        {
          title: 'XXL Karree od. XXL Schopf',
          price: 5.99,
          quantityText: 'im Stueck, pro kg',
          rawText: 'Delikatessa XXL Karree od. XXL Schopf im Stueck pro kg 5.99',
          page: 6,
        },
        {
          title: 'Suppenfleisch',
          price: 12.99,
          quantityText: 'im Stueck, pro kg',
          rawText: 'Suppenfleisch im Stueck pro kg 12.99',
          page: 7,
        },
      ],
    },
  }];
  const products = [
    pennyApiProduct({
      slug: 'schopf-od-karree-78111111',
      name: 'Schopf od. Karree',
      brand: null,
      category: 'Fleisch, Wurst & Fisch',
      amount: '500',
      volumeLabelShort: 'g',
      packageLabel: 'Packung',
      priceCents: 349,
      crossed: null,
      perStandardizedQuantity: 698,
      validityStart: '2026-06-11',
      validityEnd: '2026-06-17',
    }),
    pennyApiProduct({
      slug: 'schweinefleisch-fuer-reisfleisch-gulasch-78111112',
      name: 'Schweinefleisch fuer Reisfleisch/Gulasch',
      brand: null,
      category: 'Fleisch, Wurst & Fisch',
      amount: '500',
      volumeLabelShort: 'g',
      packageLabel: 'Packung',
      priceCents: 399,
      crossed: null,
      perStandardizedQuantity: 798,
      validityStart: '2026-06-11',
      validityEnd: '2026-06-17',
    }),
    pennyApiProduct({
      slug: 'rindsschnitzelfleisch-78111113',
      name: 'Rindsschnitzelfleisch',
      brand: null,
      category: 'Fleisch, Wurst & Fisch',
      amount: '450',
      volumeLabelShort: 'g',
      packageLabel: 'Packung',
      priceCents: 719,
      crossed: null,
      perStandardizedQuantity: 1598,
      validityStart: '2026-06-11',
      validityEnd: '2026-06-17',
    }),
    pennyApiProduct({
      slug: 'cevapcici-78111114',
      name: 'Cevapcici',
      brand: null,
      category: 'Fleisch, Wurst & Fisch',
      amount: '480',
      volumeLabelShort: 'g',
      packageLabel: 'Packung',
      priceCents: 259,
      crossed: null,
      perStandardizedQuantity: 539,
      validityStart: '2026-06-11',
      validityEnd: '2026-06-17',
    }),
    pennyApiProduct({
      slug: 'hendl-minutenschnitzel-78111115',
      name: 'Hendl-Minutenschnitzel',
      brand: null,
      category: 'Fleisch, Wurst & Fisch',
      amount: '500',
      volumeLabelShort: 'g',
      packageLabel: 'Packung',
      priceCents: 599,
      crossed: null,
      perStandardizedQuantity: 1198,
      validityStart: '2026-06-11',
      validityEnd: '2026-06-17',
    }),
    pennyApiProduct({
      slug: 'xxl-karree-od-xxl-schopf-78111116',
      name: 'XXL Karree od. XXL Schopf',
      brand: null,
      category: 'Fleisch, Wurst & Fisch',
      amount: '1',
      volumeLabelShort: 'kg',
      packageLabel: '',
      priceCents: 599,
      crossed: null,
      perStandardizedQuantity: 599,
      validityStart: '2026-06-11',
      validityEnd: '2026-06-17',
    }),
    pennyApiProduct({
      slug: 'kirschen-78111117',
      name: 'Kirschen',
      brand: null,
      category: 'Obst & Gemuese',
      amount: '500',
      volumeLabelShort: 'g',
      packageLabel: 'Tasse',
      priceCents: 299,
      crossed: null,
      perStandardizedQuantity: 598,
      validityStart: '2026-06-11',
      validityEnd: '2026-06-13',
    }),
  ];
  const pdfEvidenceByProduct = buildPennyPdfEvidenceByProduct({ pdfReferences, products });

  assert.equal(pdfEvidenceByProduct.has('schopf-od-karree-78111111'), true);
  assert.equal(pdfEvidenceByProduct.has('schweinefleisch-fuer-reisfleisch-gulasch-78111112'), true);
  assert.equal(pdfEvidenceByProduct.has('rindsschnitzelfleisch-78111113'), true);
  assert.equal(pdfEvidenceByProduct.has('cevapcici-78111114'), false);
  assert.equal(pdfEvidenceByProduct.has('hendl-minutenschnitzel-78111115'), false);
  assert.equal(pdfEvidenceByProduct.has('xxl-karree-od-xxl-schopf-78111116'), false);
  assert.equal(pdfEvidenceByProduct.has('kirschen-78111117'), false);

  const offers = __private.normalizePennyApiProductsToOffers({
    products,
    source: pennyOfficialSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.penny.at/angebote',
    categorySlug: 'angebote-ab-1106',
    pdfEvidenceByProduct,
  });
  const bySlug = new Map(offers.map((offer) => [offer.rawFacts.productSlug, offer]));

  for (const slug of [
    'schopf-od-karree-78111111',
    'schweinefleisch-fuer-reisfleisch-gulasch-78111112',
    'rindsschnitzelfleisch-78111113',
  ]) {
    const offer = bySlug.get(slug);
    assert.equal(offer.needsReview, true, slug);
    assert.ok(offer.reviewReasons.includes(PDF_WEB_PRICE_QUANTITY_CONFLICT_REASON), slug);
    assert.match(offer.conditionsText, new RegExp(PUBLIC_PDF_WEB_PRICE_QUANTITY_HINT), slug);
    assert.equal(offer.rawFacts.evidenceConflict.type, PDF_WEB_PRICE_QUANTITY_CONFLICT_REASON);
  }

  assert.equal(bySlug.get('schopf-od-karree-78111111').priceCurrent.amount, 3.49);
  assert.equal(bySlug.get('schweinefleisch-fuer-reisfleisch-gulasch-78111112').priceCurrent.amount, 3.99);
  assert.equal(bySlug.get('rindsschnitzelfleisch-78111113').priceCurrent.amount, 7.19);

  for (const slug of [
    'cevapcici-78111114',
    'hendl-minutenschnitzel-78111115',
    'xxl-karree-od-xxl-schopf-78111116',
    'kirschen-78111117',
  ]) {
    const offer = bySlug.get(slug);
    assert.equal(Boolean(offer.needsReview), false, slug);
    assert.equal((offer.reviewReasons || []).includes(PDF_WEB_PRICE_QUANTITY_CONFLICT_REASON), false, slug);
    assert.doesNotMatch(offer.conditionsText, new RegExp(PUBLIC_PDF_WEB_PRICE_QUANTITY_HINT), slug);
  }
});

test('PENNY PDF evidence bridge skips missing pro-kg, weak titles and non-overlapping validity', () => {
  const products = [
    pennyApiProduct({
      slug: 'schopf-od-karree-78111111',
      name: 'Schopf od. Karree',
      brand: null,
      category: 'Fleisch, Wurst & Fisch',
      amount: '500',
      volumeLabelShort: 'g',
      packageLabel: 'Packung',
      priceCents: 349,
      crossed: null,
      perStandardizedQuantity: 698,
      validityStart: '2026-06-11',
      validityEnd: '2026-06-17',
    }),
  ];

  const missingProKgMap = buildPennyPdfEvidenceByProduct({
    products,
    pdfReferences: [{
      pdfReference: {
        validity: {
          validFrom: new Date('2026-06-10T22:00:00.000Z'),
          validTo: new Date('2026-06-17T21:59:59.999Z'),
        },
        candidates: [{
          title: 'Schopf od. Karree',
          price: 3.49,
          quantityText: '500 g Packung',
          rawText: 'Schopf od. Karree 500 g Packung 3.49',
        }],
      },
    }],
  });
  const weakTitleMap = buildPennyPdfEvidenceByProduct({
    products,
    pdfReferences: [{
      pdfReference: {
        validity: {
          validFrom: new Date('2026-06-10T22:00:00.000Z'),
          validTo: new Date('2026-06-17T21:59:59.999Z'),
        },
        candidates: [{
          title: 'Suppenfleisch',
          price: 6.99,
          quantityText: 'pro kg',
          rawText: 'Suppenfleisch im Stueck pro kg 6.99',
        }],
      },
    }],
  });
  const nonOverlappingMap = buildPennyPdfEvidenceByProduct({
    products,
    pdfReferences: [{
      pdfReference: {
        validity: {
          validFrom: new Date('2026-05-01T00:00:00.000Z'),
          validTo: new Date('2026-05-07T23:59:59.999Z'),
        },
        candidates: [{
          title: 'Schopf od. Karree',
          price: 6.99,
          quantityText: 'pro kg',
          rawText: 'Schopf od. Karree pro kg 6.99',
        }],
      },
    }],
  });

  assert.equal(missingProKgMap.size, 0);
  assert.equal(weakTitleMap.size, 0);
  assert.equal(nonOverlappingMap.size, 0);
});

test('official source zero-store gate marks raw official coverage as partial warning', () => {
  const gate = __private.buildOfficialSourceZeroStoredGate({
    source: pennyOfficialSource(),
    rawCandidateCount: 258,
    offersStored: 0,
  });

  assert.equal(gate.forcePartial, true);
  assert.match(gate.warningMessages[0], /stored 0 offers/);
  assert.deepEqual(gate.rejectionReasons, [{
    reason: 'official-source-zero-stored',
    count: 258,
  }]);

  const healthy = __private.buildOfficialSourceZeroStoredGate({
    source: pennyOfficialSource(),
    rawCandidateCount: 258,
    offersStored: 42,
  });

  assert.equal(healthy.forcePartial, false);
});

test('official source zero-store gate covers official pdf flyer paths without penalizing empty raw sources', () => {
  const pdfGate = __private.buildOfficialSourceZeroStoredGate({
    source: {
      label: 'EUROSPAR Flugblatt PDF',
      channel: 'official-flyer',
      sourceType: 'pdf',
      retailerKey: 'eurospar',
    },
    rawCandidateCount: 64,
    offersStored: 0,
  });

  assert.equal(pdfGate.forcePartial, true);
  assert.match(pdfGate.warningMessages[0], /stored 0 offers/);
  assert.deepEqual(pdfGate.rejectionReasons, [{
    reason: 'official-source-zero-stored',
    count: 64,
  }]);

  const emptyRaw = __private.buildOfficialSourceZeroStoredGate({
    source: {
      label: 'EUROSPAR Flugblatt PDF',
      channel: 'official-flyer',
      sourceType: 'pdf',
      retailerKey: 'eurospar',
    },
    rawCandidateCount: 0,
    offersStored: 0,
  });

  assert.equal(emptyRaw.forcePartial, false);
  assert.deepEqual(emptyRaw.warningMessages, []);
  assert.deepEqual(emptyRaw.rejectionReasons, []);
});

test('PENNY official condition extraction reads explicit API promotion tags only', () => {
  const cases = [
    {
      tags: ['ab 6 Flaschen'],
      expectedText: 'ab 6 Flaschen',
      expectedQty: 6,
      expectedType: 'threshold',
      expectedMultiBuy: false,
    },
    {
      tags: ['ab 12 Packungen'],
      expectedText: 'ab 12 Packungen',
      expectedQty: 12,
      expectedType: 'threshold',
      expectedMultiBuy: false,
    },
    {
      tags: ['ab 2 Stück'],
      expectedText: 'ab 2 Stueck',
      expectedQty: 2,
      expectedType: 'threshold',
      expectedMultiBuy: false,
    },
    {
      tags: ['ab 4 Stk.'],
      expectedText: 'ab 4 Stueck',
      expectedQty: 4,
      expectedType: 'threshold',
      expectedMultiBuy: false,
    },
    {
      tags: ['3+3 gratis'],
      expectedText: '3+3 gratis',
      expectedQty: 6,
      expectedType: 'multi-buy',
      expectedMultiBuy: true,
    },
  ];

  for (const item of cases) {
    const offers = __private.normalizePennyApiProductsToOffers({
      products: [pennyApiProduct({
        tags: item.tags,
        validityStart: '2026-06-01',
        validityEnd: '2026-06-30',
      })],
      source: pennyOfficialSource(),
      crawlJobId: new Types.ObjectId(),
      region: 'AT',
      pageUrl: 'https://www.penny.at/angebote',
      categorySlug: 'angebote-ab-1305',
    });

    assert.equal(offers.length, 1, item.expectedText);
    assert.equal(offers[0].conditionsText, item.expectedText);
    assert.equal(offers[0].hasConditions, true);
    assert.equal(offers[0].minimumPurchaseQty, item.expectedQty);
    assert.equal(offers[0].effectiveDiscountType, item.expectedType);
    assert.equal(offers[0].isMultiBuy, item.expectedMultiBuy);
    assert.equal(offers[0].rawFacts.conditionExtraction.reason, 'explicit-penny-promotion-field');
    assert.deepEqual(offers[0].rawFacts.conditionExtraction.sources, ['price.regular.tags']);
  }
});

test('PENNY official condition extraction reads structured FROM promotion quantities', () => {
  const cases = [
    {
      name: 'Coca-Cola Original od. Zero',
      slug: 'cocacola-original-od-zero-78550921',
      amount: '0.5',
      volumeLabelShort: 'liter',
      packageLabel: 'Flasche',
      promotionQuantity: 6,
      expectedText: 'ab 6 Flaschen',
      expectedQty: 6,
    },
    {
      name: 'Maerzen, Naturradler, Naturradler 0,0% od. Naturgold',
      slug: 'maerzen-naturradler-naturradler-00-od-naturgold-78437543',
      amount: '0.33',
      volumeLabelShort: 'liter',
      packageLabel: 'Flasche',
      promotionQuantity: 24,
      expectedText: 'ab 24 Flaschen',
      expectedQty: 24,
    },
    {
      name: 'Vollmilch',
      slug: 'vollmilch-78417175',
      amount: '1',
      volumeLabelShort: 'liter',
      packageLabel: 'Flasche',
      promotionQuantity: 2,
      expectedText: 'ab 2 Flaschen',
      expectedQty: 2,
    },
    {
      name: 'Cola od. Zero',
      slug: 'cola-od-zero-78546048',
      amount: '0.33',
      volumeLabelShort: 'liter',
      packageLabel: 'Dose',
      promotionQuantity: 24,
      expectedText: 'ab 24 Dosen',
      expectedQty: 24,
    },
  ];

  for (const item of cases) {
    const [offer] = __private.normalizePennyApiProductsToOffers({
      products: [pennyApiProduct({
        name: item.name,
        slug: item.slug,
        amount: item.amount,
        volumeLabelShort: item.volumeLabelShort,
        packageLabel: item.packageLabel,
        tags: ['SO'],
        promotionQuantity: item.promotionQuantity,
        promotionType: 'FROM',
        validityStart: '2026-06-01',
        validityEnd: '2026-06-30',
      })],
      source: pennyOfficialSource(),
      crawlJobId: new Types.ObjectId(),
      region: 'AT',
      pageUrl: 'https://www.penny.at/angebote',
      categorySlug: 'angebote-ab-0306',
    });

    assert.equal(offer.conditionsText, item.expectedText, item.name);
    assert.equal(offer.hasConditions, true, item.name);
    assert.equal(offer.minimumPurchaseQty, item.expectedQty, item.name);
    assert.equal(offer.effectiveDiscountType, 'threshold', item.name);
    assert.equal(offer.isMultiBuy, false, item.name);
    assert.equal(offer.rawFacts.conditionExtraction.reason, 'explicit-penny-promotion-field');
    assert.deepEqual(offer.rawFacts.conditionExtraction.sources, ['price.regular.promotionQuantity']);
  }
});

test('PENNY official condition extraction ignores non-threshold promotion quantities', () => {
  const offers = __private.normalizePennyApiProductsToOffers({
    products: [
      pennyApiProduct({
        name: 'Premium Toastkaese*',
        slug: 'premium-toastkaese-78598402',
        amount: '800',
        volumeLabelShort: 'g',
        packageLabel: 'Packung',
        tags: [],
        promotionQuantity: 1,
        promotionType: 'FROM',
        validityStart: '2026-06-01',
        validityEnd: '2026-06-30',
      }),
      pennyApiProduct({
        name: 'Vollmilch',
        slug: 'vollmilch-78417175',
        amount: '1',
        volumeLabelShort: 'liter',
        packageLabel: 'Flasche',
        tags: ['SO'],
        promotionQuantity: 12,
        promotionType: 'PACKAGE_SIZE',
        validityStart: '2026-06-01',
        validityEnd: '2026-06-30',
      }),
    ],
    source: pennyOfficialSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.penny.at/angebote',
    categorySlug: 'angebote-ab-0306',
  });

  assert.equal(offers.length, 2);
  assert.equal(offers[0].conditionsText, 'Bedingung im Angebotsbild pruefen');
  assert.equal(offers[0].minimumPurchaseQty, 1);
  assert.equal(offers[0].effectiveDiscountType, 'unknown');
  assert.equal(offers[1].conditionsText, '');
  assert.equal(offers[1].minimumPurchaseQty, 1);
  assert.equal(offers[1].effectiveDiscountType, 'unknown');
  assert.equal(offers[1].rawFacts.conditionExtraction, undefined);
});

test('PENNY official condition extraction ignores package sizes and normal price-action tags', () => {
  const offers = __private.normalizePennyApiProductsToOffers({
    products: [
      pennyApiProduct({
        name: 'Mineralwasser 6 x 1 Liter',
        amount: '1',
        volumeLabelShort: 'l',
        packageLabel: 'Flasche',
        tags: ['Aktion', '1 Liter 0,49'],
        validityStart: '2026-06-01',
        validityEnd: '2026-06-30',
      }),
      pennyApiProduct({
        slug: 'reiswaffeln-78000002',
        name: 'Reiswaffeln 12 Packungen',
        amount: '12',
        volumeLabelShort: 'Stück',
        packageLabel: 'Packung',
        tags: ['SO'],
        validityStart: '2026-06-01',
        validityEnd: '2026-06-30',
      }),
    ],
    source: pennyOfficialSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.penny.at/angebote',
    categorySlug: 'angebote-ab-1305',
  });

  assert.equal(offers.length, 2);
  for (const offer of offers) {
    assert.equal(offer.conditionsText, '');
    assert.equal(offer.hasConditions, false);
    assert.equal(offer.minimumPurchaseQty, 1);
    assert.equal(offer.effectiveDiscountType, 'unknown');
    assert.equal(offer.rawFacts.conditionExtraction, undefined);
  }
});

test('PENNY official condition extraction adds neutral hint for unstructured API title footnotes', () => {
  const [offer] = __private.normalizePennyApiProductsToOffers({
    products: [pennyApiProduct({
      name: 'Coca-Cola Original* od. Zero*',
      slug: 'coca-cola-original-od-zero-78111111',
      brand: undefined,
      amount: '2',
      volumeLabelShort: 'l',
      packageLabel: 'Flasche',
      tags: ['SO'],
      validityStart: '2026-06-01',
      validityEnd: '2026-06-30',
      crossed: null,
      priceCents: 149,
    })],
    source: pennyOfficialSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.penny.at/angebote',
    categorySlug: 'angebote-ab-1305',
  });

  assert.equal(offer.conditionsText, 'Bedingung im Angebotsbild pruefen');
  assert.equal(offer.hasConditions, true);
  assert.equal(offer.isMultiBuy, false);
  assert.equal(offer.minimumPurchaseQty, 1);
  assert.equal(offer.effectiveDiscountType, 'unknown');
  assert.equal(offer.rawFacts.conditionExtraction.reason, 'unstructured-title-footnote-marker');
});

test('PENNY official API condition fields survive storage enrichment and public serialization', () => {
  const [offer] = __private.normalizePennyApiProductsToOffers({
    products: [pennyApiProduct({
      tags: ['ab 4 Stück'],
      validityStart: '2026-06-01',
      validityEnd: '2026-06-30',
    })],
    source: pennyOfficialSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.penny.at/angebote',
    categorySlug: 'angebote-ab-1305',
  });
  const [stored] = enrichOffersForStorage([offer], {
    source: pennyOfficialSource(),
    sourceType: 'penny-official-html',
    parserVersion: 'test-parser',
    normalizationVersion: 'test-normalizer',
  });
  const publicOffer = buildRankedOffer(stored, null, null);

  assert.equal(stored.conditionsText, 'ab 4 Stueck');
  assert.equal(stored.hasConditions, true);
  assert.equal(stored.minimumPurchaseQty, 4);
  assert.equal(stored.effectiveDiscountType, 'threshold');
  assert.equal(publicOffer.conditionsText, 'ab 4 Stueck');
  assert.equal(publicOffer.hasConditions, true);
  assert.equal(publicOffer.minimumPurchaseQty, 4);
  assert.equal(publicOffer.effectiveDiscountType, 'threshold');
});

test('PENNY official API collector follows product-group pagination', async () => {
  const sourceDefinition = pennyOfficialSource();
  const productsByPage = new Map([
    [0, [pennyApiProduct({ slug: 'auslese-klassisch-78114243' })]],
    [1, [pennyApiProduct({
      slug: 'frizzante-78325401',
      name: 'Frizzante',
      brand: { name: 'La Torina', slug: 'la-torina' },
      amount: '0.75',
      volumeLabelShort: 'l',
      packageLabel: 'Flasche',
      baseUnitLong: 'Liter',
      baseUnitShort: 'Liter',
      priceCents: 199,
      perStandardizedQuantity: 265,
      crossed: null,
    })]],
  ]);
  const requestedPages = [];

  const result = await __private.collectPennyOfficialApiOffers({
    html: 'product-group-angebote-ab-1305-\\{"page":0,"pageSize":30}',
    source: sourceDefinition,
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: 'https://www.penny.at/angebote',
    fetchProductsPage: async ({ categorySlug, page, pageSize }) => {
      requestedPages.push({ categorySlug, page, pageSize });
      return {
        total: 101,
        results: productsByPage.get(page) || [],
      };
    },
  });

  assert.deepEqual(requestedPages.map((item) => item.page), [0, 1]);
  assert.equal(requestedPages[0].categorySlug, 'angebote-ab-1305');
  assert.equal(result.diagnostics.pagesFetched, 2);
  assert.equal(result.diagnostics.productsFetched, 2);
  assert.equal(result.offers.length, 2);
});

function lidlOfficialSource(overrides = {}) {
  return source({
    retailerKey: 'lidl',
    retailerName: 'Lidl',
    channel: 'official-flyer',
    sourceUrl: 'https://www.lidl.at/c/flugblatt/s10012330',
    label: 'Lidl Flugblatt',
    sourceType: 'official-flyer',
    ...overrides,
  });
}

function unixSeconds(date) {
  return Math.floor(date.getTime() / 1000);
}

function lidlCurrentWindow() {
  const now = new Date();
  return {
    start: unixSeconds(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
    end: unixSeconds(new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000)),
  };
}

function lidlFlyerWindow() {
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);

  return {
    offerStartDate: from.toISOString().slice(0, 10),
    offerEndDate: to.toISOString().slice(0, 10),
  };
}

function normalizeLidlFlyerProduct(product = {}, flyer = {}) {
  return __private.normalizeLidlProductToOffer({
    product: {
      title: 'Dr. Beckmann',
      brand: '',
      price: '2.49',
      image: '/images/lidl/dr-beckmann.png',
      url: 'https://www.lidl.at/l/de/flugblatt/test/ar/0',
      description: 'Spuelmaschinenreiniger: 60 g (1 kg = 41.50)',
      ...product,
    },
    flyer: {
      title: 'Flugblatt',
      name: 'Ab Donnerstag',
      flyerUrlAbsolute: 'https://www.lidl.at/l/de/flugblatt/test/ar/0',
      ...lidlFlyerWindow(),
      ...flyer,
    },
    source: lidlOfficialSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
  });
}

test('Lidl flyer API normalizer maps product-level Lidl Plus condition and customer program flag', () => {
  const offer = normalizeLidlFlyerProduct({
    description: 'Nur gültig mit Lidl Plus Spuelmaschinenreiniger: 60 g (1 kg = 41.50)',
  });

  assert.equal(offer.conditionsText, 'Nur gueltig mit Lidl Plus');
  assert.equal(offer.customerProgramRequired, true);
  assert.equal(offer.benefitType, 'conditional-price');
  assert.match(offer.quality.issues.join(' '), /Kundenprogramm/);
});

test('Lidl flyer API normalizer does not infer Lidl Plus from flyer-level context', () => {
  const offer = normalizeLidlFlyerProduct(
    { description: 'Spuelmaschinenreiniger: 60 g (1 kg = 41.50)' },
    { title: 'Lidl Plus Gewinnspiel', name: 'Nur mit Lidl Plus' }
  );

  assert.equal(offer.conditionsText, '');
  assert.equal(offer.customerProgramRequired, false);
});

test('Lidl flyer API normalizer keeps normal descriptions condition-free', () => {
  const offer = normalizeLidlFlyerProduct({
    description: 'Spuelmaschinenreiniger: 60 g (1 kg = 41.50)',
  });

  assert.equal(offer.conditionsText, '');
  assert.equal(offer.customerProgramRequired, false);
});

test('Lidl flyer API date-only validity uses Vienna day boundaries', () => {
  const validFrom = __private.parseLidlFlyerDate('2026-06-03');
  const validTo = __private.parseLidlFlyerDate('2026-06-10', { endOfDay: true });

  assert.equal(validFrom.toISOString(), '2026-06-02T22:00:00.000Z');
  assert.equal(validTo.toISOString(), '2026-06-10T21:59:59.999Z');
});

test('Lidl flyer API normalizer keeps current date-only flyer windows active', () => {
  const todayKey = new Date().toISOString().slice(0, 10);
  const futureKey = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const offer = normalizeLidlFlyerProduct(
    { description: 'Spuelmaschinenreiniger: 60 g (1 kg = 41.50)' },
    { offerStartDate: todayKey, offerEndDate: futureKey }
  );

  assert.equal(offer.status, 'active');
  assert.equal(offer.isActiveNow, true);
});

test('Lidl flyer API normalizer maps explicit base price but ignores technical quantities', () => {
  const drBeckmann = normalizeLidlFlyerProduct({
    description: 'Nur gültig mit Lidl Plus Spuelmaschinenreiniger: 60 g (1 kg = 41.50)',
  });
  const perKg = normalizeLidlFlyerProduct({
    description: 'Spuelmaschinenreiniger: 60 g 41.50 \u20ac/kg',
  });
  const plainBasePrice = normalizeLidlFlyerProduct({
    title: 'Butterkaese in Scheiben',
    brand: 'MILBONA',
    price: '1.99',
    description: 'Packung, 500 g, 1 kg = 3.98',
  });
  const parkside = normalizeLidlFlyerProduct({
    title: 'PARKSIDE Akku-Bohrschrauber, 20 V',
    brand: 'PARKSIDE',
    price: '24.99',
    description: 'Nur gültig mit Lidl Plus Komplettset inkl. 2 Ah Lithium-Ionen-Akku und Ladegeraet. Max. Drehmoment: 35 Nm.',
  });
  const shelf = normalizeLidlFlyerProduct({
    title: 'PARKSIDE Schwerlastregal',
    brand: 'PARKSIDE',
    price: '19.99',
    description: 'Mit 5 hoehenverstellbaren Boeden. Belastung: je Boden: max. 160 kg.',
  });
  const cable = normalizeLidlFlyerProduct({
    title: 'PARKSIDE Verlaengerungskabel',
    brand: 'PARKSIDE',
    price: '9.99',
    description: 'Robustes Outdoor-Kabel, 50 m Reichweite.',
  });

  assert.equal(drBeckmann.normalizedUnitPrice.amount, 41.5);
  assert.equal(drBeckmann.normalizedUnitPrice.unit, 'kg');
  assert.equal(drBeckmann.normalizedUnitPrice.comparable, true);
  assert.equal(perKg.normalizedUnitPrice.amount, 41.5);
  assert.equal(perKg.normalizedUnitPrice.unit, 'kg');
  assert.equal(perKg.normalizedUnitPrice.comparable, true);
  assert.equal(plainBasePrice.quantityText, '500 g');
  assert.equal(plainBasePrice.normalizedUnitPrice.amount, 3.98);
  assert.equal(plainBasePrice.normalizedUnitPrice.unit, 'kg');
  assert.equal(plainBasePrice.normalizedUnitPrice.comparable, true);
  assert.equal(parkside.normalizedUnitPrice.comparable, false);
  assert.equal(parkside.normalizedUnitPrice.amount, null);
  assert.equal(shelf.normalizedUnitPrice.comparable, false);
  assert.equal(shelf.normalizedUnitPrice.amount, null);
  assert.equal(cable.normalizedUnitPrice.comparable, false);
  assert.equal(cable.normalizedUnitPrice.amount, null);
});

function lidlCard(product = {}) {
  const window = lidlCurrentWindow();
  const payload = {
    imageList_V1: [{ image: product.image || '/images/lidl/goesser.png' }],
    title: product.title || 'Maerzen',
    brand: product.brand === undefined ? { name: 'GOESSER', showBrand: true } : product.brand,
    price: product.price === undefined ? {
      price: 14.8,
      oldPrice: 0,
      basePrice: { text: 'Je 20x 0,5 l (0,5 l = 0.74)' },
      discount: { discountText: 'Aktion' },
      currencyCode: 'EUR',
    } : product.price,
    productId: product.productId || 10048907,
    itemId: product.itemId || product.productId || 10048907,
    erpNumber: product.erpNumber || '10048907',
    canonicalUrl: product.canonicalUrl || '/p/goesser-maerzen/p10048907',
    storeStartDate: Object.prototype.hasOwnProperty.call(product, 'storeStartDate') ? product.storeStartDate : window.start,
    storeEndDate: Object.prototype.hasOwnProperty.call(product, 'storeEndDate') ? product.storeEndDate : window.end,
    productType: product.productType || 'RETAIL',
    productOrigin: product.productOrigin || 'progress_event',
    ...product.extra,
  };

  return `<div class="AProductGridbox__GridTilePlaceholder" data-grid-data='${JSON.stringify(payload)}'></div>`;
}

function parseLidlFixture({ pageUrl, cards, diagnostics = {} }) {
  return __private.parseLidlOfficialSiteOffersFromHtml({
    html: `<html><body>${cards.join('')}</body></html>`,
    source: lidlOfficialSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl,
    diagnostics,
  });
}

test('Lidl official site parser extracts multiple campaign cards from Aktion pages', () => {
  const offers = parseLidlFixture({
    pageUrl: 'https://www.lidl.at/c/aktion/a10094563',
    cards: [
      lidlCard(),
      lidlCard({
        title: 'Limonade',
        brand: { name: 'COCA COLA', showBrand: true },
        productId: 10048909,
        canonicalUrl: '/p/coca-cola-limonade/p10048909',
        image: '/images/lidl/coke.png',
        price: {
          price: 1.66,
          oldPrice: 2.39,
          basePrice: { text: 'Ab 6 Stk. je 1,5 l (1 l = 1.11)' },
          discount: { discountText: '-30%' },
          currencyCode: 'EUR',
        },
      }),
    ],
  });

  assert.equal(offers.length, 2);
  assert.equal(offers[0].title, 'Maerzen');
  assert.equal(offers[0].priceCurrent.amount, 14.8);
  assert.equal(offers[0].normalizedUnitPrice.amount, 0.74);
  assert.equal(offers[0].normalizedUnitPrice.unit, 'l');
  assert.equal(offers[1].brand, 'COCA COLA');
  assert.equal(offers[1].priceReference.amount, 2.39);
  assert.equal(offers[1].sourceUrl, 'https://www.lidl.at/p/coca-cola-limonade/p10048909');
  assert.equal(offers[1].imageUrl, 'https://www.lidl.at/images/lidl/coke.png');
});

test('Lidl official site parser handles Mega Deals and missing validTo conservatively', () => {
  const offers = parseLidlFixture({
    pageUrl: 'https://www.lidl.at/c/mega-deals/s10091719',
    cards: [lidlCard({
      title: 'Akku-Multifunktionsfraese, 20 V',
      brand: { name: 'PARKSIDE PERFORMANCE', showBrand: true },
      productId: 10049106,
      canonicalUrl: '/p/parkside-performance-akku-multifunktionsfraese-20-v/p10049106',
      storeEndDate: undefined,
      price: {
        price: 49.99,
        oldPrice: 59.99,
        basePrice: { text: 'Je' },
        discount: { discountText: '10.- billiger' },
        currencyCode: 'EUR',
      },
    })],
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].validTo, null);
  assert.equal(offers[0].status, 'active');
  assert.match(offers[0].conditionsText, /Aktuell gefunden - bitte im Markt pruefen/);
  assert.equal(offers[0].rawFacts.productUrl, 'https://www.lidl.at/p/parkside-performance-akku-multifunktionsfraese-20-v/p10049106');
});

test('Lidl official site parser extracts Frische-Angebote quantities, base prices and multi-buy conditions', () => {
  const offers = parseLidlFixture({
    pageUrl: 'https://www.lidl.at/c/frische-angebote/a10094562',
    cards: [lidlCard({
      title: 'Grapefruit',
      brand: { showBrand: false },
      productId: 10048979,
      canonicalUrl: '/p/grapefruit/p10048979',
      price: {
        price: 0.44,
        oldPrice: 0,
        basePrice: { text: 'Ab 2 Stk. je Stk.' },
        discount: { discountText: '1+1 gratis' },
        currencyCode: 'EUR',
      },
    })],
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].title, 'Grapefruit');
  assert.equal(offers[0].benefitType, 'multi-buy');
  assert.match(offers[0].conditionsText, /1\+1 gratis/);
  assert.equal(offers[0].normalizedUnitPrice.amount, 0.44);
  assert.equal(offers[0].normalizedUnitPrice.unit, 'Stk');
});

test('Lidl official site parser extracts Lidl Plus-only prices from homepage cards', () => {
  const offers = parseLidlFixture({
    pageUrl: 'https://www.lidl.at/',
    cards: [lidlCard({
      title: 'Gurke aus Oesterreich',
      brand: { showBrand: false },
      productId: 10049900,
      canonicalUrl: '/p/gurke-aus-oesterreich/p10049900',
      price: null,
      extra: {
        lidlPlus: [{
          price: {
            price: 0.79,
            oldPrice: 0.99,
            basePrice: { text: 'Je Stk.' },
            discount: { discountText: '-20%', deletedPrice: 0.99 },
            currencyCode: 'EUR',
          },
          lidlPlusText: 'mit Lidl Plus',
          highlightText: '-20%',
        }],
      },
    })],
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].title, 'Gurke aus Oesterreich');
  assert.equal(offers[0].priceCurrent.amount, 0.79);
  assert.equal(offers[0].priceReference.amount, 0.99);
  assert.equal(offers[0].customerProgramRequired, true);
  assert.match(offers[0].conditionsText, /-20%/);
  assert.match(offers[0].conditionsText, /Nur gueltig mit Lidl Plus/);
  assert.equal(offers[0].normalizedUnitPrice.unit, 'Stk');
  assert.equal(offers[0].rawFacts.priceSource, 'lidlPlus');
});

test('Lidl official site parser rejects missing-price, expired and upcoming cards', () => {
  const now = new Date();
  const diagnostics = {};
  const offers = parseLidlFixture({
    pageUrl: 'https://www.lidl.at/c/aktion/a10094563',
    diagnostics,
    cards: [
      lidlCard({ productId: 1, price: { basePrice: { text: 'Je 1 kg' }, currencyCode: 'EUR' } }),
      lidlCard({
        productId: 2,
        storeStartDate: unixSeconds(new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)),
        storeEndDate: unixSeconds(new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)),
      }),
      lidlCard({
        productId: 3,
        storeStartDate: unixSeconds(new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)),
        storeEndDate: unixSeconds(new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000)),
      }),
    ],
  });

  assert.equal(offers.length, 0);
  assert.equal(diagnostics.rawCards, 3);
  assert.equal(diagnostics.skipReasons['missing-current-price'], 1);
  assert.equal(diagnostics.skipReasons['status-expired'], 1);
  assert.equal(diagnostics.skipReasons['status-upcoming'], 1);
});

test('Lidl official dedupe prevents duplicate campaign products across pages', () => {
  const action = parseLidlFixture({
    pageUrl: 'https://www.lidl.at/c/aktion/a10094563',
    cards: [lidlCard({
      productId: 10048977,
      title: 'Spargelspitzen gruen',
      canonicalUrl: '/p/spargelspitzen-gruen/p10048977',
      price: {
        price: 3.49,
        oldPrice: 0,
        basePrice: { text: 'Je 300 g (1 kg = 11.63)' },
        discount: { discountText: 'Aktion' },
        currencyCode: 'EUR',
      },
    })],
  });
  const frische = parseLidlFixture({
    pageUrl: 'https://www.lidl.at/c/frische-angebote/a10094562',
    cards: [lidlCard({
      productId: 10048977,
      title: 'Spargelspitzen gruen',
      canonicalUrl: '/p/spargelspitzen-gruen/p10048977',
      price: {
        price: 3.49,
        oldPrice: 4.99,
        basePrice: { text: 'Je 300 g (1 kg = 11.63)' },
        discount: { discountText: '-30%' },
        currencyCode: 'EUR',
      },
    })],
  });
  const diagnostics = {};
  const deduped = __private.dedupeLidlOffers([...action, ...frische], diagnostics);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].priceReference.amount, 4.99);
  assert.equal(diagnostics.skipReasons.duplicate, 1);
});

test('Lidl official campaign page seeds track current resource matrix URLs', () => {
  assert.ok(__private.LIDL_OFFICIAL_CAMPAIGN_PAGES.includes('https://www.lidl.at/c/mega-deals/s10091719'));
  assert.ok(__private.LIDL_OFFICIAL_CAMPAIGN_PAGES.includes('https://www.lidl.at/c/aktion/a10095240'));
  assert.ok(__private.LIDL_OFFICIAL_CAMPAIGN_PAGES.includes('https://www.lidl.at/c/frische-angebote/a10095239'));
  assert.ok(__private.LIDL_OFFICIAL_CAMPAIGN_PAGES.includes('https://www.lidl.at/c/jeden-tag-deine-guenstigen-preise/a10095237'));
  assert.ok(__private.LIDL_OFFICIAL_CAMPAIGN_PAGES.includes('https://www.lidl.at/c/blumen-pflanzen/a10095234'));
  assert.ok(__private.LIDL_OFFICIAL_CAMPAIGN_PAGES.includes('https://www.lidl.at/c/super-frische/s10013062'));
  assert.ok(__private.LIDL_OFFICIAL_CAMPAIGN_PAGES.includes('https://www.lidl.at/c/beim-grillen-richtig-kohle-sparen/a10095236'));
  assert.equal(__private.LIDL_OFFICIAL_CAMPAIGN_PAGES.includes('https://www.lidl.at/c/jeden-tag-deine-guenstigsten-preise/a10094561'), false);
  assert.equal(__private.LIDL_OFFICIAL_CAMPAIGN_PAGES.includes('https://www.lidl.at/c/blumen-pflanzen/a10094558'), false);
});

test('Lidl official web offer seeds include only explicit Lidl homepage URLs', () => {
  const pages = __private.getLidlWebOfferPagesForCrawl({
    crawlPolicy: {
      webOfferSeedUrls: [
        'https://www.lidl.at/',
        'https://www.lidl.at/c/flugblatt/s10012330',
      ],
    },
  });

  assert.deepEqual(pages, ['https://www.lidl.at/']);
  assert.deepEqual(__private.LIDL_OFFICIAL_WEB_OFFER_PAGES, ['https://www.lidl.at/']);
});

test('Lidl official campaign discovery merges official links with configured seeds', () => {
  const html = `
    <main>
      <a href="/c/aktion/a10095240">Aktion</a>
      <a href="https://www.lidl.at/c/blumen-pflanzen/a10095234">Blumen</a>
      <a href="/c/flugblatt/s10012330">Flugblatt</a>
      <a href="/c/sortiment/s99999999">Sortiment</a>
    </main>
  `;
  const discovered = __private.extractLidlCampaignPageLinksFromHtml(html, 'https://www.lidl.at/c/flugblatt/s10012330');
  const pages = __private.getLidlCampaignPagesForCrawl({
    html,
    source: {
      sourceUrl: 'https://www.lidl.at/c/flugblatt/s10012330',
      crawlPolicy: {
        campaignSeedUrls: ['https://www.lidl.at/c/frische-angebote/a10095239'],
      },
    },
  });

  assert.ok(discovered.includes('https://www.lidl.at/c/aktion/a10095240'));
  assert.ok(discovered.includes('https://www.lidl.at/c/blumen-pflanzen/a10095234'));
  assert.equal(discovered.some((url) => url.includes('/flugblatt/')), false);
  assert.ok(pages.includes('https://www.lidl.at/c/aktion/a10095240'));
  assert.ok(pages.includes('https://www.lidl.at/c/frische-angebote/a10095239'));
});

function billaActionSource() {
  return source({
    retailerKey: 'billa',
    retailerName: 'Billa',
    channel: 'official-site',
    sourceUrl: 'https://www.billa.at/unsere-aktionen/aktionen',
    label: 'BILLA Aktionen',
  });
}

function parseBillaActionHtml(bodyHtml, sourceOverrides = {}) {
  const billaSource = {
    ...billaActionSource(),
    ...sourceOverrides,
  };

  return __private.extractBillaActionTeasersFromHtml({
    html: `<html><body>${bodyHtml}</body></html>`,
    source: billaSource,
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pageUrl: billaSource.sourceUrl,
  });
}

function billaFlyerSource(overrides = {}) {
  return source({
    retailerKey: 'billa',
    retailerName: 'Billa',
    channel: 'official-flyer',
    sourceUrl: 'https://www.billa.at/unsere-aktionen/flugblatt',
    label: 'BILLA Flugblatt',
    sourceType: 'flyer',
    ...overrides,
  });
}

function currentBillaFlyerValidity() {
  const now = new Date();
  const validFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 12, 0, 0));
  const validTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 6, 23, 59, 59, 999));

  return {
    validFrom,
    validTo,
    validityText: `${validFrom.toISOString().slice(0, 10)} - ${validTo.toISOString().slice(0, 10)}`,
    confidence: 0.84,
  };
}

function parseBillaPdfPage(text, overrides = {}) {
  const validity = overrides.validity || currentBillaFlyerValidity();

  return {
    validity,
    candidates: extractBillaPdfCandidates({
      pages: [{ pageNumber: 1, text, positionedItems: overrides.positionedItems || [] }],
      validity,
      sourceRetailerFormat: overrides.sourceRetailerFormat || 'billa',
      now: overrides.now || new Date(),
    }),
  };
}

function normalizeBillaPdfFixture({
  text,
  pageNumber = 1,
  positionedItems = [],
  source: sourceDef = billaFlyerSource(),
  region = 'Steiermark',
  sourceRetailerFormat = sourceDef.retailerKey || 'billa',
}) {
  const validity = currentBillaFlyerValidity();
  const pdfReference = {
    validity,
    candidates: extractBillaPdfCandidates({
      pages: [{ pageNumber, text, positionedItems }],
      validity,
      sourceRetailerFormat,
      now: new Date('2026-06-12T10:00:00+02:00'),
    }),
  };

  return normalizeBillaPdfCandidatesToOffers({
    pdfReference,
    source: sourceDef,
    crawlJobId: new Types.ObjectId(),
    region,
    pdfUrl: sourceDef.sourceUrl,
  });
}

function findOffer(offers, pattern) {
  return offers.find((offer) => pattern.test(offer.title));
}

test('BILLA flyer PDF parser parses KW23 validity when start weekday is missing in text layer', () => {
  const validity = parseBillaFlyerValidity('VON , 3. 6. BIS MITTWOCH, 10. 6. 2026 AUF BIER');

  assert.equal(validity.validFrom.toISOString(), '2026-06-02T22:00:00.000Z');
  assert.equal(validity.validTo.toISOString(), '2026-06-10T21:59:59.999Z');
  assert.equal(validity.validityText, 'VON 3.6. BIS 10.6.2026');
  assert.equal(validity.confidence, 0.84);
});

test('BILLA flyer PDF parser extracts clear product and price candidates', () => {
  const pdfReference = parseBillaPdfPage(`
    clever
    Lachsfilet
    300 g
    clever
    Marmorkuchen
    400 g Packung
    499
    AB 2 PKG. JE
    1 PKG. € 6.99
    299
    AKTION
  `);
  const offers = normalizeBillaPdfCandidatesToOffers({
    pdfReference,
    source: billaFlyerSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pdfUrl: 'https://assets.example.test/BILLA_FB_KW22_2026.pdf',
  });

  assert.equal(parseCompressedPrice('499'), 4.99);
  assert.equal(pdfReference.candidates.filter((candidate) => !candidate.exclusionReason).length, 2);
  assert.equal(offers.length, 2);
  assert.equal(offers[0].title, 'clever Lachsfilet');
  assert.equal(offers[0].priceCurrent.amount, 4.99);
  assert.equal(offers[0].quantityText, '300 g');
  assert.equal(offers[0].rawFacts.sourceType, 'billa-official-flyer-pdf');
  assert.equal(offers[0].rawFacts.sourceKey, 'billa-official-flyer-flyer');
  assert.equal(offers[0].quality.comparisonSafe, true);
});

test('BILLA PLUS flyer PDF parser keeps retailer-specific source key', () => {
  const sourceDef = billaFlyerSource({
    retailerKey: 'billa-plus',
    retailerName: 'Billa Plus',
    label: 'BILLA PLUS Flugblatt',
  });
  const pdfReference = parseBillaPdfPage(`
    Ja! Natürlich
    Bio Joghurt
    500 g
    199
    statt
    2.49
  `, { sourceRetailerFormat: 'billa-plus' });
  const offers = normalizeBillaPdfCandidatesToOffers({
    pdfReference,
    source: sourceDef,
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pdfUrl: 'https://assets.example.test/BILLA_PLUS_FB_KW22_2026.pdf',
  });

  assert.equal(billaPdfSourceKeyForRetailer('billa-plus'), 'billa-plus-official-flyer-flyer');
  assert.equal(offers.length, 1);
  assert.equal(offers[0].retailerKey, 'billa-plus');
  assert.equal(offers[0].rawFacts.sourceKey, 'billa-plus-official-flyer-flyer');
  assert.equal(offers[0].priceCurrent.amount, 1.99);
});

test('BILLA PLUS flyer PDF parser removes known campaign prefix from product title', () => {
  const sourceDef = billaFlyerSource({
    retailerKey: 'billa-plus',
    retailerName: 'Billa Plus',
    label: 'BILLA PLUS Flugblatt',
  });
  const pdfReference = parseBillaPdfPage(`
    FREI VON 1o0%
    Vegavita Antipasti Selection
    360 g
    649
    AKTION
  `, { sourceRetailerFormat: 'billa-plus' });
  const offers = normalizeBillaPdfCandidatesToOffers({
    pdfReference,
    source: sourceDef,
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pdfUrl: 'https://assets.example.test/BILLA_PLUS_FB_KW22_2026.pdf',
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].title, 'Vegavita Antipasti Selection');
  assert.equal(offers[0].priceCurrent.amount, 6.49);
});

test('BILLA flyer PDF parser reports specific rejections instead of all parser-no-offer-candidate', () => {
  const pdfReference = parseBillaPdfPage(`
    MEGA-WOCHENENDE
    599
    Unklares Produktfragment
    199
    clever
    Preisloses Produkt
    250 g
  `);
  const reasons = summarizeBillaPdfRejections(pdfReference.candidates);
  const reasonKeys = reasons.map((item) => item.reason);

  assert.equal(pdfReference.candidates.some((candidate) => candidate.exclusionReason), true);
  assert.ok(reasonKeys.includes('product-unclear') || reasonKeys.includes('price-missing'));
  assert.equal(reasonKeys.includes('parser-no-offer-candidate'), false);
});

test('BILLA flyer PDF parser rejects clear title with missing quantity defensively', () => {
  const pdfReference = parseBillaPdfPage(`
    clever
    Datteln
    139
    statt
    1.69
  `);
  const offers = normalizeBillaPdfCandidatesToOffers({
    pdfReference,
    source: billaFlyerSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pdfUrl: 'https://assets.example.test/BILLA_FB_KW22_2026.pdf',
  });

  assert.equal(pdfReference.candidates.length, 1);
  assert.equal(pdfReference.candidates[0].exclusionReason, 'quantity-missing');
  assert.equal(offers.length, 0);
});

test('BILLA flyer PDF parser rejects implausible low statt-price pairing for large kg/l packs', () => {
  const pdfReference = parseBillaPdfPage(`
    Eskimo
    Cremissimo
    div. Sorten
    1 Liter
    079
    -33 %
    statt
    1.19
  `);
  const offers = normalizeBillaPdfCandidatesToOffers({
    pdfReference,
    source: billaFlyerSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pdfUrl: 'https://assets.example.test/BILLA_FB_KW22_2026.pdf',
  });
  const cremissimo = pdfReference.candidates.find((candidate) => /Cremissimo/i.test(candidate.title || ''));

  assert.equal(cremissimo?.price, 0.79);
  assert.equal(cremissimo?.quantityText, '1 l');
  assert.equal(cremissimo?.conditionsText, 'statt 1.19');
  assert.equal(cremissimo?.exclusionReason, 'price-quantity-implausible');
  assert.equal(offers.some((offer) => /Cremissimo/i.test(offer.title)), false);
});

test('BILLA flyer PDF parser keeps plausible simple statt-price candidates below large-pack guard', () => {
  const pdfReference = parseBillaPdfPage(`
    Ja! Natürlich
    Bio Joghurt
    500 g
    099
    statt
    1.19
  `);
  const offers = normalizeBillaPdfCandidatesToOffers({
    pdfReference,
    source: billaFlyerSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pdfUrl: 'https://assets.example.test/BILLA_FB_KW22_2026.pdf',
  });

  assert.equal(pdfReference.candidates.length, 1);
  assert.equal(pdfReference.candidates[0].exclusionReason, undefined);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].title, 'Ja! Natürlich Bio Joghurt');
  assert.equal(offers[0].priceCurrent.amount, 0.99);
});

test('BILLA flyer PDF parser rejects date-only alternative price pairing defensively', () => {
  const pdfReference = parseBillaPdfPage(`
    Eskimo
    Cremissimo
    1 l
    079
    DO MO DI
    299
    FR & SA
  `, { now: new Date('2026-05-28T12:00:00Z') });
  const offers = normalizeBillaPdfCandidatesToOffers({
    pdfReference,
    source: billaFlyerSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pdfUrl: 'https://assets.example.test/BILLA_FB_KW22_2026.pdf',
  });

  assert.equal(pdfReference.candidates.length, 1);
  assert.equal(pdfReference.candidates[0].title, 'Eskimo Cremissimo');
  assert.equal(pdfReference.candidates[0].price, 0.79);
  assert.equal(pdfReference.candidates[0].conditionsText, '');
  assert.equal(pdfReference.candidates[0].exclusionReason, 'product-price-ambiguous');
  assert.equal(offers.length, 0);
});

test('BILLA flyer PDF parser keeps clear multi-buy conditions clean and structured', () => {
  const pdfReference = parseBillaPdfPage(`
    Schaerdinger
    Teebutter
    250 g
    Eskimo
    Twinni
    470 ml
    Schogetten
    Schokolade
    100 g
    Schwechater
    Bier
    0.5 l
    159
    AB 4 PKG. JE
    201
    AB 2 PACKUNGEN
    099
    BEI 4 PACKUNGEN
    069
    BEI 24 DOSEN JE
  `);
  const offers = normalizeBillaPdfCandidatesToOffers({
    pdfReference,
    source: billaFlyerSource({ retailerKey: 'billa-plus', retailerName: 'Billa Plus' }),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pdfUrl: 'https://assets.example.test/BILLA_PLUS_FB_KW22_2026.pdf',
  });

  assert.equal(pdfReference.candidates.filter((candidate) => !candidate.exclusionReason).length, 4);
  assert.equal(offers.length, 4);
  assert.deepEqual(offers.map((offer) => offer.conditionsText), [
    'ab 4 Packungen',
    'ab 2 Packungen',
    'bei 4 Packungen',
    'bei 24 Dosen',
  ]);
  assert.deepEqual(offers.map((offer) => offer.minimumPurchaseQty), [4, 2, 4, 24]);
});

test('BILLA flyer PDF parser removes layout date fragments from visible conditions', () => {
  const pdfReference = parseBillaPdfPage(`
    FREI VON 1o0%
    Vegavita Antipasti Selection
    360 g
    649
    AKTION
    487 FR & SA
    FR & SA
    Alternative Flyerpreise: 6.49 EUR (649 AKTION); 4.87 EUR (487 FR & SA)
  `, { sourceRetailerFormat: 'billa-plus' });
  const offers = normalizeBillaPdfCandidatesToOffers({
    pdfReference,
    source: billaFlyerSource({
      retailerKey: 'billa-plus',
      retailerName: 'Billa Plus',
      label: 'BILLA PLUS Flugblatt',
    }),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pdfUrl: 'https://assets.example.test/BILLA_PLUS_FB_KW22_2026.pdf',
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].title, 'Vegavita Antipasti Selection');
  assert.equal(offers[0].conditionsText, 'Aktion');
  assert.doesNotMatch(offers[0].conditionsText, /487|FR|Alternative Flyerpreise/i);
  assert.doesNotMatch(offers[0].searchText, /alternative flyerpreise/i);
});

test('BILLA flyer PDF parser extracts KW24 dense page references', () => {
  const pdfReference = parseBillaPdfPage(`
    Österreichisches HENDL-FILET ZUM EXTREM PREIS
    SanLucar Wassermelone Kl. I, im Ganzen, kernarm per Kilo 129
    clever Hendl-Filet in Selbstbedienung, 700 g (1 kg 12.99/8.56) 599 AB 2 PKG. JE 1 PKG. € 9.09
    Lindt Goldtafel div. Sorten 300 g (100 g 3.33/1.66) 499 1+1 BEI 2 TAFELN JE 1 TAFEL € 9.99
  `);
  const offers = normalizeBillaPdfCandidatesToOffers({
    pdfReference,
    source: billaFlyerSource({
      retailerKey: 'billa-plus',
      retailerName: 'Billa Plus',
      label: 'BILLA PLUS Flugblatt',
    }),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pdfUrl: 'https://assets.example.test/BILLA_PLUS_FB_KW24_2026.pdf',
  });
  const watermelon = offers.find((offer) => /Wassermelone/i.test(offer.title));
  const hendl = offers.find((offer) => /Hendl-Filet/i.test(offer.title));
  const lindt = offers.find((offer) => /Goldtafel/i.test(offer.title));

  assert.ok(watermelon);
  assert.equal(watermelon.priceCurrent.amount, 1.29);
  assert.equal(watermelon.quantityText, '1 kg');
  assert.ok(hendl);
  assert.equal(hendl.priceCurrent.amount, 5.99);
  assert.equal(hendl.quantityText, '700 g');
  assert.match(hendl.conditionsText, /ab 2 Packungen/i);
  assert.ok(lindt);
  assert.equal(lindt.priceCurrent.amount, 4.99);
});

test('BILLA flyer PDF parser extracts KW24 grill supplement dense references', () => {
  const pdfReference = parseBillaPdfPage(`
    Bertolli Grill Olivenöl 0,5 Liter Flasche (1 l 13.98)
    Puntigamer Bier 0,5 Liter 069 1 DOSE € 1.54 -55 % AB 24 DOSEN JE
    clever Ofen-/Grill-Lachs 250 g Packung 699 AB 2 PACKUNGEN JE 1 PKG. € 8.99
    Radatz Grillhitparade Chili Käsekrainer, Chili Bratwürstel, Berner Würstel, Käsekrainer, Bratwürstel, 680 g Packung (100 g 0.88) 599
    clever Baguette div. Sorten 175 g Packung (1 kg 4.51) 079
  `);
  const offers = normalizeBillaPdfCandidatesToOffers({
    pdfReference,
    source: billaFlyerSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'AT',
    pdfUrl: 'https://assets.example.test/BILLA_GRILLEN_KW24_2026.pdf',
  });
  const puntigamer = offers.find((offer) => /Puntigamer/i.test(offer.title));
  const lachs = offers.find((offer) => /Grill-Lachs/i.test(offer.title)
    && offer.priceCurrent?.amount === 6.99);
  const radatz = offers.find((offer) => /Radatz Grillhitparade/i.test(offer.title));
  const baguette = offers.find((offer) => /Baguette/i.test(offer.title));

  assert.ok(puntigamer);
  assert.equal(puntigamer.priceCurrent.amount, 0.69);
  assert.equal(puntigamer.quantityText, '0.5 l');
  assert.match(puntigamer.conditionsText, /24 Dosen/i);
  assert.ok(lachs);
  assert.equal(lachs.priceCurrent.amount, 6.99);
  assert.equal(lachs.quantityText, '250 g');
  assert.match(lachs.conditionsText, /ab 2 Packungen/i);
  assert.ok(radatz);
  assert.equal(radatz.priceCurrent.amount, 5.99);
  assert.ok(baguette);
  assert.equal(baguette.priceCurrent.amount, 0.79);
});

test('BILLA Steiermark PDF parser extracts separated page 15 product-price cluster', () => {
  const offers = normalizeBillaPdfFixture({
    pageNumber: 15,
    text: `
      MI., 17. 6. 2026
      Gültig in allen BILLA und BILLA PLUS Märkten.199
      BEI 3 FL. JE
      1 FL. € 2.99
      2+1
      Axe
      Dusche
      div. Sorten
      250 ml (100 ml
      1.20/0.80)
      Sansin
      Waschmittel
      div. Sorten
      44 Waschgänge,
      per Flasche
      (1 WG 0.16)
      Sansin
      Weichspüler
      div. Sorten
      80 Waschgänge,
      per Flasche
      (1 WG 0.04)
      Sheba
      Frischebeutel
      od. Fresh & Fine
      div. Sorten
      160 g – 340 g
      (1 kg 11.15 – 23.69/
      8.79 – 18.69)
      Sheba
      Katzenschalen
      div. Sorten
      85 g (1 kg 10.47/8.12)
      Cif
      Bad & Dusche
      Sprühflasche
      750 ml Flasche
      (1 l 3.98)
      679statt
      9.99
      AKTION
      -32%
      299statt
      4.99
      AKTION
      -40%
      299statt
      3.49
      AKTION
      -050
      299
      AB 2 PKG. JE
      1 PKG. € 4.99
      -40%
      BI Home
      Toilettenpapier
      4-lagig 10x180 Blatt
      Dreamies
      Katzensnacks
      div. Sorten
      30 g – 60 g
      (1 kg 44.83 – 89.67/
      29.83 – 59.67)
      179
      BEI 3 PKG. JE
      1 PKG. € 2.69
      2+1
      299
      AKTION
      -080
      AB 2 PKG. JE
      1 PKG. € 3.79
      069
      AKTION
      -020
      AB 4 PKG. JE
      1 PKG. € 0.89
    `,
  });

  assert.equal(findOffer(offers, /^Axe Dusche$/)?.priceCurrent.amount, 1.99);
  assert.equal(findOffer(offers, /^Sansin Waschmittel$/)?.quantityText, '44 WG');
  assert.equal(findOffer(offers, /^Sansin Waschmittel$/)?.priceCurrent.amount, 6.79);
  assert.equal(findOffer(offers, /^Sansin Weichspüler$/)?.priceCurrent.amount, 2.99);
  assert.equal(findOffer(offers, /^Sheba Frischebeutel/)?.priceCurrent.amount, 2.99);
  assert.equal(findOffer(offers, /^Sheba Katzenschalen$/)?.conditionsText, 'ab 2 Packungen');
  assert.equal(findOffer(offers, /^Cif Bad & Dusche/)?.priceCurrent.amount, 1.79);
  assert.equal(findOffer(offers, /^BI Home Toilettenpapier/)?.quantityText, '10x180 Blatt');
  assert.equal(findOffer(offers, /^BI Home Toilettenpapier/)?.priceCurrent.amount, 2.99);
  assert.equal(findOffer(offers, /^Dreamies Katzensnacks$/)?.priceCurrent.amount, 0.69);
  assert.ok(offers.every((offer) => offer.rawFacts.parserHint === 'billa-pdf-separated-product-price-cluster'));
});

test('BILLA Steiermark PDF parser extracts interleaved page 4 and page 8 products without cross-pairing', () => {
  const page4Offers = normalizeBillaPdfFixture({
    pageNumber: 4,
    text: `
      clever
      Chicken-Wings
      BBQ-mariniert
      in Selbstbedienung,
      500 g (1 kg 7.98/5.98)
      clever
      Spareribs
      classic mariniert
      in Selbstbedienung,
      per Kilo299
      AKTION
      -25%
      AB 2 PKG. JE
      1 PKG. € 3.99
      Die Grillerei
      Burger Buns
      Brioche 4 Stk.
      geschnitten,
      300 g Packung
      (1 kg 5.63) 169
    `,
  });
  const burger = findOffer(page4Offers, /Burger Buns Brioche/);

  assert.ok(burger);
  assert.equal(burger.priceCurrent.amount, 1.69);
  assert.equal(burger.quantityText, '4 Stk');
  assert.equal(page4Offers.some((offer) => /Burger Buns/i.test(offer.title) && offer.priceCurrent.amount === 4.99), false);

  const page8Offers = normalizeBillaPdfFixture({
    pageNumber: 8,
    text: `
      Rama
      Cremefine
      div. Sorten
      200 ml – 250 ml
      (1 l 5.96 – 7.45/
      2.96 – 3.70)
      074
      BEI 4 FL. JE
      1 FL. € 1.49
      2+2
    `,
  });
  const rama = findOffer(page8Offers, /^Rama Cremefine$/);

  assert.ok(rama);
  assert.equal(rama.priceCurrent.amount, 0.74);
  assert.equal(rama.quantityText, '200 ml');
  assert.equal(rama.conditionsText, 'bei 4 Flaschen');
});

test('BILLA Steiermark PDF parser rejects title price artifacts while keeping clean candidates', () => {
  const parsed = parseBillaPdfPage(`
    Hohes C od. Hohes C All-In-One
    4.65/ 2.66) 2.99/3.49
    0,85 l
    199
    AKTION
    Hohes C All-In-One
    0,85 l
    199
    AB 2 FL. JE
    1 FL. EUR 2.99
    Pistazien gesalzen od. ungesalzen 2.26/Arizona NUR Eistee KURZE ZEIT
    250 g
    299
    AKTION
  `);

  assert.ok(parsed.candidates.some((candidate) => (
    /Hohes C od\./i.test(candidate.title)
    && candidate.exclusionReason === 'title-price-artifact'
  )));
  assert.ok(parsed.candidates.some((candidate) => (
    /Pistazien/i.test(candidate.title)
    && candidate.exclusionReason === 'title-price-artifact'
  )));
  assert.ok(parsed.candidates.some((candidate) => (
    candidate.title === 'Hohes C All-In-One'
    && !candidate.exclusionReason
  )));

  const offers = normalizeBillaPdfCandidatesToOffers({
    pdfReference: parsed,
    source: billaFlyerSource(),
    crawlJobId: new Types.ObjectId(),
    region: 'Steiermark',
    pdfUrl: billaFlyerSource().sourceUrl,
  });

  assert.equal(offers.some((offer) => /4\.65\/\s*2\.66/i.test(offer.title)), false);
  assert.equal(offers.some((offer) => /kurze zeit/i.test(offer.title)), false);
  assert.ok(offers.some((offer) => offer.title === 'Hohes C All-In-One'));
});

test('BILLA Steiermark PDF parser extracts separated page 16 beverage cluster', () => {
  const offers = normalizeBillaPdfFixture({
    pageNumber: 16,
    text: `
      Ja! Natürlich
      Bio-Rinderfaschiertes
      in Selbstbedienung,
      360 g (1 kg 24.97/13.86)
      Vöslauer
      Mineral-
      wasser
      div. Sorten
      1,5 Liter
      (1 l 0.66/0.33)
      Schwechater
      Bier
      0,5 Liter
      Schärdinger
      Bergbauern
      Joghurt
      div. Sorten
      500 g
      (1 kg 3.98/1.98)
      499
      AB 2 PKG. JE
      1 PKG. € 8.99
      -44 %
      099
      BEI 2 GL. JE
      1 GLAS € 1.99
      1+1
      069
      BEI 24 DOSEN JE
      1 DOSE € 1.39
      12+12
      049
      BEI 6 FL. JE
      1 FL. € 0.99
      3+3
    `,
  });

  assert.equal(findOffer(offers, /Bio-Rinderfaschiertes/)?.priceCurrent.amount, 4.99);
  assert.equal(findOffer(offers, /Schwechater Bier/)?.priceCurrent.amount, 0.69);
  assert.equal(findOffer(offers, /Schwechater Bier/)?.conditionsText, 'bei 24 Dosen');
});

test('BILLA Steiermark PDF parser does not map page 3 price block blindly to Eissalat', () => {
  const offers = normalizeBillaPdfFixture({
    pageNumber: 3,
    text: `
      099
      -28 %
      statt
      1.39
      299
      -25 %
      statt
      3.99
      199
      -33 %
      statt
      2.99
      Da komm’ ich her!
      Eissalat
      Kl. I, per Stück
      Trauben
      weiß kernlos
      Kl. I, 500 g Packung
      (1 kg 3.98)
    `,
  });

  assert.equal(offers.some((offer) => /Eissalat/i.test(offer.title)), false);
});

test('BILLA Steiermark PDF parser maps page 3 produce only with positioned text evidence', () => {
  const p = (str, x, y) => ({ str, x, y, width: 20, height: 10 });
  const positionedItems = [
    p('099', 10, 10),
    p('Da komm ich her!', 28, 18),
    p('Trauben', 28, 28),
    p('weiss kernlos', 28, 42),
    p('Kl. I, 500 g Packung', 28, 56),
    p('(1 kg 3.98)', 28, 70),
    p('1', 198, 28),
    p('99', 221, 47),
    p('2.99', 241, 28),
    p('Da komm ich her!', 271, 18),
    p('Erdbeeren', 271, 28),
    p('Kl. I, 500 g Tasse (1 kg 5.98)', 271, 46),
    p('2', 433, 28),
    p('99', 463, 47),
    p('3.99', 483, 28),
    p('Da komm ich her!', 28, 210),
    p('Eissalat', 28, 223),
    p('Kl. I, per Stueck', 28, 240),
    p('0', 185, 223),
    p('99', 221, 242),
    p('1.99', 242, 223),
    p('Paprika', 271, 223),
    p('rot od. gelb', 271, 240),
    p('Kl. I, per Stueck', 271, 256),
    p('0', 427, 223),
    p('99', 463, 242),
    p('1.69', 484, 223),
    p('Da komm ich her!', 28, 405),
    p('Kohlrabi', 28, 417),
    p('Kl. I, per Stueck', 28, 435),
    p('0', 104, 417),
    p('99', 140, 436),
    p('1.39', 161, 417),
    p('LGV', 454, 470),
    p('Mini-San-', 454, 483),
    p('Marzano-', 454, 500),
    p('Paradeiser', 454, 514),
    p('Kl. I, 300 g Tasse', 454, 532),
    p('(1 kg 9.96)', 454, 548),
    p('2', 427, 424),
    p('99', 463, 443),
    p('3.99', 483, 424),
    p('Chry-', 124, 657),
    p('santhemen', 124, 675),
    p('div. Farben,', 124, 690),
    p('3 Stiele,', 124, 706),
    p('ca. 50 cm lang,', 124, 722),
    p('per Bund', 124, 738),
    p('3', 111, 611),
    p('49', 140, 630),
  ];
  const offers = normalizeBillaPdfFixture({
    pageNumber: 3,
    positionedItems,
    text: `
      Da komm ich her!
      Trauben
      weiss kernlos
      Kl. I, 500 g Packung
      Da komm ich her!
      Erdbeeren
      Kl. I, 500 g Tasse (1 kg 5.98)
      Da komm ich her!
      Eissalat
      Kl. I, per Stueck
      Paprika
      rot od. gelb
      Kl. I, per Stueck
      Da komm ich her!
      Kohlrabi
      Kl. I, per Stueck
      LGV
      Mini-San-
      Marzano-
      Paradeiser
      Kl. I, 300 g Tasse
      (1 kg 9.96)
      Chry-
      santhemen
      div. Farben,
      3 Stiele,
      ca. 50 cm lang,
      per Bund
    `,
  });

  assert.equal(findOffer(offers, /^Trauben weiss kernlos$/)?.priceCurrent.amount, 1.99);
  assert.equal(findOffer(offers, /^Trauben weiss kernlos$/)?.quantityText, '500 g');
  assert.equal(findOffer(offers, /^Erdbeeren$/)?.priceCurrent.amount, 2.99);
  assert.equal(findOffer(offers, /^Eissalat$/)?.priceCurrent.amount, 0.99);
  assert.equal(findOffer(offers, /^Paprika rot od\. gelb$/)?.priceCurrent.amount, 0.99);
  assert.equal(findOffer(offers, /^Kohlrabi$/)?.priceCurrent.amount, 0.99);
  assert.equal(findOffer(offers, /^LGV Mini-San-Marzano-Paradeiser$/)?.priceCurrent.amount, 2.99);
  assert.equal(findOffer(offers, /^LGV Mini-San-Marzano-Paradeiser$/)?.quantityText, '300 g');
  assert.equal(findOffer(offers, /^Chrysanthmen div\. Farben$/)?.priceCurrent.amount, 3.49);
  assert.equal(findOffer(offers, /^Chrysanthmen div\. Farben$/)?.quantityText, '1 Bund');
  assert.ok(offers.every((offer) => offer.rawFacts.parserHint === 'billa-pdf-positioned-frontloaded-produce'));
});

test('BILLA flyer source selects retailer-specific official PDF links', () => {
  const links = [
    { type: 'pdf', url: 'https://assets.example.test/BILLA_FB_KW22_2026_Wien.pdf', label: 'BILLA Flugblatt' },
    { type: 'pdf', url: 'https://assets.example.test/BILLA_PLUS_FB_KW22_2026_Wien.pdf', label: 'BILLA PLUS Flugblatt' },
    { type: 'pdf', url: 'https://assets.example.test/BILLA_Grillen_Beileger_KW24_2026.pdf', label: 'BILLA Grillen Beileger' },
    { type: 'html', url: 'https://www.billa.at/unsere-aktionen/flugblatt', label: 'Flugblatt' },
  ];

  const billaLinks = __private.selectBillaFlyerPdfLinks({ links, source: billaFlyerSource() });
  const billaPlusLinks = __private.selectBillaFlyerPdfLinks({
    links,
    source: billaFlyerSource({ retailerKey: 'billa-plus', retailerName: 'Billa Plus' }),
  });

  assert.deepEqual(billaLinks.map((link) => link.url), [
    'https://assets.example.test/BILLA_FB_KW22_2026_Wien.pdf',
    'https://assets.example.test/BILLA_Grillen_Beileger_KW24_2026.pdf',
  ]);
  assert.deepEqual(billaPlusLinks.map((link) => link.url), [
    'https://assets.example.test/BILLA_PLUS_FB_KW22_2026_Wien.pdf',
    'https://assets.example.test/BILLA_Grillen_Beileger_KW24_2026.pdf',
  ]);
});

test('BILLA flyer source selects official Publitas Steiermark PDF links and source keys', () => {
  const billaPdf = 'https://view.publitas.com/90963/3139229/pdfs/example.pdf?downloadPdf=BILLA%20-%20BILLA%20Steiermark.pdf';
  const billaPlusPdf = 'https://view.publitas.com/91215/3139237/pdfs/example.pdf?downloadPdf=BILLA%20PLUS%20Steiermark.pdf';
  const billaSourceDef = billaFlyerSource({
    label: 'BILLA Flugblatt Steiermark',
    sourceUrl: 'https://view.publitas.com/billa-at/billa_fb_kw24_2026_steiermark/',
    regionScope: 'Steiermark',
    crawlPolicy: { regionLevel: 'Bundesland' },
  });
  const billaPlusSourceDef = billaFlyerSource({
    retailerKey: 'billa-plus',
    retailerName: 'Billa Plus',
    label: 'BILLA PLUS Flugblatt Steiermark',
    sourceUrl: 'https://view.publitas.com/billa-plus/billa_plus_fb_kw24_2026_steiermark/',
    regionScope: 'Steiermark',
    crawlPolicy: { regionLevel: 'Bundesland' },
  });

  assert.deepEqual(__private.selectBillaFlyerPdfLinks({
    links: [{ type: 'pdf', url: billaPdf, label: billaPdf }],
    source: billaSourceDef,
  }).map((link) => link.url), [billaPdf]);
  assert.deepEqual(__private.selectBillaFlyerPdfLinks({
    links: [{ type: 'pdf', url: billaPlusPdf, label: billaPlusPdf }],
    source: billaPlusSourceDef,
  }).map((link) => link.url), [billaPlusPdf]);
  assert.equal(deriveSourceKey(billaSourceDef), 'billa-official-flyer-steiermark');
  assert.equal(deriveSourceKey(billaPlusSourceDef), 'billa-plus-official-flyer-steiermark');
  assert.equal(billaPdfSourceKeyForRetailer('billa', billaSourceDef.sourceUrl), 'billa-official-flyer-steiermark');
  assert.equal(billaPdfSourceKeyForRetailer('billa-plus', billaPlusSourceDef.sourceUrl), 'billa-plus-official-flyer-steiermark');
});

test('BILLA action HTML parser selects FR-SA price window for Dallmayr on Friday', () => {
  const parsed = __private.parseBillaActionTeaserName(`
    Dallmayr Prodomo Kaffee in verschiedenen Sorten, 500 Gramm Packung.
    Aktion mit Preisreduktion an bestimmten Wochentagen, von Montag bis Mittwoch sowie Freitag und Samstag.
    Der Preis pro Packung beträgt 11,99 Euro von Montag bis Mittwoch.
    Der Preis pro Packung beträgt 8,99 Euro am Freitag und Samstag.
  `, { now: new Date('2026-06-12T10:00:00+02:00') });

  assert.equal(parsed.title, 'Dallmayr Prodomo');
  assert.equal(parsed.quantityText, '500 g');
  assert.equal(parsed.currentPrice, 8.99);
  assert.equal(parsed.referencePrice, 11.99);
  assert.match(parsed.conditionsText, /Preisfenster/);
  assert.equal(parsed.priceWindow.selectedWeekdays.includes('fr'), true);
  assert.equal(parsed.validFrom.toISOString(), '2026-06-11T22:00:00.000Z');
  assert.equal(parsed.validTo.toISOString(), '2026-06-13T21:59:59.999Z');
});

test('BILLA action HTML parser selects DO/MO-MI price window outside Friday-Saturday', () => {
  const parsed = __private.parseBillaActionTeaserName(`
    Dallmayr Prodomo Kaffee in verschiedenen Sorten, 500 Gramm Packung.
    Der Preis pro Packung beträgt 11,99 Euro von Montag bis Mittwoch.
    Der Preis pro Packung beträgt 8,99 Euro am Freitag und Samstag.
  `, { now: new Date('2026-06-15T10:00:00+02:00') });

  assert.equal(parsed.currentPrice, 11.99);
  assert.equal(parsed.priceWindow.selectedWeekdays.includes('mo'), true);
  assert.equal(parsed.validFrom.toISOString(), '2026-06-14T22:00:00.000Z');
  assert.equal(parsed.validTo.toISOString(), '2026-06-17T21:59:59.999Z');
});

test('BILLA action HTML parser extracts Egger Extrem Aktion product-near 12+12 condition', () => {
  const result = parseBillaActionHtml(`
    <h2>Gültig bei BILLA & BILLA PLUS</h2>
    <div class="row">
      <h3>Extrem Aktion*</h3>
      <div>Gültig von Donnerstag, 11.6. bis Mittwoch, 17.6.2026</div>
    </div>
    <div class="ws-slider-group">
      <article>
        <div data-teaser-name="Egger
div. Sorten
0,5 Liter

1 DOSE € 1,19
12+12
GRATIS
BEI 24 DOSEN JE
0,59">
          <img src="https://assets.example.test/egger.jpg">
        </div>
      </article>
    </div>
  `);
  const stored = enrichOffersForStorage(result.offers, {
    source: billaActionSource(),
    parserVersion: 'test',
  });

  assert.equal(result.offers.length, 1);
  assert.equal(stored[0].title, 'Egger div. Sorten');
  assert.match(stored[0].conditionsText, /Extrem Aktion/);
  assert.match(stored[0].conditionsText, /12\+12 gratis/);
  assert.match(stored[0].conditionsText, /bei 24 Dosen/);
  assert.equal(stored[0].minimumPurchaseQty, 24);
  assert.equal(stored[0].isMultiBuy, true);
  assert.equal(stored[0].validFrom.toISOString(), '2026-06-11T12:00:00.000Z');
  assert.equal(stored[0].validTo.toISOString(), '2026-06-17T23:59:59.999Z');
  assert.equal(stored[0].rawFacts.sourceType, 'billa-official-action-html');
});

test('BILLA action HTML parser extracts Dallmayr price-window teaser from markup', () => {
  const result = parseBillaActionHtml(`
    <h2>GÃ¼ltig bei BILLA & BILLA PLUS</h2>
    <div class="row">
      <h3>Kaffee</h3>
      <div>GÃ¼ltig von Donnerstag, 11.6. bis Mittwoch, 17.6.2026</div>
    </div>
    <div class="ws-slider-group">
      <article>
        <div data-teaser-name="Dallmayr Prodomo Kaffee in verschiedenen Sorten, 500 Gramm Packung.
Aktion mit Preisreduktion an bestimmten Wochentagen, von Montag bis Mittwoch sowie Freitag und Samstag.
Der Preis pro Packung beträgt 11,99 Euro von Montag bis Mittwoch.
Der Preis pro Packung beträgt 8,99 Euro am Freitag und Samstag."></div>
      </article>
    </div>
  `);

  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].title, 'Dallmayr Prodomo');
  assert.equal(result.offers[0].priceCurrent.amount, 8.99);
  assert.equal(result.offers[0].priceReference.amount, 11.99);
  assert.equal(result.offers[0].rawFacts.priceWindow.selectedWeekdays.includes('fr'), true);
});

test('BILLA action HTML parser keeps global legal text out of product conditions', () => {
  const result = parseBillaActionHtml(`
    <h2>Gültig bei BILLA & BILLA PLUS</h2>
    <div class="row">
      <h3>Extrem Aktion*</h3>
      <div>Gültig von Mittwoch, 27.5. bis Dienstag, 2.6.2026</div>
    </div>
    <div class="legal">Rechtstext: 12+12 gratis bei 24 Dosen je 0,59, solange der Vorrat reicht.</div>
    <div class="ws-slider-group">
      <article>
        <div data-teaser-name="Test Produkt
0,5 Liter
1 DOSE € 1,19"></div>
      </article>
    </div>
  `);

  assert.equal(result.offers.length, 0);
});

test('BILLA action HTML parser does not copy a neighbor product condition', () => {
  const result = parseBillaActionHtml(`
    <h2>Gültig bei BILLA & BILLA PLUS</h2>
    <div class="row">
      <h3>Extrem Aktion*</h3>
      <div>Gültig von Mittwoch, 27.5. bis Dienstag, 2.6.2026</div>
    </div>
    <div class="ws-slider-group">
      <article><div data-teaser-name="Egger
0,5 Liter
1 DOSE € 1,19
12+12
GRATIS
BEI 24 DOSEN JE
0,59"></div></article>
      <article><div data-teaser-name="Nachbar Produkt
0,5 Liter
1 DOSE € 1,19"></div></article>
    </div>
  `);

  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].title, 'Egger');
  assert.doesNotMatch(result.offers[0].conditionsText, /Nachbar/);
});

test('BILLA action HTML parser allows offers without safe condition to stay unparsed', () => {
  const result = parseBillaActionHtml(`
    <h2>Gültig bei BILLA & BILLA PLUS</h2>
    <div class="row">
      <h3>Extrem Aktion*</h3>
      <div>Gültig von Mittwoch, 27.5. bis Dienstag, 2.6.2026</div>
    </div>
    <div class="ws-slider-group">
      <article><div data-teaser-name="Normales Angebot
1 Liter
1 FLASCHE € 1,19"></div></article>
    </div>
  `);

  assert.equal(result.offers.length, 0);
});

test('BILLA action HTML parser only takes section context from the nearest assigned section', () => {
  const result = parseBillaActionHtml(`
    <h2>Gültig bei BILLA & BILLA PLUS</h2>
    <div class="row">
      <h3>Extrem Aktion*</h3>
      <div>Gültig von Mittwoch, 27.5. bis Dienstag, 2.6.2026</div>
    </div>
    <div class="ws-slider-group">
      <article><div data-teaser-name="Egger
0,5 Liter
1 DOSE € 1,19
12+12
GRATIS
BEI 24 DOSEN JE
0,59"></div></article>
    </div>
    <div class="row">
      <h3>Grillzeit ist Genusszeit!</h3>
      <div>Gültig von Mittwoch, 27.5. bis Dienstag, 2.6.2026</div>
    </div>
    <div class="ws-slider-group">
      <article><div data-teaser-name="Grill Produkt
1,5 Liter
1 FLASCHE € 2,39
3+3
GRATIS
BEI 6 FL. JE
1,19"></div></article>
    </div>
  `);

  assert.equal(result.offers.length, 2);
  assert.match(result.offers[0].conditionsText, /Extrem Aktion/);
  assert.doesNotMatch(result.offers[1].conditionsText, /Extrem Aktion/);
  assert.equal(result.offers[1].rawFacts.sectionTitle, 'Grillzeit ist Genusszeit!');
});
