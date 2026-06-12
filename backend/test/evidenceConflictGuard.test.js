const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PDF_WEB_PRICE_QUANTITY_CONFLICT_REASON,
  PUBLIC_PDF_WEB_PRICE_QUANTITY_HINT,
  detectPdfWebPriceQuantityConflict,
  applyPdfWebPriceQuantityConflictGuard,
} = require('../src/services/crawl/evidenceConflictGuard');

function webOffer(overrides = {}) {
  return {
    retailerKey: 'penny',
    retailerName: 'PENNY',
    title: 'Schopf od. Karree',
    brand: '',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Fleisch, Wurst & Fisch',
    validFrom: new Date('2026-06-10T22:00:00.000Z'),
    validTo: new Date('2026-06-17T21:59:59.999Z'),
    quantityText: '500 g Packung',
    priceCurrent: {
      amount: 3.49,
      currency: 'EUR',
    },
    normalizedUnitPrice: {
      amount: 6.98,
      unit: 'kg',
      comparable: true,
    },
    rawFacts: {
      sourceType: 'penny-official-html',
    },
    ...overrides,
  };
}

function pdfEvidence(overrides = {}) {
  return {
    title: 'Schopf od. Karree',
    description: 'ohne Knochen, geschnitten od. im Stueck, natur od. gewuerzt',
    quantityText: 'pro kg',
    price: 6.99,
    validFrom: new Date('2026-06-10T22:00:00.000Z'),
    validTo: new Date('2026-06-17T21:59:59.999Z'),
    sourceType: 'penny-official-pdf',
    ...overrides,
  };
}

test('detects PENNY Schopf od. Karree PDF pro-kg vs web 500g conflict without changing price', () => {
  const offer = webOffer();
  const detection = detectPdfWebPriceQuantityConflict({
    offer,
    pdfEvidence: pdfEvidence(),
  });

  assert.equal(detection.conflict, true);
  assert.equal(detection.reason, 'pdf-pro-kg-vs-web-fixed-quantity');
  assert.equal(detection.confidence, 'high');

  const guarded = applyPdfWebPriceQuantityConflictGuard(offer, pdfEvidence());

  assert.equal(guarded.priceCurrent.amount, 3.49);
  assert.equal(guarded.needsReview, true);
  assert.ok(guarded.reviewReasons.includes(PDF_WEB_PRICE_QUANTITY_CONFLICT_REASON));
  assert.equal(guarded.rawFacts.evidenceConflict.pdfPrice, 6.99);
  assert.equal(guarded.rawFacts.evidenceConflict.webPrice, 3.49);
  assert.match(guarded.conditionsText, new RegExp(PUBLIC_PDF_WEB_PRICE_QUANTITY_HINT));
});

test('detects further page 6/7 variable-weight pro-kg patterns when web price is fixed-weight equivalent', () => {
  const cases = [
    {
      pdf: pdfEvidence({
        title: 'Schweinefleisch fuer Reisfleisch/Gulasch',
        quantityText: 'pro kg',
        price: 7.99,
      }),
      offer: webOffer({
        title: 'Schweinefleisch fuer Reisfleisch/Gulasch',
        quantityText: '500 g Packung',
        priceCurrent: { amount: 3.99, currency: 'EUR' },
        normalizedUnitPrice: { amount: 7.98, unit: 'kg', comparable: true },
      }),
    },
    {
      pdf: pdfEvidence({
        title: 'Rindsschnitzelfleisch',
        quantityText: 'geschnitten od. im Stueck, pro kg',
        price: 15.99,
      }),
      offer: webOffer({
        title: 'Rindsschnitzelfleisch',
        quantityText: '450 g Packung',
        priceCurrent: { amount: 7.19, currency: 'EUR' },
        normalizedUnitPrice: { amount: 15.98, unit: 'kg', comparable: true },
      }),
    },
  ];

  for (const item of cases) {
    assert.equal(detectPdfWebPriceQuantityConflict({
      offer: item.offer,
      pdfEvidence: item.pdf,
    }).conflict, true, item.pdf.title);
  }
});

test('does not flag legitimate fixed-weight flyer offers', () => {
  const cases = [
    {
      pdfEvidence: pdfEvidence({
        title: 'Delikatessa Cevapcici',
        quantityText: '480 g, 1 kg=5.39',
        price: 2.59,
      }),
      offer: webOffer({
        title: 'Delikatessa Cevapcici',
        quantityText: '480 g Packung',
        priceCurrent: { amount: 2.59, currency: 'EUR' },
        normalizedUnitPrice: { amount: 5.39, unit: 'kg', comparable: true },
      }),
    },
    {
      pdfEvidence: pdfEvidence({
        title: 'Hendl-Minutenschnitzel',
        quantityText: '500 g, 1 kg=11.98',
        price: 5.99,
      }),
      offer: webOffer({
        title: 'Hendl-Minutenschnitzel',
        quantityText: '500 g Packung',
        priceCurrent: { amount: 5.99, currency: 'EUR' },
        normalizedUnitPrice: { amount: 11.98, unit: 'kg', comparable: true },
      }),
    },
  ];

  for (const item of cases) {
    assert.equal(detectPdfWebPriceQuantityConflict(item).conflict, false, item.pdfEvidence.title);
  }
});

test('does not flag legitimate pro-kg web offers or non-meat fixed-weight offers', () => {
  const proKgOffer = webOffer({
    title: 'Delikatessa XXL Karree od. XXL Schopf',
    quantityText: '1 kg',
    priceCurrent: { amount: 5.99, currency: 'EUR' },
    normalizedUnitPrice: { amount: 5.99, unit: 'kg', comparable: true },
  });
  const fruitOffer = webOffer({
    title: 'Kirschen',
    categorySecondary: 'Obst & Gemuese',
    quantityText: '500 g Tasse',
    priceCurrent: { amount: 2.99, currency: 'EUR' },
    normalizedUnitPrice: { amount: 5.98, unit: 'kg', comparable: true },
  });

  assert.equal(detectPdfWebPriceQuantityConflict({
    offer: proKgOffer,
    pdfEvidence: pdfEvidence({
      title: 'Delikatessa XXL Karree od. XXL Schopf',
      quantityText: 'im Stueck, pro kg',
      price: 5.99,
    }),
  }).conflict, false);

  assert.equal(detectPdfWebPriceQuantityConflict({
    offer: fruitOffer,
    pdfEvidence: pdfEvidence({
      title: 'Kirschen',
      quantityText: '500 g Tasse',
      price: 2.99,
    }),
  }).conflict, false);
});

test('does not flag when PDF evidence is missing', () => {
  const offer = webOffer();

  assert.equal(detectPdfWebPriceQuantityConflict({ offer }).conflict, false);
  assert.equal(applyPdfWebPriceQuantityConflictGuard(offer), offer);
});
