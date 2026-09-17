const test = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const page = require('./fixtures/billa/kw38-2026-plus-page20.json');
const { extractBillaPdfCandidates, normalizeBillaPdfCandidatesToOffers, PARSER_VERSION } = require('../src/services/crawl/billaOfficialFlyerPdfParser');

// Official PDF SHA256 a9015ae3bdc48ceb25b2839ae1a4e8690c37248e4f465c37269ebbd897bcbd37.
// Text/positions from page 20; original layout visually checked, without changing the source.
function parse(input = page, retailerKey = 'billa-plus') {
  const validity = { validFrom: new Date(Date.now() - 3600000), validTo: new Date(Date.now() + 86400000), confidence: 0.84 };
  const candidates = extractBillaPdfCandidates({ pages: [input], validity, sourceRetailerFormat: retailerKey });
  const source = { _id: new Types.ObjectId(), retailerKey, retailerName: retailerKey, channel: 'official-flyer', sourceUrl: 'https://www.billa.at/unsere-aktionen/flugblatt' };
  const offers = normalizeBillaPdfCandidatesToOffers({ pdfReference: { candidates, validity }, source, crawlJobId: new Types.ObjectId(), region: 'AT', pdfUrl: 'https://assets-eu-01.kc-usercontent.com/test.pdf' });
  return { candidates, offers, source };
}

for (const retailer of ['billa', 'billa-plus']) {
  test(`${retailer}: actual neighbouring meat/milk cards keep their own price, quantity, category and conditions`, () => {
    const { candidates, offers, source } = parse(page, retailer);
    const meat = offers.filter((o) => /Rindsgulasch/.test(o.title));
    const milk = offers.filter((o) => /H-Milch/.test(o.title));
    assert.equal(meat.length, 1);
    assert.equal(milk.length, 1);
    assert.equal(meat[0].priceCurrent.amount, 12.99);
    assert.equal(meat[0].quantityText, '1 kg');
    assert.equal(meat[0].normalizedUnitPrice.amount, 12.99);
    assert.equal(meat[0].normalizedUnitPrice.unit, 'kg');
    assert.match(meat[0].categorySecondary, /Fleisch/);
    assert.equal(milk[0].priceCurrent.amount, 0.9);
    assert.equal(milk[0].quantityText, '1 l');
    assert.equal(milk[0].normalizedUnitPrice.amount, 0.9);
    assert.equal(milk[0].normalizedUnitPrice.unit, 'l');
    assert.match(milk[0].categorySecondary, /Milch/);
    assert.equal(milk[0].conditionsText, 'ab 12 Packungen');
    assert.ok(offers.every((o) => !(/Rindsgulasch/.test(o.title) && /Milch|Formil/.test(o.title))));
    assert.ok(offers.every((o) => !(o.normalizedUnitPrice.amount === 12.99 && o.normalizedUnitPrice.unit === 'l')));
    assert.ok(candidates.some((c) => /Rindsgulasch/.test(c.title) && c.price === 14.8 && c.exclusionReason === 'positioned-product-price-conflict'));
    for (const o of [meat[0], milk[0]]) {
      assert.equal(o.quality.comparisonSafe, true);
      assert.equal(o.retailerKey, retailer);
      assert.equal(o.sourceId, source._id);
      assert.equal(o.rawFacts.page, 20);
      assert.equal(o.parserVersion, PARSER_VERSION);
      assert.equal(o.imageUrl, '');
      assert.equal(o.supportingSources.length, 1);
    }
  });
}

test('missing meat quantity cannot borrow the neighbouring milk quantity', () => {
  const input = { ...page, positionedItems: page.positionedItems.filter((i) => i.str !== 'per Kilo'), text: page.text.replaceAll('per Kilo', '') };
  const { offers } = parse(input);
  assert.equal(offers.some((o) => /Rindsgulasch/.test(o.title)), false);
  assert.equal(offers.find((o) => /H-Milch/.test(o.title)).normalizedUnitPrice.unit, 'l');
});

test('missing positioned price cannot be rescued by the next card price in PDF text order', () => {
  const input = { ...page, positionedItems: page.positionedItems.filter((i) => !(i.str === '12' && i.height === 54)) };
  assert.equal(parse(input).offers.some((o) => /Rindsgulasch/.test(o.title)), false);
});

test('products with prices on the same baseline keep separate identities and real unit prices', () => {
  const { offers } = parse();
  const tomato = offers.find((o) => /Rispen/.test(o.title));
  const meat = offers.find((o) => /Rindsgulasch/.test(o.title));
  const ham = offers.find((o) => /Burgunderschinken/.test(o.title));
  assert.equal(tomato.priceCurrent.amount, 2.49);
  assert.equal(tomato.quantityText, '450 g');
  assert.equal(tomato.normalizedUnitPrice.amount, 5.53);
  assert.equal(meat.priceCurrent.amount, 12.99);
  assert.equal(ham.priceCurrent.amount, 1.69);
  assert.equal(ham.quantityText, '100 g');
  assert.equal(ham.normalizedUnitPrice.amount, 16.9);
});

test('normalization rejects ambiguous quantities and does not emit a comparison-safe price without quantity', () => {
  const { candidates, offers } = parse();
  assert.ok(candidates.some((c) => /Jacobs/.test(c.title) && c.exclusionReason === 'quantity-missing'));
  assert.equal(offers.some((o) => /Jacobs/.test(o.title)), false);
  assert.ok(offers.every((o) => !o.quality.comparisonSafe || Boolean(o.quantityText && o.normalizedUnitPrice.comparable)));
});

test('joining split text lines preserves original euro/cent cluster order across neighbouring cards', () => {
  const { offers } = parse(require('./fixtures/billa/kw38-2026-plus-page16.json'));
  const pizza = offers.filter((offer) => offer.title === 'Iglo Holy Slice Pizza');
  assert.equal(pizza.length, 1);
  assert.equal(pizza[0].priceCurrent.amount, 3.74);
  assert.equal(pizza[0].quantityText, '495 g');
  assert.equal(pizza[0].normalizedUnitPrice.amount, 7.56);
  assert.equal(pizza[0].conditionsText, 'ab 2 Packungen');
  assert.equal(offers.some((offer) => offer.priceCurrent.amount === 99.74), false);
});
