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

test('classifies perfume and fragrance offers as drogerie cosmetics, not wine', () => {
  const cases = [
    'Hugo Boss Deep Red Eau de Parfum 50ml',
    'Hugo Boss Femme Eau de Parfum 30ml',
    'Hugo Boss Ma Vie Pour Femme Eau de Parfum 30ml',
    'Versace Bright Crystal Eau de Toilette 30ml',
    'Calvin Klein One Eau de Toilette 100ml',
    'Joop Le Bain Eau de Parfum 75ml',
  ];

  for (const title of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, 'Drogerie / Hygiene', title);
    assert.equal(decision.secondaryCategory, 'Kosmetik & Make-up', title);
  }
});

test('classifies cat food brands as pet food instead of sauce or groceries', () => {
  const cases = [
    'Felix Katzenfutter-Beutel div. Sorten 85 g',
    'Whiskas Katzen-Trockenfutter 950 g',
    'Gourmet GOLD Katzenfutter-Dose 85 g',
    'Purina One Katzenfutter-Beutel 4 Stueck',
  ];

  for (const title of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, 'Tierbedarf', title);
    assert.equal(decision.secondaryCategory, 'Katzenfutter', title);
  }
});

test('classifies cat litter separately from cat food', () => {
  const decision = determineCategoryDecision({
    title: 'ZooRoyal Ultra Klumpstreu Pinienduft 5 Liter',
  });

  assert.equal(decision.primaryCategory, 'Tierbedarf');
  assert.equal(decision.secondaryCategory, 'Katzenstreu & Pflege');
});

test('classifies official resource-matrix non-food categories without polluting food categories', () => {
  const cases = [
    ['Frottee Handtuch 2er Pack', 'Haushalt', 'Frotteewaren'],
    ['Wertkarten Router LTE', 'Technik / Elektronik', 'Handys & Router'],
    ['Gaming Headset mit Controller', 'Technik / Elektronik', 'Gaming & Technik'],
    ['Party Geschenkpapier Set', 'Freizeit / Sonstiges', 'Party & Schenken'],
    ['ZooRoyal Hundenapf rutschfest', 'Tierbedarf', 'Tierzubehoer'],
    ['Pedigree Hundefutter 2 kg', 'Tierbedarf', 'Hundefutter'],
  ];

  for (const [title, primaryCategory, secondaryCategory] of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, primaryCategory, title);
    assert.equal(decision.secondaryCategory, secondaryCategory, title);
  }
});

test('classifies dog food brands as pet food and does not let generic snacks become pet food', () => {
  for (const title of [
    'Pedigree Hundefutter 2 kg',
    'Pedigree Schmackos Hunde Snack',
    'Pedigree Biscrok Hundekeks',
  ]) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, 'Tierbedarf', title);
    assert.equal(decision.secondaryCategory, 'Hundefutter', title);
  }

  const babyFood = determineCategoryDecision({ title: 'Fruchtbar Bio Herznudeln Snack 125 g' });

  assert.notEqual(babyFood.primaryCategory, 'Tierbedarf');
  assert.notEqual(babyFood.secondaryCategory, 'Tiernahrung');
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
