const assert = require('node:assert/strict');
const test = require('node:test');

const {
  determineCategoryDecision,
} = require('../src/services/crawl/categoryClassifier');

test('classifies common Austrian supermarket product names into concrete subcategories', () => {
  const cases = [
    ['Ja! Natuerlich Bio-Heumilch 1 l', 'Lebensmittel', 'Milchprodukte'],
    ['Paradeiser Rispe 500 g', 'Lebensmittel', 'Obst & Gemuese'],
    ['Faschiertes gemischt 500 g', 'Lebensmittel', 'Fleisch, Wurst & Fisch'],
    ['Freilandeier 10 Stueck', 'Lebensmittel', 'Backen & Grundnahrungsmittel'],
    ['Cappuccino Kapseln 16 Stueck', 'Getraenke', 'Kaffee & Tee'],
    ['Duschgel Sensitive 250 ml', 'Drogerie / Hygiene', 'Koerperpflege'],
    ['Allzweckreiniger Zitrone 1 l', 'Haushalt', 'Waschmittel & Reiniger'],
  ];

  for (const [title, primaryCategory, secondaryCategory] of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, primaryCategory, title);
    assert.equal(decision.secondaryCategory, secondaryCategory, title);
    assert.equal(decision.needsReview, false, title);
  }
});

test('keeps hardened launch-quality examples in the intended categories', () => {
  const cases = [
    ['Meinl Praesident Ganze Bohne oder gemahlen 500 g', 'Getraenke', 'Kaffee & Tee'],
    ['Dallmayr Prodomo ganze Bohne 500 g', 'Getraenke', 'Kaffee & Tee'],
    ['Lavazza Caffe Crema Classico 1 kg', 'Getraenke', 'Kaffee & Tee'],
    ['Riso Gallo Risottoreis 500 g', 'Lebensmittel', 'Pasta, Reis & Konserven'],
    ['Milsani Irische Butter 250 g', 'Lebensmittel', 'Milchprodukte'],
    ['Somat Excellence 4in1 Caps', 'Haushalt', 'Waschmittel & Reiniger'],
    ['Dr. Beckmann Farb- und Schmutzfangtuecher', 'Haushalt', 'Waschmittel & Reiniger'],
    ['Profissimo Schmutzradierer', 'Haushalt', 'Waschmittel & Reiniger'],
    ['Ja! Natuerlich Joghurt 500 g', 'Lebensmittel', 'Milchprodukte'],
    ['Goesser Bier 0,5 l', 'Getraenke', 'Bier'],
    ['Iglo Buttergemuese 400 g', 'Lebensmittel', 'Tiefkuehl- & Fertigprodukte'],
    ['Schartner Bombe Orange 1,5 l', 'Getraenke', 'Softdrinks & Energy'],
    ['Gasteiner Mineralwasser prickelnd', 'Getraenke', 'Wasser'],
    ['La Gioiosa Spumante', 'Getraenke', 'Wein & Sekt'],
    ['Barilla Teigwaren Spaghetti 500 g', 'Lebensmittel', 'Pasta, Reis & Konserven'],
    ['Iglo Fischstaebchen', 'Lebensmittel', 'Fleisch, Wurst & Fisch'],
    ['Ofenbackfisch Alaska Seelachs', 'Lebensmittel', 'Fleisch, Wurst & Fisch'],
  ];

  for (const [title, primaryCategory, secondaryCategory] of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, primaryCategory, title);
    assert.equal(decision.secondaryCategory, secondaryCategory, title);
  }
});

test('keeps critical side hits out of misleading butter and rice categories', () => {
  const bodyButter = determineCategoryDecision({ title: 'Kakaobutter Duschgel 250 ml' });
  const croissant = determineCategoryDecision({ title: 'Butter Croissant 1 Stueck' });
  const reiswaffeln = determineCategoryDecision({ title: 'Bio Reiswaffeln Natur 30 g' });

  assert.equal(bodyButter.primaryCategory, 'Drogerie / Hygiene');
  assert.equal(bodyButter.secondaryCategory, 'Koerperpflege');
  assert.equal(croissant.secondaryCategory, 'Brot & Gebaeck');
  assert.equal(reiswaffeln.secondaryCategory, 'Suesswaren & Knabbereien');
});

test('does not treat HOFER or discount wording alone as a product category', () => {
  const decision = determineCategoryDecision({
    title: 'HOFER Diskont Vorteilspreis',
  });

  assert.equal(decision.primaryCategory, 'Unkategorisiert');
  assert.equal(decision.secondaryCategory, '');
  assert.equal(decision.needsReview, true);
});

test('uses Sonstiges as controlled fallback when only the main category is clear', () => {
  const decision = determineCategoryDecision({
    title: 'Bio Genuss Mix Vorteilspackung',
    contextText: 'Lebensmittel',
    sourceCategory: 'Lebensmittel',
  });

  assert.equal(decision.primaryCategory, 'Lebensmittel');
  assert.equal(decision.secondaryCategory, 'Sonstiges');
  assert.equal(decision.needsReview, false);
});

test('keeps unreadable offers uncategorized instead of forcing Sonstiges', () => {
  const decision = determineCategoryDecision({
    title: 'XXL Mega Set 2026',
  });

  assert.equal(decision.primaryCategory, 'Unkategorisiert');
  assert.equal(decision.secondaryCategory, '');
  assert.equal(decision.needsReview, true);
});
