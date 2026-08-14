const assert = require('node:assert/strict');
const test = require('node:test');
const {
  cleanHoferTitle,
  getHoferPublicPresentation,
  hasHoferPublicQuantityEvidence,
  isSafeHoferQuantityText,
} = require('../src/services/offers/hoferPublicPresentation');

test('HOFER presentation removes PDF bullet fragments without inventing a title', () => {
  assert.equal(cleanHoferTitle('\u2022 ISOLIERBECHER \u2022 Kapazität: 1.120 ml'), 'ISOLIERBECHER');
  assert.equal(cleanHoferTitle('• max. Belastbarkeit (Tischplatte) 20 kg'), '');
  assert.equal(cleanHoferTitle('HOFER | 30HOFER | 30Alle Angebote sind online buchbar von 0 Uhr'), '');
});

test('HOFER technical specifications are not comparison quantity evidence', () => {
  assert.equal(isSafeHoferQuantityText('20 kg', 'max. Belastbarkeit (Tischplatte)'), false);
  assert.equal(isSafeHoferQuantityText('500 g Packung', 'Kaffee'), true);
});

test('HOFER quantity evidence is fail-closed unless explicitly marked by the parser', () => {
  const offer = {
    retailerKey: 'hofer',
    title: 'Kaffee',
    quantityText: '500 g Packung',
    rawFacts: {},
  };

  assert.equal(hasHoferPublicQuantityEvidence(offer), false);
  assert.equal(hasHoferPublicQuantityEvidence({
    ...offer,
    rawFacts: { hoferQuantityEvidence: 'explicit-product-quantity' },
  }), true);
});

test('HOFER public presentation keeps a neutral category when no reliable category exists', () => {
  const presentation = getHoferPublicPresentation({
    retailerKey: 'hofer',
    title: 'Unbekanntes HOFER Angebot',
    quantityText: '20 kg',
    rawFacts: {},
  });

  assert.equal(presentation.displayCategory, 'HOFER Angebot');
  assert.equal(presentation.quantityText, '');
  assert.equal(presentation.comparable, false);
});

test('HOFER kitchen product title is not misclassified as pet accessory', () => {
  assert.equal(getHoferPublicPresentation({
    retailerKey: 'hofer',
    title: 'kleine Spring-, Gugelhupf- oder Kastenform, Pizzablech oder Kasserole',
  }).displayCategory, 'Kuechenhelfer');
});
