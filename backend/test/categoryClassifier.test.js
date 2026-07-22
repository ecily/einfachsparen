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
    ['Burgit Anti Huehneraugen Stift', 'Drogerie / Hygiene', 'Gesundheit & Nahrungsergaenzung'],
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
    ['Swiffer Duster Staubmagnet Nachfuellset', 'Haushalt', 'Waschmittel & Reiniger'],
    ['Silan Aromatherapie Faszinierende Fragnipani', 'Haushalt', 'Waschmittel & Reiniger'],
    ['Blink Farb- und Schmutzfangtuecher XL-Pack', 'Haushalt', 'Waschmittel & Reiniger'],
    ['Persil Pulver Universal 90 WG', 'Haushalt', 'Waschmittel & Reiniger'],
    ['Dr. Beckmann Farb- und Schmutzfangtuecher', 'Haushalt', 'Waschmittel & Reiniger'],
    ['Profissimo Schmutzradierer', 'Haushalt', 'Waschmittel & Reiniger'],
    ['SYOSS Permanente Coloration', 'Drogerie / Hygiene', 'Haarpflege'],
    ['essie GEL COUTURE Topcoat', 'Drogerie / Hygiene', 'Kosmetik & Make-up'],
    ['FA Men 3in1 Koerper', 'Drogerie / Hygiene', 'Koerperpflege'],
    ['Bali Curls Curl Volume Foam', 'Drogerie / Hygiene', 'Haarpflege'],
    ['Milupa Milumil 3 Folgemilch', 'Baby / Kinder', 'Babybedarf'],
    ['hitschies Saure Drachenzungen blau', 'Lebensmittel', 'Suesswaren & Knabbereien'],
    ['EBERHARD FABER EFAlino Schulranzen-Set Race car', 'Buero / Schule', 'Schule & Lernen'],
    ['Holzhacker Franzbranntwein Arnika Menthol', 'Drogerie / Hygiene', 'Gesundheit & Nahrungsergaenzung'],
    ['Ja! Natuerlich Joghurt 500 g', 'Lebensmittel', 'Milchprodukte'],
    ['Goesser Bier 0,5 l', 'Getraenke', 'Bier'],
    ['Iglo Buttergemuese 400 g', 'Lebensmittel', 'Tiefkuehl- & Fertigprodukte'],
    ['Schartner Bombe Orange 1,5 l', 'Getraenke', 'Softdrinks & Energy'],
    ['Gasteiner Mineralwasser prickelnd', 'Getraenke', 'Wasser'],
    ['More ZERUP Lemon Iced Tea Getraenkesirup', 'Getraenke', 'Saefte & Sirupe'],
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

test('classifies espresso cosmetic color names as cosmetics instead of coffee', () => {
  const decision = determineCategoryDecision({
    title: 'Gel Eyeliner Cozy & Chic 020 Espresso, 3 g',
  });

  assert.equal(decision.primaryCategory, 'Drogerie / Hygiene');
  assert.equal(decision.secondaryCategory, 'Kosmetik & Make-up');
});

test('keeps beta feedback category false positives in their product categories', () => {
  const cases = [
    ['Kinder Kinder Pingui', 'Lebensmittel', 'Suesswaren & Knabbereien'],
    ['Rio Mare gegrillte Makrelenfilets Natur', 'Lebensmittel', 'Fleisch, Wurst & Fisch'],
    ['Delamaris Makrelensalat', 'Lebensmittel', 'Fleisch, Wurst & Fisch'],
    ['iglo Holy Slice Pizza div. Sorten', 'Lebensmittel', 'Tiefkuehl- & Fertigprodukte'],
    ['Wojnars Liptauer mild od. scharf', 'Lebensmittel', 'Kaese'],
    ['Parmigiano Reggiano', 'Lebensmittel', 'Kaese'],
    ['Mäidä Jufka Teigblätter', 'Lebensmittel', 'Backen & Grundnahrungsmittel'],
    ['Kardinalschnitte', 'Lebensmittel', 'Suesswaren & Knabbereien'],
    ['Hochriegl Baby div. Sorten', 'Getraenke', 'Wein & Sekt'],
    ['PARKSIDE Maler-Starter-Set', 'Technik / Elektronik', 'Werkzeug & Akkus'],
    ['Grilltaler', 'Lebensmittel', 'Kaese'],
    ['WIESENTALER Frische Karree-Koteletts mariniert Lidl 350 Gramm', 'Lebensmittel', 'Fleisch, Wurst & Fisch'],
    ['Pilsner Urquell 0,5 Liter', 'Getraenke', 'Bier'],
    ['Goesser Naturradler alkoholfrei 0,33-Liter-Flasche', 'Getraenke', 'Bier'],
    ['Stiegl Goldbraeu 20er-Kiste', 'Getraenke', 'Bier'],
    ['Puntigamer Maerzen 24er-Tray', 'Getraenke', 'Bier'],
    ['Nocco BCAA Drink 0,33-Liter-Dose', 'Getraenke', 'Softdrinks & Energy'],
    ['S-BUDGET Energy Drink 0,25 Liter 24er-Tray', 'Getraenke', 'Softdrinks & Energy'],
    ['Lorenz Nic Nacs versch. Sorten 110 g', 'Lebensmittel', 'Suesswaren & Knabbereien'],
    ['Aperol 0,7 Liter', 'Getraenke', 'Spirituosen'],
  ];

  for (const [title, primaryCategory, secondaryCategory] of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, primaryCategory, title);
    assert.equal(decision.secondaryCategory, secondaryCategory, title);
  }
});

test('classifies weighted Lidl Griller offers as food without reclassifying grill devices', () => {
  const weightedFood = determineCategoryDecision({
    title: 'Griller',
    contextText: 'Je 250 g (1 kg = 9.68)',
  });
  const grillDevice = determineCategoryDecision({
    title: 'Kontaktgrill',
    contextText: 'Je Stueck',
  });

  assert.equal(weightedFood.primaryCategory, 'Lebensmittel');
  assert.equal(weightedFood.secondaryCategory, 'Fleisch, Wurst & Fisch');
  assert.equal(grillDevice.primaryCategory, 'Technik / Elektronik');
  assert.equal(grillDevice.secondaryCategory, 'Kuechengeraete');
});

test('keeps Lidl Parkside clothing and tool feedback anchors in narrow categories', () => {
  const cases = [
    ['Herren Arbeitshose', 'Kleidung / Mode', 'Herrenbekleidung'],
    ['Herren Arbeitslatzhose', 'Kleidung / Mode', 'Herrenbekleidung'],
    ['Herren Stretch Arbeitshose', 'Kleidung / Mode', 'Herrenbekleidung'],
    ['CRIVIT Herren Laufshorts', 'Kleidung / Mode', 'Herrenbekleidung'],
    ['Schlagnuss-Satz, 8-teilig oder 21-teilig', 'Technik / Elektronik', 'Werkzeug & Akkus'],
    ['Akku-Ausbesserungspolierer, 12 V', 'Technik / Elektronik', 'Werkzeug & Akkus'],
    ['W5 Waeschekorb/-wanne', 'Haushalt', 'Aufbewahrung & Folien'],
    ['Bio Limetten', 'Lebensmittel', 'Obst & Gemuese'],
  ];

  for (const [title, primaryCategory, secondaryCategory] of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, primaryCategory, title);
    assert.equal(decision.secondaryCategory, secondaryCategory, title);
  }
});

test('keeps HOFER and Lidl feedback food anchors out of household and electronics categories', () => {
  const cases = [
    ["PIZZ'AH Picco Belli, Flammkuchen", 'Lebensmittel', 'Tiefkuehl- & Fertigprodukte'],
    ['Potato Wedges, Mediterran', 'Lebensmittel', 'Tiefkuehl- & Fertigprodukte'],
    ['Potato Wedges, Classic', 'Lebensmittel', 'Tiefkuehl- & Fertigprodukte'],
    ['BACKBOX Laugenwuchtel', 'Lebensmittel', 'Brot & Gebaeck'],
    ['BACKBOX Chili Cheese Hot Dog', 'Lebensmittel', 'Brot & Gebaeck'],
    ['DR. OETKER Ristorante 2er, 710 g/640 g', 'Lebensmittel', 'Tiefkuehl- & Fertigprodukte'],
    ['ZURUECK ZUM URSPRUNG Grill-/Bratkaese nach Halloumi Art', 'Lebensmittel', 'Kaese'],
    ['BBQ Marinierter Grillkaese, BBQ', 'Lebensmittel', 'Kaese'],
    ['CHOCEUR Choco Changer, Vollmilch Nuss', 'Lebensmittel', 'Suesswaren & Knabbereien'],
    ['BIO Organic Fairtrade Schoko, Milch', 'Lebensmittel', 'Suesswaren & Knabbereien'],
    ['CHOCEUR Peanut Cluster, Milch', 'Lebensmittel', 'Suesswaren & Knabbereien'],
    ['MOSER ROTH Delice Pralinen, Vollmilch', 'Lebensmittel', 'Suesswaren & Knabbereien'],
    ['Marillen', 'Lebensmittel', 'Obst & Gemuese'],
    ['Butterkaese in Scheiben', 'Lebensmittel', 'Kaese'],
  ];

  for (const [title, primaryCategory, secondaryCategory] of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, primaryCategory, title);
    assert.equal(decision.secondaryCategory, secondaryCategory, title);
    assert.notEqual(decision.primaryCategory, 'Haushalt', title);
    assert.notEqual(decision.primaryCategory, 'Technik / Elektronik', title);
  }
});

test('does not overcorrect real household and kitchen devices to food', () => {
  const cases = [
    ['Kuechenmesser Set', 'Haushalt', 'Kuechenhelfer'],
    ['Frischhaltefolie 3 Rollen', 'Haushalt', 'Aufbewahrung & Folien'],
    ['Aufbewahrungsbox Kueche', 'Haushalt', 'Kuechenhelfer'],
    ['Kontaktgrill', 'Technik / Elektronik', 'Kuechengeraete'],
    ['MEDION 4 in 1 Mikrowelle MD12041, schwarz:HD', 'Technik / Elektronik', 'Kuechengeraete'],
  ];

  for (const [title, primaryCategory, secondaryCategory] of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, primaryCategory, title);
    assert.equal(decision.secondaryCategory, secondaryCategory, title);
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

test('keeps Sheba and Vitakraft pet-food anchors ahead of human-food terms', () => {
  const catFoodCases = [
    { title: 'Sheba Fresh&Fine in Sauce Lachs & Thunfisch' },
    { title: 'Sheba Selection in Sauce Herzhafte Komposition 4-Pack' },
    { title: 'Sheba Selection in Sauce Gefluegel Variation 4-Pack' },
    { title: 'Vitakraft Poesie mit Huhn und Gartengemuese in Sauce' },
    { title: 'Vitakraft Poesie Sauce mit Seelachs und Tomate' },
    { title: 'Poesie mit Huhn und Gartengemuese in Sauce', contextText: 'Vitakraft' },
    { title: 'Poesie mit Huhn und Gartengemuese in Sauce' },
    { title: 'Poesie Sauce mit Seelachs und Tomate' },
  ];

  for (const input of catFoodCases) {
    const decision = determineCategoryDecision(input);

    assert.equal(decision.primaryCategory, 'Tierbedarf', input.title);
    assert.equal(decision.secondaryCategory, 'Katzenfutter', input.title);
  }

  for (const title of [
    'Vitakraft Liquid Snack mit Lachs',
    'Vitakraft Beef Stick mit Rind',
  ]) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, 'Tierbedarf', title);
    assert.equal(decision.secondaryCategory, 'Tiernahrung', title);
  }
});

test('keeps human food products with sauce fish meat and chicken terms in food categories', () => {
  const cases = [
    ['Knorr Sauce', 'Lebensmittel', 'Saucen, Oele & Gewuerze'],
    ['BILLA Bio Raeucherlachs', 'Lebensmittel', 'Fleisch, Wurst & Fisch'],
    ['Hendlfilet', 'Lebensmittel', 'Fleisch, Wurst & Fisch'],
    ['Huehnerfilet', 'Lebensmittel', 'Fleisch, Wurst & Fisch'],
    ['Iglo Fischstaebchen', 'Lebensmittel', 'Fleisch, Wurst & Fisch'],
    ['Felix Gulaschsuppe', 'Lebensmittel', 'Pasta, Reis & Konserven'],
  ];

  for (const [title, primaryCategory, secondaryCategory] of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, primaryCategory, title);
    assert.equal(decision.secondaryCategory, secondaryCategory, title);
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

test('classifies clear SPAR-family non-food flyer anchors narrowly', () => {
  const cases = [
    ['Splendid Einweghandschuhe', 'Haushalt', 'Waschmittel & Reiniger'],
    ['Splendid Feuchte Reinigungstuecher', 'Haushalt', 'Waschmittel & Reiniger'],
    ['Rowenta Akkusauger X-Force Flex 9.60', 'Technik / Elektronik', 'Werkzeug & Akkus'],
    ['Tefal Dampfglatter AeroSteam', 'Technik / Elektronik', 'Kuechengeraete'],
    ['Tefal OptiGrill', 'Technik / Elektronik', 'Kuechengeraete'],
    ['KRUPS Kaffeevollautomat my Coffee', 'Technik / Elektronik', 'Kuechengeraete'],
    ['Tefal Heissluftfritteuse Easy Fry XL Surface', 'Technik / Elektronik', 'Kuechengeraete'],
    ['Sloggi Damen Tai-, Midi- oder Maxi-Slip Serie Pure Comfort', 'Kleidung / Mode', 'Damenbekleidung'],
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

test('classifies sausage products with cheese variants as meat and sausage', () => {
  for (const title of [
    'Ich bin Oesterreich Cabanossi Classic, Kaese od. Chili',
    'Landhof Cabanossi original, Cabanossi mit Kaese oder Putencabanossi',
    'TANN Extrawurst 500 g',
    'Tirol Kantwurst oder Polnische Spezial',
    'Wiener Wuerstel 300 g',
  ]) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, 'Lebensmittel', title);
    assert.equal(decision.secondaryCategory, 'Fleisch, Wurst & Fisch', title);
  }
});

test('classifies remaining category feedback clusters with narrow product anchors', () => {
  const cases = [
    ['Face Beard 6-in-1 Multi Trimmer', 'Drogerie / Hygiene', 'Rasur'],
    ['Warmluftbuerste Shape&Smooth', 'Drogerie / Hygiene', 'Haarpflege'],
    ['Hof Cat Hof Cat Bio Fisch', 'Tierbedarf', 'Katzenfutter'],
    ['Felix Katzensnacks 180-g-200-g-Maxi Pack', 'Tierbedarf', 'Tiernahrung'],
    ['Felix Deli Moments 12 x 10-g-Maxi Pack', 'Tierbedarf', 'Tiernahrung'],
    ['Felix Felix Gefuellte Paprika', 'Lebensmittel', 'Pasta, Reis & Konserven'],
    ['BBQ Marinierter Grillkaese, BBQ', 'Lebensmittel', 'Kaese'],
    ['MILSANI Pizzakaese', 'Lebensmittel', 'Kaese'],
    ['MILSANI Schmelzkaeseecken', 'Lebensmittel', 'Kaese'],
    ['MILSANI Tilsiter', 'Lebensmittel', 'Kaese'],
    ['SAMSUNG Galaxy A26-5G', 'Technik / Elektronik', 'Handys & Router'],
    ['XIAOMI Redmi 15C, 4+128', 'Technik / Elektronik', 'Handys & Router'],
  ];

  for (const [title, primaryCategory, secondaryCategory] of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, primaryCategory, title);
    assert.equal(decision.secondaryCategory, secondaryCategory, title);
    assert.equal(decision.needsReview, false, title);
  }
});

test('keeps dm cosmetic wine-word color names out of drinks categories', () => {
  const cases = [
    'Lipgloss Mineral Wear Diamond Plumper Champagner, 5 ml',
    'CATRICE Lidschatten Art Couleurs 460 Frosted Dust',
    'Blush Liquid Hollyglazing C02 Wine Not?, 2,8 ml',
    'Puder Glitter Dream Cushion Brides & Besties C01 Champagne Showers, 3,5 g',
  ];

  for (const title of cases) {
    const decision = determineCategoryDecision({
      title,
      contextText: 'dm Kosmetik Make-up',
      sourceCategory: 'Kosmetik Make-up',
    });

    assert.equal(decision.primaryCategory, 'Drogerie / Hygiene', title);
    assert.equal(decision.secondaryCategory, 'Kosmetik & Make-up', title);
    assert.equal(decision.needsReview, false, title);
  }
});

test('keeps Felix filled paprika human food even with polluted pet context', () => {
  const decision = determineCategoryDecision({
    title: 'Felix Felix Gef\u00fcllte Paprika',
    contextText: 'Tierbedarf Katzenfutter',
    sourceCategory: 'Tierbedarf Katzenfutter',
  });

  assert.equal(decision.primaryCategory, 'Lebensmittel');
  assert.equal(decision.secondaryCategory, 'Pasta, Reis & Konserven');
  assert.equal(decision.needsReview, false);
});

test('classifies BILLA Plus uncategorized feedback anchors into narrow categories', () => {
  const cases = [
    ['Santa Maria Santa Maria Dip Tex Mex Style', 'Lebensmittel', 'Saucen, Oele & Gewuerze'],
    ['Santa Maria Santa Maria Chunky Salsa Medium', 'Lebensmittel', 'Saucen, Oele & Gewuerze'],
    ['Billa immer gut BILLA Dampfgegarte Kichererbsen', 'Lebensmittel', 'Pasta, Reis & Konserven'],
    ['Exotic Food Exotic Food Chinesische Glasnudeln', 'Lebensmittel', 'Pasta, Reis & Konserven'],
    ['CLEVER Clever Spareribs', 'Lebensmittel', 'Fleisch, Wurst & Fisch'],
    ['BILLA Immer gut BILLA Schokosauce', 'Lebensmittel', 'Suesswaren & Knabbereien'],
    ['Shaker Erdbeer Tiramisu', 'Lebensmittel', 'Suesswaren & Knabbereien'],
    ['Lillet Lillet Berry 3er', 'Getraenke', 'Wein & Sekt'],
    ['Mountain Dew Mountain Dew', 'Getraenke', 'Softdrinks & Energy'],
    ['Waldquelle Waldquelle Still', 'Getraenke', 'Wasser'],
  ];

  for (const [title, primaryCategory, secondaryCategory] of cases) {
    const decision = determineCategoryDecision({ title });

    assert.equal(decision.primaryCategory, primaryCategory, title);
    assert.equal(decision.secondaryCategory, secondaryCategory, title);
    assert.equal(decision.needsReview, false, title);
  }
});
