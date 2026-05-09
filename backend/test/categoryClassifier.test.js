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

test('classifies coffee flyer brands and capsule labels as Kaffee & Tee', () => {
  const cases = [
    'REGIO Gold 500 g',
    'Tassimo Kaffeekapseln 16 Stueck',
    'Nescafe Classic Loeskaffee 200 g',
    'Cafe Royal Kapseln',
    'Meinl Praesident gemahlen 500 g',
    'Dallmayr Prodomo ganze Bohne 500 g',
    "L'OR Kapsel Lungo Elegante",
  ];

  for (const title of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, 'Getraenke', title);
    assert.equal(decision.secondaryCategory, 'Kaffee & Tee', title);
  }
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

test('keeps frozen vegetable offers out of drogerie and body care', () => {
  const decision = determineCategoryDecision({
    title: 'iglo Roestgemuese, Buttergemuese, Gemuese-Reindl oder Gemuese a la Creme verschiedene Sorten',
  });

  assert.equal(decision.primaryCategory, 'Lebensmittel');
  assert.equal(decision.secondaryCategory, 'Tiefkuehl- & Fertigprodukte');
  assert.notEqual(decision.primaryCategory, 'Drogerie / Hygiene');
  assert.notEqual(decision.secondaryCategory, 'Koerperpflege');
});

test('classifies clear water and lemonade offers as drinks', () => {
  const cases = [
    ['Schartner Bombe versch. Sorten 0.33 Liter 1 Dose', 'Softdrinks & Energy'],
    ['Gasteiner Infinity Water versch. Sorten 0.33 Liter 1 Dose', 'Wasser'],
  ];

  for (const [title, secondaryCategory] of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, 'Getraenke', title);
    assert.equal(decision.secondaryCategory, secondaryCategory, title);
    assert.notEqual(decision.primaryCategory, 'Haushalt', title);
  }
});

test('classifies spumante and wine terms as drinks instead of garden', () => {
  const decision = determineCategoryDecision({
    title: 'La Gioiosa Spumante Prosecco 0.75 Liter',
  });

  assert.equal(decision.primaryCategory, 'Getraenke');
  assert.equal(decision.secondaryCategory, 'Wein & Sekt');
  assert.notEqual(decision.primaryCategory, 'Garten / Pflanzen');
});

test('classifies Barilla teigwaren as pasta instead of generic or unknown', () => {
  const decision = determineCategoryDecision({
    title: 'Barilla Italienische Teigwaren versch. Sorten 500 Gramm 1 Packung',
  });

  assert.equal(decision.primaryCategory, 'Lebensmittel');
  assert.equal(decision.secondaryCategory, 'Pasta, Reis & Konserven');
  assert.notEqual(decision.secondaryCategory, 'Sonstiges');
});

test('classifies fish sticks and oven fish as fish even when variants mention cheese', () => {
  const cases = [
    'iglo Fischstaebchen diverse Sorten, Goldschatz Kaese oder Ofenbackfisch MSC',
    'iglo Ofenbackfisch 480 Gramm 1 Packung',
  ];

  for (const title of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, 'Lebensmittel', title);
    assert.equal(decision.secondaryCategory, 'Fleisch, Wurst & Fisch', title);
    assert.notEqual(decision.secondaryCategory, 'Kaese', title);
  }
});

test('adds conservative food mappings for clear pantry examples', () => {
  const cases = [
    ['Olivenoel extra nativ 750 ml', 'Saucen, Oele & Gewuerze'],
    ['Gruene Oliven ohne Stein 300 g', 'Saucen, Oele & Gewuerze'],
    ['Artischocken in Oel 280 g', 'Saucen, Oele & Gewuerze'],
    ['Asia Cup Nudelsnack Huhn 65 g', 'Saucen, Oele & Gewuerze'],
  ];

  for (const [title, secondaryCategory] of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, 'Lebensmittel', title);
    assert.equal(decision.secondaryCategory, secondaryCategory, title);
    assert.notEqual(decision.secondaryCategory, 'Sonstiges', title);
  }
});

test('classifies clear HOFER and discounter household, hygiene, baby, pet, and food examples', () => {
  const cases = [
    ['Tandil Vollwaschmittel 2,025 kg', 'Haushalt', 'Waschmittel & Reiniger'],
    ['Alio Geschirrspueltabs Classic 60 Stueck', 'Haushalt', 'Waschmittel & Reiniger'],
    ['Alio Maschinenreiniger 250 ml', 'Haushalt', 'Waschmittel & Reiniger'],
    ['Ombia Shampoo Sensitive 300 ml', 'Drogerie / Hygiene', 'Haarpflege'],
    ['Ombia Duschgel Milch & Honig 300 ml', 'Drogerie / Hygiene', 'Koerperpflege'],
    ['Mamia Windeln Groesse 4', 'Baby / Kinder', 'Kinderpflege'],
    ['Mamia Feuchttuecher Sensitiv 4 x 80 Stueck', 'Baby / Kinder', 'Kinderpflege'],
    ['Romeo Hundefutter mit Rind 1,24 kg', 'Tierbedarf', 'Hundefutter'],
    ['Romeo Katzenfutter Multipack 12 x 100 g', 'Tierbedarf', 'Katzenfutter'],
    ['Choceur Schokolade ganze Nuss 200 g', 'Lebensmittel', 'Suesswaren & Knabbereien'],
    ['Cucina Nobile Pasta Penne 500 g', 'Lebensmittel', 'Pasta, Reis & Konserven'],
    ['Cucina Nobile Pesto Genovese 190 g', 'Lebensmittel', 'Pasta, Reis & Konserven'],
    ['Cucina Nobile Passata 700 g', 'Lebensmittel', 'Pasta, Reis & Konserven'],
    ['BBQ Maishendl mariniert 400 g', 'Lebensmittel', 'Fleisch, Wurst & Fisch'],
    ['BBQ Grillfleisch vom Schwein 600 g', 'Lebensmittel', 'Fleisch, Wurst & Fisch'],
    ['BBQ Faschiertes gemischt 500 g', 'Lebensmittel', 'Fleisch, Wurst & Fisch'],
    ['Grandessa Eis Bourbon Vanille 1 l', 'Lebensmittel', 'Tiefkuehl- & Fertigprodukte'],
  ];

  for (const [title, primaryCategory, secondaryCategory] of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, primaryCategory, title);
    assert.equal(decision.secondaryCategory, secondaryCategory, title);
    assert.equal(decision.needsReview, false, title);
  }
});

test('does not classify HOFER private-label brand names without a clear product term', () => {
  const cases = [
    ['Gardenline Premium Set', 'Garten / Pflanzen'],
    ['Workzone Aktionsset', 'Technik / Elektronik'],
    ['Ferrex Spezial Angebot', 'Technik / Elektronik'],
    ['Mamia Vorteilspackung', 'Baby / Kinder'],
    ['Romeo Multipack', 'Tierbedarf'],
  ];

  for (const [title, forbiddenPrimaryCategory] of cases) {
    const decision = determineCategoryDecision({ title });

    assert.notEqual(decision.primaryCategory, forbiddenPrimaryCategory, title);
  }
});

test('keeps packaging words and apparel qualifiers from overpowering product terms', () => {
  const sportsDrink = determineCategoryDecision({
    title: 'Isostar Hydrate & Perform Pulver Orange 400 Gramm 1 Dose',
  });
  assert.equal(sportsDrink.primaryCategory, 'Getraenke');
  assert.equal(sportsDrink.secondaryCategory, 'Softdrinks & Energy');

  const bike = determineCategoryDecision({
    title: 'prophete Trekking E-Bike Damen 1 Stueck',
  });
  assert.equal(bike.primaryCategory, 'Freizeit / Sonstiges');
  assert.equal(bike.secondaryCategory, 'Sport & Camping');

  const packageOnly = determineCategoryDecision({
    title: 'Protein Pulver Vanille 400 Gramm 1 Dose',
  });
  assert.notEqual(packageOnly.primaryCategory, 'Haushalt');
  assert.notEqual(packageOnly.secondaryCategory, 'Aufbewahrung & Folien');
});
