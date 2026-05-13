const assert = require('node:assert/strict');
const test = require('node:test');
const { Types } = require('mongoose');
const { __private } = require('../src/services/crawl/officialSourceCrawler');
const { enrichOffersForStorage } = require('../src/services/crawl/offerAuditEnrichment');
const { buildValidityLabel } = require('../src/services/offers/offerRankingService');
const { RETAILER_DEFINITIONS } = require('../src/services/sources/sourceDefinitions');
const { deriveSourceKey } = require('../src/services/crawl/crawlSourceSelection');

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
  assert.equal(buildValidityLabel(enriched[0]), 'aktuell verfuegbar, Enddatum nicht erkannt');
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
  const offers = __private.parseDmSaleOffersFromProductSearchJson({
    payload: { products: [dmProduct()] },
    source: dmOfficialSource(),
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
  assert.equal(offers[0].normalizedUnitPrice.amount, 20);
  assert.equal(offers[0].normalizedUnitPrice.unit, 'kg');
  assert.equal(offers[0].rawFacts.dmDan, 3087729);
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
  assert.equal(buildValidityLabel(enriched[0]), 'aktuell verfuegbar, Enddatum nicht erkannt');
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

test('dm Ausverkauf source is active official-site input for normal full crawl selection', () => {
  const dmOfficial = RETAILER_DEFINITIONS.find((definition) =>
    definition.retailerKey === 'dm' && definition.channel === 'official-site'
  );

  assert.equal(dmOfficial.sourceUrl, 'https://www.dm.at/ausverkauf');
  assert.notEqual(dmOfficial.enabled, false);
  assert.equal(deriveSourceKey({ ...dmOfficial, sourceType: 'offers-page' }), 'dm-official-site');
});
