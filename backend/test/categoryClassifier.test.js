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

test('classifies sauce compounds as food sauce products', () => {
  for (const title of [
    'Taste of Asia Sojasauce 250 ml',
    'Kikkoman Sojasauce 150 ml',
    'Oro di Parma Pizzasauce Oregano',
  ]) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, 'Lebensmittel', title);
    assert.equal(decision.secondaryCategory, 'Saucen, Oele & Gewuerze', title);
  }
});

test('keeps dishwasher and detergent products ahead of scent or flavor side tokens', () => {
  const somat = determineCategoryDecision({
    title: 'Somat All in 1 Extra Geschirrspuel-Tabs Zitrone & Limette 55 Stueck',
  });
  const lemons = determineCategoryDecision({ title: 'Zitronen frisch 500 g' });

  assert.equal(somat.primaryCategory, 'Haushalt');
  assert.equal(somat.secondaryCategory, 'Waschmittel & Reiniger');
  assert.equal(lemons.primaryCategory, 'Lebensmittel');
  assert.equal(lemons.secondaryCategory, 'Obst & Gemuese');
});

test('does not use alkoholfrei alone as a beer category trigger', () => {
  const plain = determineCategoryDecision({ title: 'Aktiv Tonikum alkoholfrei' });
  const hairCare = determineCategoryDecision({
    title: 'Aktiv Tonikum alkoholfrei',
    sourceCategory: 'Haarpflege',
    contextText: 'BIPA Haarpflege',
  });
  const goesser = determineCategoryDecision({ title: 'Goesser alkoholfrei Bier 0,5 l' });
  const ottakringer = determineCategoryDecision({ title: 'Ottakringer alkoholfrei 0,5 l' });

  assert.notEqual(plain.secondaryCategory, 'Bier');
  assert.equal(hairCare.primaryCategory, 'Drogerie / Hygiene');
  assert.equal(hairCare.secondaryCategory, 'Haarpflege');
  assert.equal(goesser.primaryCategory, 'Getraenke');
  assert.equal(goesser.secondaryCategory, 'Bier');
  assert.equal(ottakringer.primaryCategory, 'Getraenke');
  assert.equal(ottakringer.secondaryCategory, 'Bier');
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
  const bodyButterPlain = determineCategoryDecision({ title: 'Body Butter Shea 250 ml' });
  const lipButter = determineCategoryDecision({ title: 'Lippenbalsam Butter 4 g' });
  const croissant = determineCategoryDecision({ title: 'Butter Croissant 1 Stueck' });
  const reiswaffeln = determineCategoryDecision({ title: 'Bio Reiswaffeln Natur 30 g' });
  const sommerbutter = determineCategoryDecision({ title: 'Schaerdinger Sommerbutter 250 g' });

  assert.equal(bodyButter.primaryCategory, 'Drogerie / Hygiene');
  assert.equal(bodyButter.secondaryCategory, 'Koerperpflege');
  assert.notEqual(bodyButterPlain.secondaryCategory, 'Milchprodukte');
  assert.notEqual(lipButter.secondaryCategory, 'Milchprodukte');
  assert.equal(croissant.secondaryCategory, 'Brot & Gebaeck');
  assert.equal(reiswaffeln.secondaryCategory, 'Suesswaren & Knabbereien');
  assert.equal(sommerbutter.primaryCategory, 'Lebensmittel');
  assert.equal(sommerbutter.secondaryCategory, 'Milchprodukte');
});

test('classifies Teebutter as dairy butter instead of coffee and tea', () => {
  for (const title of [
    '\u00d6sterreichische Teebutter SPAR',
    'Teebutter',
  ]) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, 'Lebensmittel', title);
    assert.equal(decision.secondaryCategory, 'Milchprodukte', title);
    assert.notEqual(decision.primaryCategory, 'Getraenke', title);
    assert.notEqual(decision.secondaryCategory, 'Kaffee & Tee', title);
  }
});

test('keeps real tea and coffee products in coffee and tea category', () => {
  for (const title of [
    'Eistee',
    'Schwarztee',
    'Kr\u00e4utertee',
    'Teebeutel',
    'Kaffee',
    'Espresso',
    'Cappuccino',
  ]) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, 'Getraenke', title);
    assert.equal(decision.secondaryCategory, 'Kaffee & Tee', title);
  }
});

test('classifies perfume and fragrance offers as drogerie cosmetics, not wine', () => {
  const cases = [
    ['Hugo Boss Deep Red Eau de Parfum 50ml'],
    ['Hugo Boss Femme Eau de Parfum 30ml'],
    ['Hugo Boss Ma Vie Pour Femme Eau de Parfum 30ml'],
    ['Versace Bright Crystal Eau de Toilette 30ml'],
    ['Calvin Klein One Eau de Toilette 100ml'],
    ['Joop Le Bain Eau de Parfum 75ml'],
    ['Paco Rabanne 1 Million Eau de Toilette 100 ml'],
    ['Davidoff Cool Water Man Eau de Toilette 75 ml'],
    ['Joop! Homme Eau de Toilette 75 ml'],
    ['Duftset Geschenkset fuer Herren'],
    ['Bottled Geschenkset', 'Hugo Boss BIPA Parfum Herrenduft'],
    ['Phantom Geschenkset', 'Paco Rabanne BIPA Parfum Herrenduft'],
    ['Devotion Pour Homme Geschenkset'],
  ];

  for (const [title, contextText = ''] of cases) {
    const decision = determineCategoryDecision({ title, contextText });

    assert.equal(decision.primaryCategory, 'Drogerie / Hygiene', title);
    assert.equal(decision.secondaryCategory, 'Kosmetik & Make-up', title);
  }
});

test('does not classify generic non-fragrance gift sets as cosmetics', () => {
  const cases = [
    'Bottled Geschenkset',
    'Phantom Geschenkset',
    'Wein Geschenkset',
    'Sekt Geschenkset',
    'Schokolade Geschenkset',
    'Party Geschenkset',
  ];

  for (const title of cases) {
    const decision = determineCategoryDecision({ title });

    assert.notEqual(decision.secondaryCategory, 'Kosmetik & Make-up', title);
  }
});

test('classifies dental, sunscreen and wc cleaning tracer products into safe non-food categories', () => {
  const cases = [
    ['Oral-B IO Series 10 elektrische Zahnbuerste', 'Drogerie / Hygiene', 'Mund- & Zahnpflege'],
    ['Oral-B Pro Sensitive Clean Aufsteckbuersten 4 Stueck', 'Drogerie / Hygiene', 'Mund- & Zahnpflege'],
    ['Sensodyne Proschmelz taegliche Zahnpasta 75 ml', 'Drogerie / Hygiene', 'Mund- & Zahnpflege'],
    ['BI CARE SUN Sonnenmilch Ultra Sensitive LSF 50+', 'Drogerie / Hygiene', 'Koerperpflege'],
    ['SPF 50+ Sun Spray', 'Drogerie / Hygiene', 'Koerperpflege'],
    ['Blue Star WC-Reiniger Extra Power Gel 700 ml', 'Haushalt', 'Waschmittel & Reiniger'],
    ['Blue Star Kraft Aktiv WC-Steine Morgen Frische', 'Haushalt', 'Waschmittel & Reiniger'],
    ['Blue Star Spuelkastenwuerfel 4 x 50 g', 'Haushalt', 'Waschmittel & Reiniger'],
  ];

  for (const [title, primaryCategory, secondaryCategory] of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, primaryCategory, title);
    assert.equal(decision.secondaryCategory, secondaryCategory, title);
  }
});

test('classifies cat food brands as pet food instead of sauce or groceries', () => {
  const cases = [
    'Felix Katzenfutter',
    'Felix Nassfutter',
    'Felix Katzennahrung',
    'Felix Katzenfutter-Beutel div. Sorten 85 g',
    'Purina Felix',
    'Purina Felix Nassfutter',
    'Whiskas Katzen-Trockenfutter 950 g',
    'Gourmet GOLD Katzenfutter-Dose 85 g',
    'Purina One Katzenfutter-Beutel 4 Stueck',
    'Sheba Katzennahrung',
  ];

  for (const title of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, 'Tierbedarf', title);
    assert.equal(decision.secondaryCategory, 'Katzenfutter', title);
  }
});

test('keeps Felix food products out of pet food despite misleading source category context', () => {
  for (const input of [
    { title: 'Felix Felix Linsen mit Speck' },
    { title: 'Felix Felix Chili Con Carne' },
    { title: 'Felix Felix Erdaepfelgulasch' },
    {
      title: 'Felix Felix Linsen mit Speck',
      sourceCategory: 'Tierbedarf Katzenfutter',
      contextText: 'Tierbedarf Katzenfutter',
    },
  ]) {
    const decision = determineCategoryDecision(input);

    assert.equal(decision.primaryCategory, 'Lebensmittel', input.title);
    assert.equal(decision.secondaryCategory, 'Pasta, Reis & Konserven', input.title);
    assert.notEqual(decision.primaryCategory, 'Tierbedarf', input.title);
    assert.notEqual(decision.secondaryCategory, 'Katzenfutter', input.title);
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
