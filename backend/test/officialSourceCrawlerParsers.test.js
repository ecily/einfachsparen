const assert = require('node:assert/strict');
const test = require('node:test');
const { Types } = require('mongoose');
const { __private } = require('../src/services/crawl/officialSourceCrawler');
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

test('BIPA official parser extracts current sale price, reference price and perfume offers from current product-card markup', () => {
  const html = `
    <html><body>
      <p>Gueltig bis 20.05.2026</p>
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
  assert.equal(offers[0].rawFacts.availabilityScope.type, 'unknown');
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

test('dm Ausverkauf source is active official-site input for normal full crawl selection', () => {
  const dmOfficial = RETAILER_DEFINITIONS.find((definition) =>
    definition.retailerKey === 'dm' && definition.channel === 'official-site'
  );

  assert.equal(dmOfficial.sourceUrl, 'https://www.dm.at/ausverkauf');
  assert.notEqual(dmOfficial.enabled, false);
  assert.equal(deriveSourceKey({ ...dmOfficial, sourceType: 'offers-page' }), 'dm-official-site');
});
