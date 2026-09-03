const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  PDF_CATEGORY_MISMATCH_REVIEW_REASON,
} = require('../src/services/crawl/pdfOfferParsing');
const {
  dateKey,
} = require('../src/services/crawl/officialFlyerValidity');
const {
  PARSER_VERSION,
  SOURCE_TYPE,
  buildRejectedCandidateSamples,
  extractSparPdfCandidates,
  extractSparViewerReference,
  normalizeSparPdfCandidatesToOffers,
  priceFromUnitPrice,
  sourceKeyForFormat,
  summarizeRejections,
} = require('../src/services/crawl/sparOfficialFlyerPdfParser');
const { enrichOfferForStorage } = require('../src/services/crawl/offerAuditEnrichment');

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'spar-official-flyer-pdf-textlayers.json'),
  'utf8'
));

function source(format = 'eurospar') {
  const retailerKey = format === 'interspar' ? 'interspar' : format === 'eurospar' ? 'eurospar' : 'spar';
  const retailerName = format === 'interspar' ? 'INTERSPAR' : format === 'eurospar' ? 'EUROSPAR' : 'SPAR';

  return {
    _id: '000000000000000000000321',
    retailerKey,
    retailerName,
    channel: 'official-flyer',
    sourceUrl: `https://flugblatt.spar.at/steiermark/${format}/260507-1-flugblatt-kw-19/getPdf.ashx`,
    sourceType: 'pdf',
    sourceRetailerName: retailerName,
    sourceRetailerFormat: format,
    appliesToRetailerFormats: [format],
    retailerFormatLabel: format.toUpperCase(),
  };
}

function activeValidityForTest() {
  const now = Date.now();
  return {
    validFrom: new Date(now - 24 * 60 * 60 * 1000),
    validTo: new Date(now + 14 * 24 * 60 * 60 * 1000),
  };
}

test('derives granular SPAR official PDF source keys', () => {
  assert.equal(sourceKeyForFormat('spar'), 'spar-official-flyer-pdf');
  assert.equal(sourceKeyForFormat('eurospar'), 'eurospar-official-flyer-pdf');
  assert.equal(sourceKeyForFormat('interspar'), 'interspar-official-flyer-pdf');
});

test('computes article price from printed unit price only when quantity is clear', () => {
  assert.equal(priceFromUnitPrice('500 g', '14,50'), 7.25);
  assert.equal(priceFromUnitPrice('500 g', '23,98'), 11.99);
  assert.equal(priceFromUnitPrice('', '14,50'), null);
});

test('extracts concrete EUROSPAR coffee offers from textlayer fixtures', () => {
  const pages = fixture.pages.filter((page) => page.sourceRetailerFormat === 'eurospar');
  const candidates = extractSparPdfCandidates({
    pages,
    sourceRetailerFormat: 'eurospar',
    validity: fixture.validity,
  }).filter((candidate) => !candidate.exclusionReason);

  const meinl = candidates.find((candidate) => candidate.brand === 'Meinl');
  const lavazza = candidates.find((candidate) => candidate.brand === 'Lavazza');

  assert.ok(candidates.length >= 2);
  assert.equal(meinl.price, 7.25);
  assert.equal(meinl.quantityText, '500 g');
  assert.equal(lavazza.price, 22.99);
  assert.equal(lavazza.referencePrice, 28.99);
  assert.equal(lavazza.quantityText, '1 kg');
});

test('extracts concrete beer offers from SPAR KW21 textlayer snippets', () => {
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: fixture.validity,
    pages: [
      {
        pageNumber: 3,
        text: [
          'Gilt auch auf ALLE Aktionspreise! -25% auf alle BIERE',
          'Hirter Privat Pils 0,5 Liter Mengenvorteil 1 Fl. 1,47 ab 6 Fl. je 1,19 0,89',
          'Schwechater Bier 0,5 Liter Im Einzelverkauf: 0,97 Mengenvorteil 20er-Kiste statt 19,40 16,80 12,60',
          'Gösser Märzen Naturradler Zitrone, alkoholfrei, 0,5 Liter Mengenvorteil 1 Ds. 1,59 ab 6 Ds. je 0,99 0,74',
          'Ottakringer Helles oder Frucade Radler 0,5 Liter 6+6 GRATIS 1 Ds. 1,39 ab 12 Ds. je 0,69 0,52',
        ].join(' '),
      },
    ],
  }).filter((candidate) => !candidate.exclusionReason);

  assert.ok(candidates.some((candidate) => candidate.title === 'Hirter Privat Pils'));
  assert.ok(candidates.some((candidate) => candidate.title === 'Schwechater Bier 20 x 0,5 Liter'));
  assert.ok(candidates.some((candidate) => candidate.title.includes('Goesser Maerzen')));
  assert.ok(candidates.every((candidate) => candidate.productKind === 'beer'));
});

test('extracts current Puntigamer 1+1 crate deal from SPAR flyer text', () => {
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: {
      validFrom: new Date('2026-05-28T12:00:00.000Z'),
      validTo: new Date('2026-06-02T12:00:00.000Z'),
    },
    pages: [
      {
        pageNumber: 1,
        text: [
          '1 Kiste 29,80',
          'ab 2 Kisten je',
          'Puntigamer',
          'Maerzen',
          '14, 90',
          '(per 0,5 Liter 0,79)',
          '1+1 GRATIS',
          '0,5 Liter',
          'Im Einzelverkauf: 1,49',
          '(Keine weiteren Rabatte/Joker moeglich.)',
        ].join('\n'),
      },
    ],
  }).filter((candidate) => !candidate.exclusionReason);

  const puntigamer = candidates.find((candidate) => candidate.title === 'Puntigamer Maerzen');

  assert.ok(puntigamer);
  assert.equal(puntigamer.price, 14.90);
  assert.equal(puntigamer.referencePrice, 29.80);
  assert.equal(puntigamer.quantityText, '20 x 0.5 l');
  assert.equal(puntigamer.comparisonSafe, true);
  assert.match(puntigamer.conditionsText, /1\+1 gratis/);
  assert.match(puntigamer.conditionsText, /ab 2 Kisten/);
});

test('extracts SPAR KW23 Puntigamer dose deal from compact flyer layout', () => {
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: activeValidityForTest(),
    pages: [
      {
        pageNumber: 8,
        text: [
          'Puntigamer das"bierige" Bier0,5 Liter Ottakringer Bier Spritz 0,33 Liter Egger Maerzen 0,5 Liter',
          'mindestens Ersparnis 2,40ab 6 Ds. Mengenvorteil 1 Ds. 1,19ab 6 Ds. je0,79(per 0,5 Liter 1,20)',
        ].join(' '),
      },
    ],
  }).filter((candidate) => !candidate.exclusionReason);

  const puntigamer = candidates.find((candidate) => candidate.brand === 'Puntigamer');

  assert.ok(puntigamer);
  assert.equal(puntigamer.title, 'Puntigamer das bierige Bier');
  assert.equal(puntigamer.price, 0.79);
  assert.equal(puntigamer.referencePrice, 1.19);
  assert.equal(puntigamer.quantityText, '0.5 l');
  assert.match(puntigamer.conditionsText, /ab 6 Dosen/);
});

test('classifies SPAR KW23 Eduscho Crema Elegante as coffee offer', () => {
  const validity = activeValidityForTest();
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity,
    pages: [
      {
        pageNumber: 14,
        text: 'Eduscho Crema Elegante ganze Bohne 1 kg NEU BEI SPAR 15,99 per Pkg. Aktion!',
      },
    ],
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: { validity, candidates },
    source: source('spar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260603-1-flugblatt-kw-23/getPdf.ashx',
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].title, 'Eduscho Crema Elegante');
  assert.equal(offers[0].categorySecondary, 'Kaffee & Tee');
  assert.equal(offers[0].categoryKey, 'kaffee-tee');
  assert.match(offers[0].searchText, /kaffee/);
});

test('extracts SPAR KW23 Milka Schokolade from compact flyer layout', () => {
  const validity = activeValidityForTest();
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity,
    pages: [
      {
        pageNumber: 15,
        text: [
          'Milka Schokolade versch. Sorten, 85-100 g Mengenvorteil',
          '1 Pkg. 6,49 ab 2 Pkg. je 5,49(per kg 27,45) mindestens Ersparnis 2,-ab 2 Pkg.',
        ].join(' '),
      },
    ],
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: { validity, candidates },
    source: source('spar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260603-1-flugblatt-kw-23/getPdf.ashx',
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].title, 'Milka Schokolade versch. Sorten');
  assert.equal(offers[0].priceCurrent.amount, 5.49);
  assert.equal(offers[0].categorySecondary, 'Suesswaren & Knabbereien');
  assert.match(offers[0].conditionsText, /ab 2 Packungen/);
});

test('extracts SPAR-family Monatssparer shared folder offers', () => {
  const validity = {
    validFrom: new Date('2026-05-12T22:00:00.000Z'),
    validTo: new Date('2026-06-10T21:59:59.999Z'),
  };
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'eurospar',
    validity,
    pages: [
      {
        pageNumber: 1,
        text: [
          'Philadelphia Frischkäse versch. Sorten, 175 g 1 Be. 2,49 ab 2 Be. je 1,99',
          'Schärdinger Formil haltbare Vollmilch 3,5% oder Leichtmilch 0,5% Fett, 1 Liter 1 Pkg. 1,69 ab 12 Pkg. je 0,99',
          'Loidl Salami Sticks Edel, Klassisch oder Salami Pralinen 80 g 1 Pkg. 2,29 ab 3 Pkg. je 1,52 2+1 GRATIS',
          'Meisterbäcker Ölz Rosinenzopf 600 g statt 4,49 3,79',
          'SPAR Müllsack mit Zugband 35, 45 oder 70 Liter 1 Pkg. 1,99 ab 3 Pkg. je 1,32 2+1 GRATIS',
        ].join('\n'),
      },
    ],
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: { validity, candidates },
    source: source('eurospar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260513-3-monatssparer-kw-20/getPdf.ashx',
  });

  const formil = offers.find((offer) => offer.title === 'Schaerdinger Formil haltbare Vollmilch oder Leichtmilch');

  assert.ok(formil);
  assert.equal(formil.priceCurrent.amount, 0.99);
  assert.equal(formil.quantityText, '1 l');
  assert.equal(formil.retailerKey, 'eurospar');
  assert.equal(formil.rawFacts.sourceRetailerFormat, 'eurospar');
  assert.equal(formil.validTo.toISOString(), '2026-06-10T21:59:59.999Z');
  assert.match(formil.conditionsText, /ab 12 Packungen/);
  assert.ok(offers.some((offer) => offer.title === 'Philadelphia Frischkaese' && /ab 2 Bechern/.test(offer.conditionsText)));
  assert.ok(offers.some((offer) => offer.title === 'Loidl Salami Sticks oder Salami Pralinen' && /2\+1 gratis/i.test(offer.conditionsText)));
  assert.ok(offers.some((offer) => offer.title === 'Meisterbaecker Oelz Rosinenzopf' && offer.quantityText === '600 g'));
  assert.ok(offers.some((offer) => offer.title === 'SPAR Muellsack mit Zugband' && /2\+1 gratis/i.test(offer.conditionsText)));
});

test('extracts current SPAR-family Muellsack threshold deal from Monatssparer text', () => {
  const validity = {
    validFrom: new Date('2026-05-12T22:00:00.000Z'),
    validTo: new Date('2026-06-10T21:59:59.999Z'),
  };
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity,
    pages: [
      {
        pageNumber: 1,
        text: 'SPAR Muellsack mit Zugband 35, 45 oder 70 Liter 1 Pkg. 2,19 ab 2 Pkg. je 1,99',
      },
    ],
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: { validity, candidates },
    source: source('spar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260513-3-monatssparer-kw-20/getPdf.ashx',
  });
  const offer = offers.find((item) => item.title === 'SPAR Muellsack mit Zugband');

  assert.ok(offer);
  assert.equal(offer.priceCurrent.amount, 1.99);
  assert.equal(offer.priceReference.amount, 2.19);
  assert.match(offer.conditionsText, /ab 2 Packungen/);
  assert.equal(offer.categoryKey, 'aufbewahrung-folien');
  assert.equal(offer.quality.comparisonSafe, false);
});

test('extracts SPAR-family Grillfolder shared offers', () => {
  const validity = activeValidityForTest();
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'eurospar',
    validity,
    pages: [
      {
        pageNumber: 1,
        text: [
          'SPAR Kraeuter- oder Knoblauchbaguette gekuehlt, 175 g Mengenvorteil 1 Pkg. 0,99 ab 2 Pkg. je 0,89',
          'Kuner Sauce versch. Sorten, 250 ml statt 2,79 1,99',
          'Domaene Krems Gruener Veltliner Niederoesterreich frisch & wuerzig 0,75 Liter 1 Fl. 8,99 ab 6 Fl. je 4,49',
        ].join('\n'),
      },
    ],
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: { validity, candidates },
    source: source('eurospar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260513-2-grillen-kw-20/getPdf.ashx',
  });

  assert.ok(offers.some((offer) => offer.title === 'SPAR Kraeuter- oder Knoblauchbaguette' && offer.priceCurrent.amount === 0.89));
  assert.ok(offers.some((offer) => offer.title === 'Kuner Sauce' && offer.categorySecondary === 'Saucen & Gewuerze'));
  assert.ok(offers.some((offer) => offer.title.includes('Domaene Krems') && offer.categorySecondary === 'Wein & Sekt'));
});

test('extracts SPAR-family Gutscheinheft shared coupon offers', () => {
  const validity = activeValidityForTest();
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'interspar',
    validity,
    pages: [
      {
        pageNumber: 17,
        text: [
          'Beim Kauf von 6 Flaschen Zweigelt lieblich Oesterreich lieblich 0,75 Liter statt 4,99 mit Gutschein je Flasche 2,49',
          'Beim Kauf von 24 Dosen Schwechater Bier 0,5 Liter statt 1,38 mit Gutschein je Dose 0,59',
          'Beim Kauf von 3 Packungen Lovely Toilettenpapier versch. Sorten, 3-lagig, 10er-Packung statt 3,89 mit Gutschein je Packung 2,99',
        ].join('\n'),
      },
    ],
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: { validity, candidates },
    source: {
      ...source('interspar'),
      crawlPolicy: { requireCouponCondition: true },
    },
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260528-3-spar-gutscheinheft-kw-22/getPdf.ashx',
  });

  assert.ok(offers.some((offer) => offer.title === 'Zweigelt lieblich Oesterreich' && /Gutschein/i.test(offer.conditionsText)));
  assert.ok(offers.some((offer) => offer.title === 'Schwechater Bier' && offer.categorySecondary === 'Bier'));
  assert.ok(offers.some((offer) => offer.title === 'Lovely Toilettenpapier' && offer.categorySecondary === 'Papier & Hygiene'));
});

test('extracts selected SPAR-family KW23 recovery offers with retailer-specific mapping', () => {
  const validity = activeValidityForTest();
  const sparCandidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity,
    pages: [
      {
        pageNumber: 2,
        text: [
          'Metaxa 5 Sterne Weinbrand Griechenland 0,7 Liter statt 49,90 39,90 29,92 Mit SPAR-App-Gutschein',
          '6+6 GRATIS Roemerquelle Mineralwasser versch. Sorten, 1,5 Liter 2x6er-Tray 5,64',
          'Pampers Baby Dry Windeln, Baby Dry Pants oder Premium Protection versch. Groessen Mengenvorteil 1 Pkg. 9,99 ab 2 Pkg. je 7,99',
          'Farina Mehl T480 2,5 kg 3,19 statt 3,99 -20%',
          'Always Ultra Binden Big Pack versch. Sorten, 12-26 Stück Mengenvorteil 1 Pkg. 4,08 ab 2 Pkg. je 3,19',
        ].join('\n'),
      },
    ],
  });
  const eurosparCandidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'eurospar',
    validity,
    pages: [
      {
        pageNumber: 2,
        text: [
          '6+6 GRATIS Roemerquelle Mineralwasser versch. Sorten, 1,5 Liter 2x6er-Tray 5,64',
          'Coca-Cola Limonaden versch. Sorten, 0,33 Liter 24er-Tray 16,56 1 Ds. 1,39 ab 24 Ds. je 0,69',
          'Goesser Maerzen 0,5 Liter 20er-Kiste 29,80 14,90 -50%',
          'Pepsi oder Pepsi zero 1,5 Liter 1 Fl. 1,99 ab 6 Fl. je 0,99 3+3 GRATIS 6er-Tray 5,94',
          'Faschiertes gemischt aus Österreich, aus Rind- und Schweinefleisch, in Bedienung, per kg 9,99 statt 12,99',
        ].join('\n'),
      },
    ],
  });
  const sparOffers = normalizeSparPdfCandidatesToOffers({
    pdfReference: { validity, candidates: sparCandidates },
    source: source('spar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260603-1-flugblatt-kw-23/getPdf.ashx',
  });
  const eurosparOffers = normalizeSparPdfCandidatesToOffers({
    pdfReference: { validity, candidates: eurosparCandidates },
    source: source('eurospar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/eurospar/260603-1-flugblatt-kw-23/getPdf.ashx',
  });

  assert.ok(sparOffers.some((offer) => offer.title === 'Metaxa 5 Sterne Weinbrand' && /SPAR-App-Gutschein/.test(offer.conditionsText)));
  assert.ok(sparOffers.some((offer) => offer.title === 'Roemerquelle Mineralwasser' && offer.quantityText === '12 x 1.5 l'));
  assert.ok(sparOffers.some((offer) => offer.title === 'Pampers Baby Dry Windeln, Pants oder Premium Protection' && /ab 2 Packungen/.test(offer.conditionsText)));
  assert.ok(sparOffers.some((offer) => offer.title === 'Farina Mehl T480' && offer.categorySecondary === 'Backen & Grundnahrungsmittel'));
  assert.ok(sparOffers.some((offer) => offer.title === 'Always Ultra Binden Big Pack' && offer.categorySecondary === 'Damenhygiene'));
  assert.ok(eurosparOffers.some((offer) => offer.title === 'Roemerquelle Mineralwasser' && offer.quantityText === '12 x 1.5 l'));
  assert.ok(eurosparOffers.some((offer) => offer.title === 'Coca-Cola Limonaden' && offer.quantityText === '24 x 0.33 l'));
  assert.ok(eurosparOffers.some((offer) => offer.title === 'Goesser Maerzen' && offer.quantityText === '20 x 0.5 l'));
  assert.ok(eurosparOffers.some((offer) => offer.title === 'Pepsi oder Pepsi Zero' && offer.retailerKey === 'eurospar'));
  assert.ok(eurosparOffers.some((offer) => offer.title === 'Faschiertes gemischt' && offer.categorySecondary === 'Fleisch & Wurst'));
});

test('extracts Always Ultra Binden even when text layer separates Big Pack details', () => {
  const validity = activeValidityForTest();
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity,
    pages: [
      {
        pageNumber: 5,
        text: [
          'Always Ultra Binden',
          'Big Pack',
          'versch. Sorten, 12-26 Stueck',
          '1 Pkg. 4,08',
          'ab 2 Pkg. je 3,19',
        ].join('\n'),
      },
    ],
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: { validity, candidates },
    source: source('spar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260603-1-flugblatt-kw-23/getPdf.ashx',
  });
  const offer = offers.find((item) => item.title === 'Always Ultra Binden Big Pack');

  assert.ok(offer);
  assert.equal(offer.priceCurrent.amount, 3.19);
  assert.equal(offer.categoryKey, 'damenhygiene');
  assert.match(offer.conditionsText, /ab 2 Packungen/);
});

test('dedupes split Kantwurst generic candidate when known Reiter candidate exists', () => {
  const validity = activeValidityForTest();
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity,
    pages: [
      {
        pageNumber: 1,
        text: [
          'Reiter Kantwurst oder unga-',
          'rische Salami',
          '400 g',
          'statt 7,99',
          '6,49',
        ].join('\n'),
      },
    ],
  }).filter((candidate) => !candidate.exclusionReason);
  const kantwurst = candidates.filter((candidate) => /Kantwurst/i.test(candidate.title || ''));

  assert.equal(kantwurst.length, 1);
  assert.equal(kantwurst[0].title, 'Kantwurst oder ungarische Salami von Reiter');
});

test('normalizes safe SPAR Puntigamer crate fallback from Kiste and half-liter bottle context', () => {
  const currentValidity = {
    validFrom: new Date('2026-05-28T12:00:00.000Z'),
    validTo: new Date('2026-06-02T12:00:00.000Z'),
  };
  const [offer] = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates: [
        {
          id: 'puntigamer-kiste',
          page: 1,
          productKind: 'beer',
          categoryPrimary: 'Getraenke',
          categorySecondary: 'Bier',
          categoryKey: 'bier',
          title: 'Puntigamer Maerzen',
          brand: 'Puntigamer',
          price: 14.90,
          referencePrice: 29.80,
          quantityText: 'Kiste, 0.5 l Flaschen',
          conditionsText: '1+1 gratis / 1 Kiste 29,80 / ab 2 Kisten je 14,90 / Joker moeglich',
          rawText: 'Puntigamer Maerzen, 0,5 Liter, 1+1 gratis, 1 Kiste 29,80, ab 2 Kisten je 14,90',
          comparisonSafe: false,
        },
      ],
    },
    source: source('spar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260528-1-flugblatt-kw-22/getPdf.ashx',
  });

  assert.equal(offer.quantityText, 'Kiste, 0.5 l Flaschen');
  assert.equal(offer.packCount, 20);
  assert.equal(offer.unitValue, 0.5);
  assert.equal(offer.totalComparableAmount, 10);
  assert.equal(offer.comparableUnit, 'l');
  assert.equal(offer.normalizedUnitPrice.amount, 1.49);
  assert.match(offer.conditionsText, /1\+1 gratis/);
  assert.match(offer.conditionsText, /ab 2 Kisten/);
  assert.match(offer.conditionsText, /Joker moeglich/);
});

test('normalizes explicit Puntigamer 20 x 0.5 l crate deal as beer', () => {
  const currentValidity = {
    validFrom: new Date('2026-05-28T12:00:00.000Z'),
    validTo: new Date('2026-06-02T12:00:00.000Z'),
  };
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'interspar',
    validity: currentValidity,
    pages: [
      {
        pageNumber: 3,
        text: [
          '1+1 GRATIS!',
          '1 Kiste 29,80',
          'Puntigamer das bierige Bier',
          'ab 2 Kisten je',
          '20 x 0,5-Liter-MEHRWEG-Flasche',
          '1490',
          '(= per 0,5 Liter 0,75)',
          '0,5-Liter-Flasche im Einzelverkauf: 1,49',
        ].join('\n'),
      },
    ],
  });
  const [offer] = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates,
    },
    source: source('interspar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.interspar.at/steiermark/steiermark_kw22/getPdf.ashx',
  });
  assert.equal(offer.title, 'Puntigamer das bierige Bier');
  assert.equal(offer.categorySecondary, 'Bier');
  assert.equal(offer.categoryKey, 'bier');
  assert.equal(offer.priceCurrent.amount, 14.90);
  assert.equal(offer.priceReference.amount, 29.80);
  assert.equal(offer.quantityText, '20 x 0.5 l');
  assert.equal(offer.packCount, 20);
  assert.equal(offer.totalComparableAmount, 10);
  assert.equal(offer.normalizedUnitPrice.amount, 1.49);
  assert.equal(offer.minimumPurchaseQty, 2);
  assert.equal(offer.isMultiBuy, true);
  assert.match(offer.conditionsText, /1\+1 gratis/);
});

test('does not infer Austrian beer crate packcount for non-beer Kiste text', () => {
  const currentValidity = {
    validFrom: new Date('2026-05-28T12:00:00.000Z'),
    validTo: new Date('2026-06-02T12:00:00.000Z'),
  };
  const [offer] = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates: [
        {
          id: 'haushalt-kiste',
          page: 4,
          productKind: 'generic-flyer-product',
          title: 'Aufbewahrungskiste transparent',
          brand: '',
          price: 3.99,
          quantityText: 'Kiste',
          conditionsText: '',
          rawText: 'Aufbewahrungskiste transparent, 1 Stueck, 3,99',
          comparisonSafe: false,
        },
      ],
    },
    source: source('spar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260528-1-flugblatt-kw-22/getPdf.ashx',
  });

  assert.notEqual(offer.packCount, 20);
  assert.notEqual(offer.totalComparableAmount, 10);
  assert.equal(offer.normalizedUnitPrice.comparable, false);
});

test('keeps 12+12 gratis beer conditions without crate packcount distortion', () => {
  const currentValidity = {
    validFrom: new Date('2026-05-21T12:00:00.000Z'),
    validTo: new Date('2026-06-02T12:00:00.000Z'),
  };
  const [offer] = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates: [
        {
          id: 'ottakringer-12-12',
          page: 3,
          productKind: 'beer',
          categoryPrimary: 'Getraenke',
          categorySecondary: 'Bier',
          categoryKey: 'bier',
          title: 'Ottakringer Helles oder Frucade Radler',
          brand: 'Ottakringer',
          price: 0.69,
          quantityText: '0.5 l',
          conditionsText: '12+12 gratis bzw. Mengenpreis laut Flugblatt',
          rawText: 'Ottakringer Helles oder Frucade Radler, 0,5 Liter, 12+12 gratis',
          comparisonSafe: true,
        },
      ],
    },
    source: source('spar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260521-1-flugblatt-kw-21/getPdf.ashx',
  });

  assert.equal(offer.packCount, null);
  assert.equal(offer.totalComparableAmount, 0.5);
  assert.equal(offer.normalizedUnitPrice.amount, 1.38);
  assert.match(offer.conditionsText, /12\+12 gratis/);
});

test('extracts non-beer generic SPAR flyer offers from textlayer price blocks', () => {
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: fixture.validity,
    pages: [
      {
        pageNumber: 7,
        text: [
          'S-BUDGET Teebutter',
          '250 g Packung',
          'statt 2,99',
          '1,99',
          'Persil Waschmittel Universal',
          '40 Waschgänge',
          'statt 19,99',
          '12,99',
        ].join('\n'),
      },
    ],
  }).filter((candidate) => !candidate.exclusionReason);

  assert.ok(candidates.some((candidate) => candidate.title === 'S-BUDGET Teebutter'));
  assert.ok(candidates.some((candidate) => candidate.title === 'Persil Waschmittel Universal'));
  assert.ok(candidates.some((candidate) => candidate.productKind === 'generic-flyer-product'));
});

test('normalizes generic non-beer candidates into broad categories', () => {
  const currentValidity = {
    validFrom: new Date('2026-05-21T12:00:00.000Z'),
    validTo: new Date('2026-06-02T12:00:00.000Z'),
  };
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: currentValidity,
    pages: [
      {
        pageNumber: 8,
        text: [
          'Persil Waschmittel Universal',
          '40 Waschgänge',
          'statt 19,99',
          '12,99',
        ].join('\n'),
      },
    ],
  });
  const [offer] = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates,
    },
    source: source('spar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260521-1-flugblatt-kw-21/getPdf.ashx',
  });

  assert.equal(offer.title, 'Persil Waschmittel Universal');
  assert.notEqual(offer.categorySecondary, 'Bier');
  assert.match(offer.searchText, /waschmittel/);
});

test('accepts SPAR price-reduced S-BUDGET Caffe Crema after marketing prefix removal', () => {
  const currentValidity = {
    validFrom: new Date('2026-05-28T12:00:00.000Z'),
    validTo: new Date('2026-06-02T12:00:00.000Z'),
  };
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: currentValidity,
    pages: [
      {
        pageNumber: 10,
        text: [
          'Preisgesenkt seit',
          '5.5.2026',
          'S-BUDGET',
          'Caff\u00e8 Crema',
          'ganze Bohne, 500 g',
          '5,49',
          'statt 5,99',
          '-8%',
          '(per kg 10,98)',
        ].join('\n'),
      },
    ],
  });
  const accepted = candidates.filter((candidate) => !candidate.exclusionReason);
  const candidate = accepted.find((item) => item.title === 'S-BUDGET Caff\u00e8 Crema');

  assert.ok(candidate);
  assert.doesNotMatch(candidate.title, /Preisgesenkt seit/i);
  assert.equal(candidate.price, 5.49);
  assert.equal(candidate.referencePrice, 5.99);
  assert.equal(candidate.quantityText, '500 g');

  const [offer] = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates,
    },
    source: source('spar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260528-1-flugblatt-kw-22/getPdf.ashx',
  });

  assert.equal(offer.title, 'S-BUDGET Caff\u00e8 Crema');
  assert.equal(offer.categoryPrimary, 'Getraenke');
  assert.equal(offer.categorySecondary, 'Kaffee & Tee');
  assert.equal(offer.normalizedUnitPrice.unit, 'kg');
  assert.ok(Math.abs(offer.normalizedUnitPrice.amount - 10.98) < 0.01);
  assert.equal(offer.normalizedUnitPrice.comparable, true);
  assert.equal(offer.conditionsText, '');
});

test('rejects price-reduced generic fragments without a safe product core', () => {
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: fixture.validity,
    pages: [
      {
        pageNumber: 10,
        text: [
          'Preisgesenkt seit',
          '5.5.2026',
          'statt 5,99',
          '-8%',
          '5,49',
          'Preisgesenkt seit',
          '05.05.2026',
          'versch. Sorten',
          '500 g',
          '5,49',
        ].join('\n'),
      },
    ],
  });
  const accepted = candidates.filter((candidate) => !candidate.exclusionReason);

  assert.equal(accepted.length, 0);
  assert.equal(candidates.some((candidate) => candidate.title === '' && candidate.exclusionReason), true);
  assert.equal(candidates.some((candidate) => candidate.exclusionReason === 'generic-fragment-title'), true);
});

test('generic SPAR PDF extraction keeps unsafe fragment starts rejected', () => {
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: fixture.validity,
    pages: [
      {
        pageNumber: 10,
        text: [
          'gratis',
          '500 g',
          '1,99',
          'versch. Sorten',
          '500 g',
          '2,99',
          'oder',
          '500 g',
          '3,99',
          'immer billig',
          '500 g',
          '4,99',
        ].join('\n'),
      },
    ],
  });

  assert.equal(candidates.some((candidate) => !candidate.exclusionReason), false);
  assert.ok(candidates.some((candidate) => candidate.exclusionReason === 'generic-fragment-title'));
});

test('generic SPAR PDF extraction rejects visible KW25 fragment false positives', () => {
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: fixture.validity,
    pages: [
      {
        pageNumber: 11,
        text: ['-25%bis zu DESPAR Pragaschinken', '100 g', '1,99'].join('\n'),
      },
      {
        pageNumber: 12,
        text: ['-32%bis zu Wiesbauer Wurst', '100 g', '1,49'].join('\n'),
      },
      {
        pageNumber: 13,
        text: ['4+4 GRATISPilsner Urquell', '0,5 Liter', '7,99'].join('\n'),
      },
      {
        pageNumber: 14,
        text: ['GRATISMikado versch. Sorten', '75 g', '1,99'].join('\n'),
      },
    ],
  });
  const accepted = candidates.filter((candidate) => !candidate.exclusionReason);

  assert.equal(accepted.some((candidate) => /^-25%bis zu/i.test(candidate.title)), false);
  assert.equal(accepted.some((candidate) => /^-32%bis zu/i.test(candidate.title)), false);
  assert.equal(accepted.some((candidate) => /^4\+4\s+GRATIS/i.test(candidate.title)), false);
  assert.equal(accepted.some((candidate) => /^GRATIS\S+/i.test(candidate.title)), false);
  assert.ok(candidates.some((candidate) => candidate.exclusionReason === 'generic-fragment-title' && /DESPAR Pragaschinken/i.test(candidate.rawText)));
  assert.ok(candidates.some((candidate) => candidate.exclusionReason === 'generic-fragment-title' && /Wiesbauer/i.test(candidate.rawText)));
  assert.ok(candidates.some((candidate) => candidate.exclusionReason === 'generic-fragment-title' && /Pilsner Urquell/i.test(candidate.rawText)));
  assert.ok(candidates.some((candidate) => candidate.exclusionReason === 'generic-fragment-title' && /GRATISMikado/i.test(candidate.rawText)));
});

test('rejects generic PDF promotion fragments and cleans leading price/date artifacts', () => {
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: fixture.validity,
    pages: [
      {
        pageNumber: 9,
        text: [
          'Ersparnis 1,20 ab',
          '250 g Packung',
          '1,99',
          '„So spart Österreich das ganze Jahr mit S-BUDGET!“ Angebote gültig bei 15 „S“ wie super sparen.',
          '500 g Packung',
          '2,99',
          'Fr., 22.5. und Sa., 23.5.26 S-BUDGET Lachsfilet natur XXL aus Aquakultur Norwegen',
          '500-g-Pkg.',
          '7,99',
          'ab 2 Pkg. je 2,99Recheis Familie 2-Ei Teigwaren versch. Sorten,',
          '500 g Packung',
          '2,99',
        ].join('\n'),
      },
    ],
  });
  const accepted = candidates.filter((candidate) => !candidate.exclusionReason);

  assert.equal(accepted.some((candidate) => candidate.title === 'Ersparnis 1,20 ab'), false);
  assert.equal(accepted.some((candidate) => /So spart/.test(candidate.title)), false);
  assert.ok(accepted.some((candidate) => candidate.title === 'S-BUDGET Lachsfilet natur XXL aus Aquakultur Norwegen'));
  assert.ok(accepted.some((candidate) => candidate.title === 'Recheis Familie 2-Ei Teigwaren versch. Sorten,'));
});

test('generic SPAR PDF extraction rejects fragment starts and merged product blocks', () => {
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: fixture.validity,
    pages: [
      {
        pageNumber: 10,
        text: [
          'mit 100% Milch aus Österreich und Früchten aus anderer Herkunft,',
          '500 g',
          '1 Fl. 8,99',
          'ab 2 Fl. je 4,49',
          '1+1 GRATIS Poggi del Sole Chianti Riserva',
          'Blue Star WC-Steine Doppelpackung, verschiedene Sorten oder Blue Star Spülkastenwürfel',
          '4 x 50-g-Packung',
          'SPAR Radieschen Bund Aus Österreich, per Bund Angebot gültig von Mo, 25.5. bis Sa, 30.5.',
          '0,99',
          'Coca-Cola Limonaden versch. Sorten, 1,5 Liter 6er-Tray',
          '7,44',
          'oder Monte Maxi Schoko',
          '4 x 100 g',
          '1,69',
        ].join('\n'),
      },
    ],
  });
  const accepted = candidates.filter((candidate) => !candidate.exclusionReason);

  assert.equal(accepted.some((candidate) => /^mit 100% Milch/.test(candidate.title)), false);
  assert.equal(accepted.some((candidate) => /^Blue Star/.test(candidate.title)), false);
  const radieschen = accepted.find((candidate) => /^SPAR Radieschen Bund Aus .*sterreich$/.test(candidate.title));
  assert.ok(radieschen);
  assert.equal(radieschen.price, 0.99);
  assert.equal(radieschen.quantityText, '1 Bund');
  assert.equal(radieschen.categorySecondary, 'Obst & Gemuese');
  assert.doesNotMatch(radieschen.title, /Blue Star|WC-Steine|Sp(?:ÃƒÂ¼|Ã¼|ue)lkasten/i);
  assert.doesNotMatch(radieschen.conditionsText, /1\+1 gratis|Blue Star|WC-Steine|Sp(?:ÃƒÂ¼|Ã¼|ue)lkasten/i);
  assert.doesNotMatch(radieschen.rawText, /Blue Star|WC-Steine|Sp(?:ÃƒÂ¼|Ã¼|ue)lkasten/i);
  assert.equal(accepted.some((candidate) => /^oder Monte/.test(candidate.title)), false);
  assert.ok(accepted.some((candidate) => candidate.title === 'Coca-Cola Limonaden versch. Sorten,'));
  assert.ok(candidates.some((candidate) => candidate.exclusionReason === 'generic-fragment-title'));
  assert.equal(
    candidates.some((candidate) =>
      candidate.exclusionReason === 'generic-merge-risk' &&
      /Radieschen/i.test(candidate.rawText || '')
    ),
    false
  );
});

test('generic SPAR PDF extraction keeps clear radieschen fresh candidate from merged text block', () => {
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'interspar',
    validity: fixture.validity,
    pages: [
      {
        pageNumber: 3,
        text: [
          'Blue Star WC-Steine Doppelpackung, verschiedene Sorten oder Blue Star SpÃ¼lkastenwÃ¼rfel',
          '4 x 50-g-Packung',
          'SPAR Radieschen Bund Aus Ã–sterreich, per Bund Angebot gÃ¼ltig von Mo, 25.5. bis Sa, 30.5.',
          '0,99',
        ].join('\n'),
      },
    ],
  });
  const accepted = candidates.filter((candidate) => !candidate.exclusionReason);

  assert.equal(accepted.length, 1);
  assert.match(accepted[0].title, /^SPAR Radieschen Bund Aus .*sterreich$/);
  assert.equal(accepted[0].price, 0.99);
  assert.equal(accepted[0].quantityText, '1 Bund');
  assert.equal(accepted[0].categorySecondary, 'Obst & Gemuese');
  assert.doesNotMatch(accepted[0].title, /Blue Star|WC-Steine|Sp(?:ÃƒÂ¼|Ã¼|ue)lkasten/i);
  assert.doesNotMatch(accepted[0].conditionsText, /Blue Star|WC-Steine|Sp(?:ÃƒÂ¼|Ã¼|ue)lkasten/i);
  assert.doesNotMatch(accepted[0].rawText, /Blue Star|WC-Steine|Sp(?:ÃƒÂ¼|Ã¼|ue)lkasten/i);
  assert.equal(candidates.some((candidate) => candidate.exclusionReason === 'generic-merge-risk'), false);
});

test('generic SPAR PDF extraction does not attach neighboring multibuy condition to radieschen', () => {
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: fixture.validity,
    pages: [
      {
        pageNumber: 3,
        text: [
          '1+1 GRATIS Poggi del Sole Chianti Riserva',
          'Blue Star WC-Steine Doppelpackung, verschiedene Sorten oder Blue Star SpÃ¼lkastenwÃ¼rfel',
          '4 x 50-g-Packung',
          'SPAR Radieschen Bund Aus Ã–sterreich, per Bund Angebot gÃ¼ltig von Mo, 25.5. bis Sa, 30.5.',
          '0,99',
        ].join('\n'),
      },
    ],
  });
  const radieschen = candidates.find((candidate) => !candidate.exclusionReason && /Radieschen/i.test(candidate.title));

  assert.ok(radieschen);
  assert.equal(radieschen.price, 0.99);
  assert.equal(radieschen.quantityText, '1 Bund');
  assert.equal(radieschen.categorySecondary, 'Obst & Gemuese');
  assert.doesNotMatch(radieschen.conditionsText, /1\+1 gratis/i);
});

test('generic SPAR PDF extraction still rejects unspecific merged non-fresh blocks', () => {
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'interspar',
    validity: fixture.validity,
    pages: [
      {
        pageNumber: 3,
        text: [
          'Blue Star WC-Steine Doppelpackung, verschiedene Sorten oder Blue Star SpÃ¼lkastenwÃ¼rfel',
          '4 x 50-g-Packung',
          'Grabkerzen Angebote gÃ¼ltig von Do, 28.5. bis Di, 2.6.',
          '0,99',
        ].join('\n'),
      },
    ],
  });

  assert.equal(candidates.some((candidate) => candidate.title === 'Grabkerzen'), false);
  assert.ok(candidates.some((candidate) => candidate.exclusionReason === 'generic-merge-risk'));
});

test('generic SPAR PDF extraction rejects known dense public merge titles', () => {
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'interspar',
    validity: fixture.validity,
    pages: [
      {
        pageNumber: 9,
        text: [
          'Bio-Dinkel- Vollkornbrot Kaesekrainer Snack Buttertoast Kartoffel- weckerl',
          '500 g',
          '2,49',
        ].join('\n'),
      },
      {
        pageNumber: 10,
        text: [
          'Schweinsbauch- fleisch aus Oesterreich, mager, im Stueck, zum Braten oder Fuellen, in Bedienung Aktion! Bauernsulz',
          'per kg',
          '6,99',
        ].join('\n'),
      },
      {
        pageNumber: 15,
        text: [
          'Schuettdosen Aufbewahrungsdose, mit extra Verschluss. Zum perfekten Portionieren von Cerealien, Cornflakes, Mehl, Zucker, Reis etc. Hergestellt in Oesterreich.',
          '1 Liter',
          '2,99',
        ].join('\n'),
      },
    ],
  });
  const accepted = candidates.filter((candidate) => !candidate.exclusionReason);

  assert.equal(accepted.some((candidate) => /Kaesekrainer|Bauernsulz|Schuettdosen/i.test(candidate.title)), false);
  assert.ok(candidates.some((candidate) => candidate.exclusionReason === 'generic-merge-risk' && /Kaesekrainer/i.test(candidate.rawText || '')));
  assert.ok(candidates.some((candidate) => candidate.exclusionReason === 'generic-merge-risk' && /Bauernsulz/i.test(candidate.rawText || '')));
  assert.ok(candidates.some((candidate) => candidate.exclusionReason === 'generic-merge-risk' && /Schuettdosen/i.test(candidate.rawText || '')));
});

test('generic SPAR PDF extraction does not classify Blue Star WC offer as fresh radieschen', () => {
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: fixture.validity,
    pages: [
      {
        pageNumber: 3,
        text: [
          'Blue Star WC-Steine Doppelpackung, verschiedene Sorten oder Blue Star SpÃ¼lkastenwÃ¼rfel',
          '4 x 50-g-Packung',
          '1,99',
        ].join('\n'),
      },
    ],
  });
  const accepted = candidates.filter((candidate) => !candidate.exclusionReason);

  assert.equal(accepted.some((candidate) => /Radieschen/i.test(candidate.title)), false);
  assert.equal(accepted.some((candidate) => candidate.categorySecondary === 'Obst & Gemuese'), false);
});

test('accepts clear INTERSPAR PDF non-food piece offers without explicit quantity', () => {
  const currentValidity = {
    validFrom: new Date('2026-05-28T12:00:00.000Z'),
    validTo: new Date('2026-06-02T12:00:00.000Z'),
  };
  const pages = [
    ['KRUPS Kaffeevollautomat my Coffee', 'statt 399,99', '299,00'],
    ['Tefal Heissluftfritteuse Easy Fry XL Surface', 'statt 179,99', '129,99'],
    ['Tefal OptiGrill', 'statt 129,99', '89,99'],
    ['Rowenta Akkusauger X-Force Flex 9.60', 'statt 299,99', '199,99'],
    ['Tefal Dampfglatter AeroSteam', 'statt 129,99', '99,99'],
  ].map((lines, index) => ({
    pageNumber: 20 + index,
    text: lines.join('\n'),
  }));
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'interspar',
    validity: currentValidity,
    pages,
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates,
    },
    source: source('interspar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.interspar.at/steiermark/steiermark_kw22/getPdf.ashx',
  });

  for (const title of [
    'KRUPS Kaffeevollautomat my Coffee',
    'Tefal Heissluftfritteuse Easy Fry XL Surface',
    'Tefal OptiGrill',
    'Rowenta Akkusauger X-Force Flex 9.60',
    'Tefal Dampfglatter AeroSteam',
  ]) {
    const candidate = candidates.find((item) => item.title === title && !item.exclusionReason);
    const offer = offers.find((item) => item.title === title);

    assert.ok(candidate, title);
    assert.ok(offer, title);
    assert.equal(candidate.quantityText, '1 Stueck', title);
    assert.equal(offer.quantityText, '1 Stueck', title);
    assert.equal(offer.categoryPrimary, 'Technik / Elektronik', title);
    assert.equal(offer.normalizedUnitPrice.comparable, false, title);
    assert.equal(offer.quality.comparisonSafe, false, title);
  }

  assert.equal(offers.find((item) => item.title === 'KRUPS Kaffeevollautomat my Coffee').priceReference.amount, 399.99);
  assert.equal(offers.find((item) => item.title === 'Tefal Heissluftfritteuse Easy Fry XL Surface').priceCurrent.amount, 129.99);
});

test('accepts real INTERSPAR KW22 page 16 non-food layout blocks', () => {
  const currentValidity = {
    validFrom: new Date('2026-05-27T22:00:00.000Z'),
    validTo: new Date('2026-06-02T21:59:59.999Z'),
    validityText: 'Do., 28.05.26 - Di., 02.06.26',
    validitySource: 'crawlPolicy',
    confidence: 0.62,
  };
  const page16Text = [
    'ANGEBOTE GUELTIG BIS Mi, 17.6.                                             ALLES DA DA DA',
    '                                                       -20 % bis zu auf ALLE elektrische Haushaltsprodukte von Krups, Tefal & Rowenta',
    '                                                     Gueltig von Do, 28.5. bis Di, 2.6.',
    '  Kaffeevollautomat »My Coffee«',
    '                                                   20% billiger!',
    '                                                   statt* 439,99',
    '  Extrem kompaktes Design nur 18,5 cm Breite, Sensor-Touchscreen, 3 Kaffeespezialitaeten auf Knopfdruck',
    '                                                   349,- 7920',
    '  integrierter Luefter zur verbesserten Trocknung des Kaffeesatzes nach der Extraktion Mod.-Nr.: EA2004E0, 2 Jahre Garantie',
    '  Prozentaktion gilt auch auf Aktionspreise und bereits reduzierte Ware. Nicht mit anderen Prozentaktionen und Gutscheinen kombinierbar.',
    '                                                   1,5 Liter Wassertank',
    '  Tefal Heissluft-',
    '  fritteuse »Easy Fry                         Zusaetzlich                         Tefal OptriGrill',
    '  XL Surface«',
    '  Die kompakte Heissluftfritteuse mit 35% billiger!  -20% auf den Aktionspreis     Der Tefal Optigrill GC7058 passt',
    '  extra grosser Garflaeche, die auch',
    '  eine perfekte glutenfreie Pizza statt* 229,99                                      statt* 309,99',
    '                                      149,- 11920',
    '  backen kann All-in-One-Geraet: 10                                                  Steaks, Fisch und Gemuese genau',
    '                                                                                     12490 9992',
    '  voreingestellte Programme Intuitives, digitales Touchdisplay                       nach Wunsch, waehrend das Tefal Ice Force Kochmesser das Schneiden kinderleicht macht.',
    '  Mod.Nr.: FW402H, 2 Jahre Garantie                                                  Mod.Nr.: GC7058.MES2, 2 Jahre Garantie',
    '                                      Akkusauger                                      Feuchte Reinigungstuecher',
    '                                      X-Force Flex 9.60                              Feuchte Ersatztuecher fuer Reinigungssysteme oder auch ohne Geraet',
    '                                                                                     Dampfglaetter',
    '                                      Leistungsstufen: 3                              »Aerosteam«',
    '                                      Bis zu 45 Min Laufzeit                          3 Betriebsmodi: Nur Dampf, Dampf + sanftes Saugen',
    '                                      statt* 499,99                                   40% billiger!',
    '                                                                                     statt* 199,99',
    '                                      199,- 15920                                     119,- 9520',
    '                                                                                     Sloggi Damen Tai-, Midi- oder',
    '                                                                                     Maxi-Slip Serie »Pure Comfort«',
    '                                                                                     PREISstatt* 29,97',
    '                                                                                     2+1, 3er-Packung',
    '                                                                                     Zertifizierte Bio-Baumwolle - 95% Baumwolle, 5% Elasthan',
    '                                                                                     1498',
  ].join('\n');
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'interspar',
    validity: currentValidity,
    pages: [
      {
        pageNumber: 16,
        text: page16Text,
      },
    ],
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates,
    },
    source: source('interspar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.interspar.at/steiermark/steiermark_kw22/getPdf.ashx',
  });
  const offerByTitle = new Map(offers.map((offer) => [offer.title, offer]));

  for (const [title, price, referencePrice] of [
    ['KRUPS Kaffeevollautomat my Coffee', 349],
    ['Tefal Heissluftfritteuse Easy Fry XL Surface', 119.20, 229.99],
    ['Tefal OptiGrill', 99.92, 309.99],
    ['Rowenta Akkusauger X-Force Flex 9.60', 159.20, 499.99],
    ['Tefal Dampfglatter AeroSteam', 95.20, 199.99],
  ]) {
    const candidate = candidates.find((item) => item.title === title && !item.exclusionReason);
    const offer = offerByTitle.get(title);

    assert.ok(candidate, title);
    assert.ok(offer, title);
    assert.equal(offer.priceCurrent.amount, price, title);
    if (referencePrice) assert.equal(offer.priceReference.amount, referencePrice, title);
    assert.equal(offer.quantityText, '1 Stueck', title);
    assert.equal(offer.quality.comparisonSafe, false, title);
    assert.doesNotMatch(offer.title, /statt/i, title);
    assert.match(offer.conditionsText, /-20% auf den Aktionspreis/, title);
  }

  const sloggi = offerByTitle.get('Sloggi Damen Tai-, Midi- oder Maxi-Slip Serie Pure Comfort');
  assert.ok(sloggi);
  assert.equal(sloggi.priceCurrent.amount, 14.98);
  assert.equal(sloggi.priceReference.amount, 29.97);
  assert.equal(sloggi.quantityText, '3 Stueck');
  assert.equal(sloggi.quality.comparisonSafe, false);
  assert.equal(sloggi.categoryPrimary, 'Kleidung / Mode');

  assert.equal(offers.some((offer) => /^-20%/.test(offer.title)), false);
  assert.equal(offers.some((offer) => /1\+1\s+gratis/i.test(offer.title)), false);
  assert.equal(offers.some((offer) => /1\/2\s+Preis/i.test(offer.title)), false);
});

test('classifies SPAR PDF household cleaning and textile anchors without unsafe comparison', () => {
  const currentValidity = {
    validFrom: new Date('2026-05-28T12:00:00.000Z'),
    validTo: new Date('2026-06-02T12:00:00.000Z'),
  };
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'interspar',
    validity: currentValidity,
    pages: [
      {
        pageNumber: 31,
        text: ['Splendid Einweghandschuhe', '1,99'].join('\n'),
      },
      {
        pageNumber: 32,
        text: ['Splendid Feuchte Reinigungstuecher', '1,49'].join('\n'),
      },
      {
        pageNumber: 33,
        text: ['Sloggi Damen Tai-, Midi- oder Maxi-Slip Serie Pure Comfort', '9,99'].join('\n'),
      },
    ],
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates,
    },
    source: source('interspar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.interspar.at/steiermark/steiermark_kw22/getPdf.ashx',
  });
  const gloves = offers.find((offer) => offer.title === 'Splendid Einweghandschuhe');
  const wipes = offers.find((offer) => offer.title === 'Splendid Feuchte Reinigungstuecher');
  const sloggi = offers.find((offer) => offer.title === 'Sloggi Damen Tai-, Midi- oder Maxi-Slip Serie Pure Comfort');

  assert.ok(gloves);
  assert.equal(gloves.categoryPrimary, 'Haushalt');
  assert.equal(gloves.categorySecondary, 'Waschmittel & Reiniger');
  assert.notEqual(gloves.categoryPrimary, 'Kleidung / Mode');
  assert.equal(gloves.quantityText, '1 Stueck');

  assert.ok(wipes);
  assert.equal(wipes.categoryPrimary, 'Haushalt');
  assert.equal(wipes.categorySecondary, 'Waschmittel & Reiniger');
  assert.equal(wipes.quantityText, '1 Stueck');

  assert.ok(sloggi);
  assert.equal(sloggi.categoryPrimary, 'Kleidung / Mode');
  assert.equal(sloggi.quantityText, '1 Stueck');
  assert.equal(sloggi.quality.comparisonSafe, false);
});

test('keeps SPAR PDF promotion fragments rejected and food without quantity unfixed', () => {
  const currentValidity = {
    validFrom: new Date('2026-05-28T12:00:00.000Z'),
    validTo: new Date('2026-06-02T12:00:00.000Z'),
  };
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'interspar',
    validity: currentValidity,
    pages: [
      {
        pageNumber: 34,
        text: ['-20% auf alle elektrische Haushaltsprodukte', '299,00'].join('\n'),
      },
      {
        pageNumber: 35,
        text: ['SPAR Naturjoghurt cremig', '1,29'].join('\n'),
      },
    ],
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates,
    },
    source: source('interspar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.interspar.at/steiermark/steiermark_kw22/getPdf.ashx',
  });

  assert.equal(offers.length, 0);
  assert.equal(
    candidates.some((candidate) => candidate.exclusionReason && /elektrische Haushaltsprodukte/i.test(candidate.rawText || '')),
    true
  );
  assert.equal(
    candidates.some((candidate) => candidate.exclusionReason === 'generic-missing-quantity' && /Naturjoghurt/i.test(candidate.rawText || '')),
    true
  );
});

test('generic SPAR PDF candidates preserve visible multibuy conditions', () => {
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: fixture.validity,
    pages: [
      {
        pageNumber: 11,
        text: [
          'Bio-Handsemmel SPAR Laugenstange nach original bayrischer Rezeptur',
          '1 Stk.',
          '1,25',
          'bei 3 Stk. je 0,83',
          '2 + 1 GRATIS',
          '0,83',
        ].join('\n'),
      },
    ],
  });
  const accepted = candidates.filter((candidate) => !candidate.exclusionReason);

  assert.equal(accepted[0].title, 'Bio-Handsemmel SPAR Laugenstange nach original bayrischer Rezeptur');
  assert.match(accepted[0].conditionsText, /2\+1 gratis/);
  assert.match(accepted[0].conditionsText, /ab\/bei 3 Stueck/);
});

test('builds bounded SPAR PDF rejected-candidate samples for raw document diagnostics', () => {
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: fixture.validity,
    pages: [
      {
        pageNumber: 9,
        text: [
          'Ersparnis 1,20 ab',
          '250 g Packung',
          '1,99',
          'S-BUDGET Beispiel ohne Menge',
          'ab 2 Packungen je 2,99',
          '2,99',
        ].join('\n'),
      },
    ],
  });

  const samples = buildRejectedCandidateSamples({
    candidates,
    sourceKey: 'spar-official-flyer-pdf',
    retailerKey: 'spar',
    validityContext: '2026-05-27 - 2026-06-02',
    createdAt: '2026-05-28T10:00:00.000Z',
    maxSamplesPerSourceReason: 2,
    maxSnippetLength: 120,
  });

  assert.ok(samples.length > 0);
  assert.equal(samples[0].sourceKey, 'spar-official-flyer-pdf');
  assert.equal(samples[0].retailerKey, 'spar');
  assert.ok(samples[0].reason);
  assert.ok(samples[0].snippet.length <= 120);
  assert.ok(Array.isArray(samples[0].nearbyPriceTokens));
  assert.ok(Array.isArray(samples[0].nearbyQuantityTokens));
  assert.equal(Object.prototype.hasOwnProperty.call(samples[0], 'rawText'), false);
});

test('rejects campaign-only coffee blocks as non-product diagnostics', () => {
  const page = fixture.pages.find((item) => item.pageNumber === 4);
  const candidates = extractSparPdfCandidates({
    pages: [page],
    sourceRetailerFormat: 'interspar',
    validity: fixture.validity,
  });

  assert.deepEqual(summarizeRejections(candidates), [
    { reason: 'campaign-not-product', count: 1 },
  ]);
  assert.equal(candidates.filter((candidate) => !candidate.exclusionReason).length, 0);
});

test('rejects unclear product blocks without price', () => {
  const page = fixture.pages.find((item) => item.pageNumber === 5);
  const candidates = extractSparPdfCandidates({
    pages: [page],
    sourceRetailerFormat: 'spar',
    validity: fixture.validity,
  });

  assert.equal(candidates.some((candidate) => candidate.exclusionReason === 'missing-price'), true);
});

test('normalizes SPAR PDF candidates with source metadata and distinguishable retailer formats', () => {
  const currentValidity = activeValidityForTest();
  const pages = fixture.pages.filter((page) => page.sourceRetailerFormat === 'interspar');
  const candidates = extractSparPdfCandidates({
    pages,
    sourceRetailerFormat: 'interspar',
    validity: currentValidity,
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates,
    },
    source: source('interspar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.interspar.at/steiermark/steiermark_kw19/getPdf.ashx',
    pdfSha256: 'abc123',
  });

  const activeOffer = offers.find((offer) => offer.status === 'active');
  const stored = enrichOfferForStorage(activeOffer, {
    source: source('interspar'),
    sourceType: SOURCE_TYPE,
    parserVersion: PARSER_VERSION,
  });

  assert.ok(offers.length >= 4);
  assert.ok(activeOffer);
  assert.equal(stored.sourceType, 'spar-official-pdf');
  assert.equal(stored.retailerKey, 'interspar');
  assert.equal(stored.sourceRetailerFormat, 'interspar');
  assert.deepEqual(stored.appliesToRetailerFormats, ['interspar']);
  assert.equal(stored.rawFacts.sourceKey, 'interspar-official-flyer-pdf');
  assert.equal(stored.rawFacts.sourceMetadata.pdfSha256, 'abc123');
  assert.equal(stored.rawFacts.sourceMetadata.extractionMethod, 'text-layer');
  assert.equal(stored.categorySecondary, 'Kaffee & Tee');
});

test('normalizes SPAR PDF beer candidates as beer with format metadata', () => {
  const currentValidity = activeValidityForTest();
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'eurospar',
    validity: currentValidity,
    pages: [
      {
        pageNumber: 1,
        text: 'Gösser Märzen, Naturradler Zitrone oder Naturradler Zitrone alkoholfrei 0,5 Liter 1 DS 1,59 ab 6 DS. je 0,99 0,74',
      },
    ],
  });
  const [offer] = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates,
    },
    source: source('eurospar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/eurospar/260521-1-flugblatt-kw-21/getPdf.ashx',
  });
  const stored = enrichOfferForStorage(offer, {
    source: source('eurospar'),
    sourceType: SOURCE_TYPE,
    parserVersion: PARSER_VERSION,
  });

  assert.equal(stored.categorySecondary, 'Bier');
  assert.equal(stored.categoryKey, 'bier');
  assert.equal(stored.comparableUnit, 'l');
  assert.equal(stored.normalizedUnitPrice.amount, 1.98);
  assert.equal(stored.sourceRetailerFormat, 'eurospar');
  assert.equal(stored.retailerKey, 'eurospar');
  assert.equal(stored.rawFacts.sourceKey, 'eurospar-official-flyer-pdf');
  assert.match(stored.searchText, /bier/);
});

test('keeps SPAR PDF offers with strong category mismatch and marks review reason', () => {
  const currentValidity = {
    validFrom: new Date('2026-05-20T12:00:00.000Z'),
    validTo: new Date('2026-06-02T12:00:00.000Z'),
  };
  const [offer] = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates: [
        {
          id: 'mismatch-1',
          page: 2,
          productKind: 'beer',
          categoryPrimary: 'Getraenke',
          categorySecondary: 'Bier',
          categoryKey: 'bier',
          title: 'Schokolade versch. Sorten',
          brand: '',
          price: 16.80,
          quantityText: '250 g',
          rawText: 'Schokolade versch. Sorten 250 g 16,80',
          comparisonSafe: true,
        },
      ],
    },
    source: source('eurospar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/eurospar/260521-1-flugblatt-kw-21/getPdf.ashx',
  });

  assert.ok(offer);
  assert.equal(offer.title, 'Schokolade versch. Sorten');
  assert.equal(offer.categorySecondary, 'Bier');
  assert.ok(offer.reviewReasons.includes(PDF_CATEGORY_MISMATCH_REVIEW_REASON));
  assert.ok(offer.quality.issues.includes(PDF_CATEGORY_MISMATCH_REVIEW_REASON));
});

test('normalizes relative image URLs and keeps offers when images are missing', () => {
  const currentValidity = {
    validFrom: new Date('2026-05-21T12:00:00.000Z'),
    validTo: new Date('2026-06-02T12:00:00.000Z'),
  };
  const [withImage, withoutImage] = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates: [
        {
          id: 'img-1',
          page: 2,
          productKind: 'generic-flyer-product',
          title: 'S-BUDGET Teebutter',
          brand: 'S-BUDGET',
          price: 1.99,
          quantityText: '250 g',
          rawText: 'S-BUDGET Teebutter 250 g 1,99',
          comparisonSafe: true,
          imageUrl: '/assets/teebutter.png',
        },
        {
          id: 'img-2',
          page: 2,
          productKind: 'generic-flyer-product',
          title: 'Persil Waschmittel Universal',
          brand: 'Persil',
          price: 12.99,
          quantityText: '40 Stk',
          rawText: 'Persil Waschmittel Universal 40 Stk 12,99',
          comparisonSafe: true,
        },
      ],
    },
    source: source('spar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://www.spar.at/flyer/page.html',
  });

  assert.equal(withImage.imageUrl, 'https://www.spar.at/assets/teebutter.png');
  assert.equal(withoutImage.imageUrl, '');
  assert.equal(withoutImage.title, 'Persil Waschmittel Universal');
});

test('generic SPAR PDF parser accepts per-kg Bedienung offers as 1 kg quantity', () => {
  const candidates = extractSparPdfCandidates({
    pages: [{
      pageNumber: 4,
      text: [
        'Faschiertes gemischt aus Österreich',
        'Aus Rind- und Schweinefleisch.',
        'In Bedienung per kg',
        'AKTION!',
        '7,99',
        'statt 13,99',
      ].join('\n'),
    }],
    sourceRetailerFormat: 'interspar',
    validity: fixture.validity,
  });
  const offer = candidates.find((candidate) => candidate.title && /Faschiertes/i.test(candidate.title));

  assert.ok(offer);
  assert.equal(offer.quantityText, '1 kg');
  assert.equal(offer.price, 7.99);
  assert.equal(offer.exclusionReason, undefined);
});

test('generic SPAR PDF parser accepts per-liter flyer offers as 1 l quantity', () => {
  const candidates = extractSparPdfCandidates({
    pages: [{
      pageNumber: 1,
      text: [
        'Premium Saft Orange',
        'gekühlt',
        'per Liter',
        'nur 1,99',
        'statt 2,49',
      ].join('\n'),
    }],
    sourceRetailerFormat: 'eurospar',
    validity: fixture.validity,
  });
  const offer = candidates.find((candidate) => candidate.title && /Premium Saft/i.test(candidate.title));

  assert.ok(offer);
  assert.equal(offer.quantityText, '1 l');
  assert.equal(offer.price, 1.99);
  assert.equal(offer.exclusionReason, undefined);
});

test('coupon booklet source policy adds explicit Gutschein condition to accepted offers', () => {
  const testSource = {
    ...source('spar'),
    crawlPolicy: {
      requireCouponCondition: true,
    },
  };
  const pdfReference = {
    validity: activeValidityForTest(),
    candidates: [
      {
        id: 'coupon-1',
        page: 1,
        title: 'SPAR extra natives Olivenoel',
        brand: 'SPAR',
        price: 0.5,
        quantityText: '0.5 l',
        rawText: 'SPAR extra natives Olivenoel 0,5 l 0,50',
      },
    ],
  };
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference,
    source: testSource,
    crawlJobId: 'coupon-test',
    region: 'AT',
    pdfUrl: testSource.sourceUrl,
  });

  assert.equal(offers.length, 1);
  assert.match(offers[0].conditionsText, /mit Gutschein laut Gutscheinheft/);
  assert.equal(offers[0].hasConditions, true);
});

test('accepts current SPAR KW23 fruit and vegetable official PDF text layer', () => {
  const currentValidity = {
    validFrom: new Date('2026-05-31T22:00:00.000Z'),
    validTo: new Date('2026-06-06T21:59:59.999Z'),
    validityText: 'Mo., 01.06.26 - Sa., 06.06.26',
  };
  const text = [
    'So frisch isst Oesterreich.',
    'Obst- und Gemueseangebote gueltig bis Sa., 6.6.2026',
    'Bio-Beilagen-kartoffel aus Oesterreich, Klasse 1, 1-kg-Netz',
    'Bio-Zitronen zur Hollerbluete Klasse 1, 500-g-Netz',
    'SPAR Nektarinen Klasse 1, 1-kg-Tasse',
    'Radieschen aus Oesterreich, per Bund',
    'ZESPRI Kiwi Gold Klasse 1, 4-Stueck-Tasse',
    'S-BUDGET Spitzpaprika Rot Klasse 1, 500-g-Packung',
    'Nur mit SPAR-App-Gutschein: 2,49 statt 3,99',
    'Nur mit SPAR-App-Gutschein: 1,99 statt 2,99',
  ].join('\n');
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: currentValidity,
    pages: [{ pageNumber: 1, text }],
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates,
    },
    source: source('spar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260601-1-obst-gemuse-kw-23/getPdf.ashx',
  });
  const byTitle = new Map(offers.map((offer) => [offer.title, offer]));

  for (const title of [
    'SPAR Nektarinen',
    'Bio-Beilagenkartoffel aus Oesterreich',
    'Radieschen aus Oesterreich',
    'Bio-Zitronen zur Hollerbluete',
    'ZESPRI Kiwi Gold',
    'S-BUDGET Spitzpaprika Rot',
  ]) {
    assert.ok(byTitle.get(title), title);
    assert.equal(byTitle.get(title).categoryKey, 'obst-gemuese', title);
  }

  assert.equal(byTitle.get('SPAR Nektarinen').priceCurrent.amount, 2.49);
  assert.equal(byTitle.get('SPAR Nektarinen').validTo.toISOString(), '2026-06-06T21:59:59.999Z');
  assert.equal(byTitle.get('Bio-Zitronen zur Hollerbluete').quantityText, '500 g');
  assert.equal(byTitle.get('Radieschen aus Oesterreich').quality.comparisonSafe, false);
  assert.match(byTitle.get('ZESPRI Kiwi Gold').conditionsText, /SPAR-App-Gutschein/);
  assert.match(byTitle.get('S-BUDGET Spitzpaprika Rot').conditionsText, /SPAR-App-Gutschein/);
});

test('accepts current SPAR KW26 fruit and vegetable official PDF text layer without coupon fragments', () => {
  const currentValidity = {
    validFrom: new Date('2026-06-21T22:00:00.000Z'),
    validTo: new Date('2026-06-27T21:59:59.999Z'),
    validityText: 'Mo., 22.06.26 - Sa., 27.06.26',
  };
  const text = [
    'Obst- und Gemueseangebote gueltig bis Sa., 27.6.2026',
    'S-BUDGET Avocados genussreif Klasse 1, per Stueck Niedrigster 30-Tage-Preis 0,99 0,79 statt 1,19 Aktion!',
    'suesse SPAR Marillen Klasse 1, per kg',
    'suesse ZESPRI Kiwi gold Klasse 1, 4-Stueck-Tasse 2,49 statt 3,99 -37% (per Stueck 0,62)',
    'suesser Apfel Pink Lady Klasse 1, per kg',
    'Bio-Heurige Kartoffel aus Oesterreich, Klasse 1',
    '2,49 statt 3,99 -37% (per Stueck 0,83)',
    '2,99 statt 3,99 -25%',
    'Nur mit SPAR-App-Gutschein: 1,49 Aktion! 1-kg-Netz',
    'Nur mit SPAR-App-Gutschein: 1,99 -43% statt 3,49',
  ].join('\n');
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity: currentValidity,
    pages: [{ pageNumber: 1, text }],
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates,
    },
    source: source('spar'),
    crawlJobId: '000000000000000000000655',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260622-1-obst-gemuse-kw-26/getPdf.ashx',
  });
  const byTitle = new Map(offers.map((offer) => [offer.title, offer]));

  for (const title of [
    'S-BUDGET Avocados genussreif',
    'SPAR Marillen',
    'Apfel Pink Lady',
    'ZESPRI Kiwi Gold',
  ]) {
    assert.ok(byTitle.get(title), title);
    assert.equal(byTitle.get(title).categoryKey, 'obst-gemuese', title);
    assert.equal(byTitle.get(title).validTo.toISOString(), '2026-06-27T21:59:59.999Z');
  }

  assert.equal(byTitle.get('S-BUDGET Avocados genussreif').priceCurrent.amount, 0.79);
  assert.equal(byTitle.get('SPAR Marillen').quantityText, '1 kg');
  assert.equal(byTitle.get('Apfel Pink Lady').priceCurrent.amount, 2.99);
  assert.match(byTitle.get('ZESPRI Kiwi Gold').conditionsText, /SPAR-App-Gutschein/);
  assert.equal([...byTitle.keys()].some((title) => /^Nur mit SPAR-App/i.test(title)), false);
  assert.equal(byTitle.has('S-BUDGET Spitzpaprika Rot'), false);
});

test('accepts selected INTERSPAR Weinwelt Bestseller text-layer offers', () => {
  const currentValidity = {
    validFrom: new Date('2026-05-17T22:00:00.000Z'),
    validTo: new Date('2026-06-10T21:59:59.999Z'),
    validityText: 'Mo., 18.05.26 - Mi., 10.06.26',
  };
  const pages = [
    {
      pageNumber: 3,
      text: [
        'Allacher All Red 2024 Preise wie ab Hof',
        '0,75 L Burgenland',
        'statt 9,99 EUR',
        '7,99* EUR',
        '*ab 2 Flaschen',
      ].join('\n'),
    },
    {
      pageNumber: 4,
      text: [
        'Allacher St. Laurent Ried Apfelgrund 2023',
        '0,75 L Burgenland',
        '10,99 EUR',
        'Allacher All Zero White und All Zero Red',
        '0,75 L Oesterreich',
        'statt 9,99 EUR',
        '7,99* EUR',
        '*ab 2 Flaschen',
      ].join('\n'),
    },
    {
      pageNumber: 5,
      text: [
        'Weinkellerei Schloss Fels Wein & Soda Sommer',
        'Weinkellerei Schloss Fels Wein & Soda Pink Mango',
        '0,33 L Oesterreich',
        'statt 1,29 EUR',
        '0,99* EUR',
        '*ab 2 Flaschen',
        'statt 1,69 EUR',
        '1,39* EUR',
        '*ab 2 Flaschen',
      ].join('\n'),
    },
    {
      pageNumber: 10,
      text: [
        'Gebrueder Nittnaus Zweigelt Freddo 2024',
        '0,75 L Burgenland',
        'statt 7,99 EUR',
        '5,99* EUR',
        '*ab 2 Flaschen',
      ].join('\n'),
    },
    {
      pageNumber: 13,
      text: [
        'Walter Skoff Weissburgunder Suedsteiermark DAC 2025',
        '0,75 L Suedsteiermark',
        'statt 9,99 EUR',
        '7,49 EUR',
      ].join('\n'),
    },
    {
      pageNumber: 16,
      text: [
        'Kattus Frizzante, Frizzante, Muskateller Frizzante Rose',
        '0,75 L Oesterreich',
        'statt 47,96 EUR',
        '39,99 EUR',
        '4,99 EUR',
        'Grundpreis/Liter: 6,65 EUR',
      ].join('\n'),
    },
    {
      pageNumber: 23,
      text: [
        'Don Papa Baroko',
        '0,7 L Philippinen',
        '40 % Vol.',
        'statt 39,90 EUR',
        '34,90 EUR',
      ].join('\n'),
    },
    {
      pageNumber: 24,
      text: [
        'Walter Skoff Sauvignon Blanc Privat Selektion Suedsteiermark DAC 2024',
        '0,75 L Suedsteiermark',
        '1+1 GRATIS',
        'statt 17,99 EUR',
        '8,99* EUR',
        '*ab 2 Flaschen',
      ].join('\n'),
    },
  ];
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'interspar',
    validity: currentValidity,
    pages,
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates,
    },
    source: source('interspar'),
    crawlJobId: '000000000000000000000655',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.interspar.at/weinwelt/260511-4-weinwelt-bestseller-06-2026/getPdf.ashx',
  });
  const byTitle = new Map(offers.map((offer) => [offer.title, offer]));

  for (const [title, price, quantityText] of [
    ['Allacher All Red 2024', 7.99, '0,75 l'],
    ['Allacher St. Laurent Ried Apfelgrund 2023', 10.99, '0,75 l'],
    ['Allacher All Zero White oder All Zero Red', 7.99, '0,75 l'],
    ['Weinkellerei Schloss Fels Wein & Soda Sommer', 0.99, '0,33 l'],
    ['Weinkellerei Schloss Fels Wein & Soda Pink Mango', 1.39, '0,33 l'],
    ['Gebrueder Nittnaus Zweigelt Freddo 2024', 5.99, '0,75 l'],
    ['Walter Skoff Weissburgunder Suedsteiermark DAC 2025', 7.49, '0,75 l'],
    ['Kattus Frizzante oder Muskateller Frizzante Rose', 4.99, '0,75 l'],
    ['Don Papa Baroko', 34.90, '0,7 l'],
    ['Walter Skoff Sauvignon Blanc Privat Selektion Suedsteiermark DAC 2024', 8.99, '0,75 l'],
  ]) {
    const offer = byTitle.get(title);

    assert.ok(offer, title);
    assert.equal(offer.priceCurrent.amount, price, title);
    assert.equal(offer.quantityText, quantityText, title);
  }

  assert.equal(byTitle.get('Allacher All Red 2024').priceReference.amount, 9.99);
  assert.equal(byTitle.get('Don Papa Baroko').categoryKey, 'spirituosen');
  assert.equal(byTitle.get('Walter Skoff Sauvignon Blanc Privat Selektion Suedsteiermark DAC 2024').isMultiBuy, true);
  assert.equal(byTitle.get('Kattus Frizzante oder Muskateller Frizzante Rose').quality.comparisonSafe, false);
  assert.equal(offers.some((offer) => /^1\+1/.test(offer.title)), false);
});

test('accepts selected INTERSPAR Mein Zuhause Sommer text-layer offers', () => {
  const currentValidity = {
    validFrom: new Date('2026-04-06T22:00:00.000Z'),
    validTo: new Date('2026-07-31T21:59:59.999Z'),
    validityText: 'Di., 07.04.26 - Fr., 31.07.26',
  };
  const pages = [
    {
      pageNumber: 3,
      text: [
        'Mein Zuhause',
        'SIMPEX BASIC Stabmixer-Set',
        '400 Watt Power',
        'EUR 24,99',
        'SPAR Butterdose',
        'EUR 6,99',
      ].join('\n'),
    },
    {
      pageNumber: 7,
      text: [
        'SPAR wie frueher Universal-Erde 40 l EUR 7,99',
        'Preise gueltig bis 31.07.2026 und solange der Vorrat reicht.',
      ].join('\n'),
    },
    {
      pageNumber: 20,
      text: [
        'Pamela Reif Topf inkl. Glasdeckel 20 cm EUR 34,99',
        'Pamela Reif Hochrandpfanne 28 cm EUR 34,90',
        'Pamela Reif Universalmesser 22,5 cm EUR 4,99',
        'Pamela Reif Gemuesemesser 19 cm EUR 4,99',
      ].join('\n'),
    },
    {
      pageNumber: 22,
      text: [
        'Naturally Pam by Pamela Reif Porridge Brownie Style oder Apple Pie Style, 350-g-Packung je EUR 5,99',
        'Naturally Pam by Pamela Reif Oat Bar Dark & White oder Chunky Chocolate, 40 g je 2,29',
      ].join('\n'),
    },
    {
      pageNumber: 25,
      text: [
        'SIMPEX BASIC Heissluftfritteuse 4,2 l Fassungsvermoegen, 1.300 Watt EUR 59,90',
      ].join('\n'),
    },
    {
      pageNumber: 33,
      text: [
        'Splendid nature Glasreiniger 750 ml (EUR 2,79/l) EUR 2,09',
        'Splendid Fenster-Wischer-Set 3-fach-Funktion: Microfaser, Ultra-Vlies, Abzieher EUR 7,99',
      ].join('\n'),
    },
    {
      pageNumber: 39,
      text: [
        'Waterdrop Tumbler',
        '1,1 l Fuellmenge',
        'EUR 34,90',
      ].join('\n'),
    },
  ];
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'interspar',
    validity: currentValidity,
    pages,
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates,
    },
    source: source('interspar'),
    crawlJobId: '000000000000000000000656',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.interspar.at/sonderfolder/mein-zuhause-sommer26/getPdf.ashx',
  });
  const byTitle = new Map(offers.map((offer) => [offer.title, offer]));

  for (const [title, price] of [
    ['SIMPEX BASIC Stabmixer-Set', 24.99],
    ['SPAR Butterdose', 6.99],
    ['SPAR wie frueher Universal-Erde', 7.99],
    ['Pamela Reif Topf inkl. Glasdeckel 20 cm', 34.99],
    ['Pamela Reif Hochrandpfanne 28 cm', 34.90],
    ['Pamela Reif Universalmesser oder Gemuesemesser', 4.99],
    ['Naturally Pam by Pamela Reif Porridge', 5.99],
    ['Naturally Pam by Pamela Reif Oat Bar', 2.29],
    ['SIMPEX BASIC Heissluftfritteuse 4,2 l', 59.90],
    ['Splendid nature Glasreiniger', 2.09],
    ['Splendid Fenster-Wischer-Set 3-fach-Funktion', 7.99],
    ['Waterdrop Tumbler 1,1 l', 34.90],
  ]) {
    const offer = byTitle.get(title);

    assert.ok(offer, title);
    assert.equal(offer.priceCurrent.amount, price, title);
    assert.equal(offer.validTo.toISOString(), '2026-07-31T21:59:59.999Z', title);
  }

  assert.equal(byTitle.get('SPAR wie frueher Universal-Erde').quantityText, '40 l');
  assert.equal(byTitle.get('SPAR wie frueher Universal-Erde').quality.comparisonSafe, true);
  assert.equal(byTitle.get('Naturally Pam by Pamela Reif Porridge').quantityText, '350 g');
  assert.equal(byTitle.get('Naturally Pam by Pamela Reif Porridge').categoryPrimary, 'Lebensmittel');
  assert.equal(byTitle.get('Splendid nature Glasreiniger').quantityText, '750 ml');
  assert.equal(byTitle.get('Waterdrop Tumbler 1,1 l').quality.comparisonSafe, false);
});

test('accepts selected current INTERSPAR KW23 text-layer staples without generic relax', () => {
  const currentValidity = {
    validFrom: new Date('2026-06-02T22:00:00.000Z'),
    validTo: new Date('2026-06-17T21:59:59.999Z'),
    validityText: 'Mi., 03.06.26 - Mi., 17.06.26',
  };
  const pageText = [
    'Kimbo Espresso Classico Ganze Bohne, 1-kg-Packung 2349 AKTION!',
    'Lavazza Crema e Gusto oder Espresso Italiano Gemahlen, 250-g-Packung (= per kg 27,96) 699 1 Packung 8,99 ab 2 Packungen je',
    'Mokaflor Miscela Blu Miscela Rossa oder Oro Ganze Bohne, 1-kg-Packung 2299 AKTION!',
    'Noem Oesterreichische Teebutter streichzart 250-g-Packung (= per kg 7,16) 179 1 Packung 2,69 ab 3 Packungen je 2 + 1 GRATIS',
    'S-BUDGET Spare-Ribs aus Oesterreich In Selbstbedienung per kg 1590',
    'S-BUDGET Hendl-Unterkeulen aus Oesterreich 800-g-Packung, in Selbstbedienung (= per kg 6,74) 539',
    'Polnische oder Kaesewurst In Selbstbedienung, 1-kg-Stange 499 1 Packung 6,29 ab 2 Packungen je',
    'Kaesewurst, Krakauer, Wiener oder Champignon Aufschnittwurst aus Oesterreich In Bedienung per 100 g 149 statt 2,09/1,99',
    'Salsiccia 300-g-Packung oder Salsiccia fine pikant 280-g-Packung 399 1 Packung 4,99 ab 2 Packungen je',
    'Persil Pulver 110 WG, 2 Flaschen Persil Gel je 60 WG, 2 Packungen Persil Pulver je 54 WG oder 2 Packungen Persil Discs je 44 WG 2198 je 60 WG',
  ].join('\n');
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'interspar',
    validity: currentValidity,
    pages: [{ pageNumber: 7, text: pageText }],
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: currentValidity,
      candidates,
    },
    source: source('interspar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.interspar.at/steiermark/steiermark_kw23/getPdf.ashx',
  });
  const byTitle = new Map(offers.map((offer) => [offer.title, offer]));

  for (const title of [
    'Kimbo Espresso Classico',
    'Lavazza Crema e Gusto oder Espresso Italiano',
    'Mokaflor Miscela Blu, Rossa oder Oro',
    'Noem Oesterreichische Teebutter streichzart',
    'S-BUDGET Spare-Ribs aus Oesterreich',
    'S-BUDGET Hendl-Unterkeulen aus Oesterreich',
    'Polnische oder Kaesewurst',
    'Kaesewurst, Krakauer, Wiener oder Champignon Aufschnittwurst',
    'Salsiccia oder Salsiccia fine pikant',
    'Persil Gel, Pulver oder Discs',
  ]) {
    assert.ok(byTitle.get(title), title);
  }

  assert.equal(byTitle.get('Lavazza Crema e Gusto oder Espresso Italiano').priceCurrent.amount, 6.99);
  assert.equal(byTitle.get('Noem Oesterreichische Teebutter streichzart').quantityText, '250 g');
  assert.match(byTitle.get('Noem Oesterreichische Teebutter streichzart').conditionsText, /2\+1 gratis/);
  assert.equal(byTitle.get('Persil Gel, Pulver oder Discs').categoryKey, 'waschmittel-reinigung');
  assert.equal(byTitle.get('Salsiccia oder Salsiccia fine pikant').quality.comparisonSafe, false);
});

test('generic SPAR PDF parser strips safe page disclaimer prefixes from product titles', () => {
  const candidates = extractSparPdfCandidates({
    pages: [{
      pageNumber: 2,
      text: [
        'Seite 2 Stattpreise sind unsere bisherigen Verkaufspreise in SPAR-Maerkten. Goesser Maerzen',
        '0,5 Liter',
        'Im Einzelverkauf 1,49',
        '20er-Kiste',
        '29,80',
        '14,90',
      ].join('\n'),
    }],
    sourceRetailerFormat: 'eurospar',
    validity: fixture.validity,
  });
  const offer = candidates.find((candidate) => candidate.title && /Goesser Maerzen/i.test(candidate.title));

  assert.ok(offer);
  assert.equal(offer.title, 'Goesser Maerzen');
  assert.equal(offer.quantityText, '20 x 0.5 l');
  assert.equal(offer.exclusionReason, undefined);
});

test('generic SPAR PDF parser strips safe short-campaign prefixes from product titles', () => {
  const candidates = extractSparPdfCandidates({
    pages: [{
      pageNumber: 4,
      text: [
        'NURfuer kurze ZEIT! Farmerschinken, Bauernschinken oder Jubilaeumsschinken',
        '100 g',
        '1,79',
        'statt 2,19',
      ].join('\n'),
    }],
    sourceRetailerFormat: 'eurospar',
    validity: fixture.validity,
  });
  const offer = candidates.find((candidate) => candidate.title && /Farmerschinken/i.test(candidate.title));

  assert.ok(offer);
  assert.equal(offer.title, 'Farmerschinken, Bauernschinken oder Jubilaeumsschinken');
  assert.equal(offer.quantityText, '100 g');
  assert.equal(offer.exclusionReason, undefined);
});

test('generic SPAR PDF parser rejects legal and broad campaign title fragments', () => {
  const candidates = extractSparPdfCandidates({
    pages: [{
      pageNumber: 2,
      text: [
        'Abgabe nur in Haushaltsmengen; maximal 4 Kisten oder Trays. Von Mi., 3.6. bis Sa., 6.6.2026 -50%-50%auf alle GOESSER BIERE',
        'Bis zuBis zu per Karton',
        '17,16',
        '8,58(per 0,5 Liter 1,09)',
      ].join('\n'),
    }],
    sourceRetailerFormat: 'eurospar',
    validity: fixture.validity,
  });

  assert.equal(candidates.some((candidate) => !candidate.exclusionReason), false);
  assert.ok(candidates.some((candidate) => candidate.exclusionReason === 'generic-fragment-title' || candidate.exclusionReason === 'generic-unclear-product'));
});

test('generic SPAR PDF parser rejects page-number legal prefix titles before product anchors', () => {
  const candidates = extractSparPdfCandidates({
    pages: [{
      pageNumber: 4,
      text: [
        '4 Nicht jeder Artikel in ganz Oesterreich erhaeltlich. Stattpreise sind unsere bisherigen Verkaufspreise in SPAR-Maerkten. Aperol',
        '0,7 Liter',
        '8,99',
      ].join('\n'),
    }],
    sourceRetailerFormat: 'spar',
    validity: fixture.validity,
  });

  assert.equal(candidates.some((candidate) => !candidate.exclusionReason && /^4 Nicht jeder Artikel/i.test(candidate.title)), false);
  assert.ok(candidates.some((candidate) => !candidate.exclusionReason && candidate.title === 'Aperol'));
  assert.ok(candidates.some((candidate) => candidate.exclusionReason === 'generic-fragment-title'));
});

test('generic SPAR PDF parser rejects standalone service-context fragments', () => {
  const candidates = extractSparPdfCandidates({
    pages: [{
      pageNumber: 3,
      text: [
        'In Selbstbedienung,',
        '350-g-Packung',
        '4,59',
      ].join('\n'),
    }],
    sourceRetailerFormat: 'interspar',
    validity: fixture.validity,
  });

  assert.equal(candidates.some((candidate) => !candidate.exclusionReason), false);
  assert.ok(candidates.some((candidate) => candidate.exclusionReason === 'generic-fragment-title'));
});

test('SPAR PDF dedupe keys are source-specific and do not blindly replace aggregators', () => {
  const pages = fixture.pages.filter((page) => page.sourceRetailerFormat === 'eurospar');
  const [offer] = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: {
        validFrom: new Date(fixture.validity.validFrom),
        validTo: new Date(fixture.validity.validTo),
      },
      candidates: extractSparPdfCandidates({
        pages,
        sourceRetailerFormat: 'eurospar',
        validity: fixture.validity,
      }),
    },
    source: source('eurospar'),
    crawlJobId: '000000000000000000000654',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/eurospar/260507-1-flugblatt-kw-19/getPdf.ashx',
  });

  assert.match(offer.dedupeKey, /eurospar-official-flyer-pdf/);
  assert.doesNotMatch(offer.dedupeKey, /aktionsfinder/);
});

test('extracts current KW24 offers from official SPAR viewer pageTexts', async () => {
  const viewerHtml = `
    <script>
      window.staticSettings = {
        "name":"260611-1-Flugblatt KW 24",
        "pageTitle":"Do., 11.06.26 - Mi., 17.06.26",
        "pages":[{"number":1},{"number":2}],
        "pageTexts":[
          "Recheis Goldmarke Recheis Vollkorn oder Naturgenuss Dinkel Teigwaren 1 Pkg. 2,49 ab 2 Packungen je 1,99 Fr. noch zusaetzlich 1,49 SPAR Wassermelone kernarm Klasse 1 per kg statt 1,99 Aktion 1,00 SPAR Steinofen Weizen-Roggenbrot 400 g statt 2,49 1,99 Fussball Donut 6er-Packung 3,99 SPAR Linzerstangerl 200-g-Packung 2,19 Hendl Filetschnitzerl 400-g-Packung ab 2 Packungen je 4,99 Beef Burger 220-g-Packung 3,99 Leberkaese classic Kaese oder Chili Cheese 500-g-Packung 4,49 Kaesewurst Krakauer oder Wiener per 100 g 1,49 Frankfurter 1-kg-Packung 7,99 Schaerdinger Moosbacher 100 g statt 1,79 1,29 Kaerntnermilch Mascarpone 500-g-Packung 3,49 Dr. Oetker Creme Vega 150-g-Becher 1 Becher 1,49 ab 2 Becher je 0,74 Kelly's Erdnuss Linsen Snips oder Donuts Peanuts Caramel ab 2 Packungen je 1,49 Bahlsen Choco Leibniz 125-g-Packung ab 4 Packungen je 1,89",
          "Stiegl Goldbraeu 0,5 Liter 20er-Kiste 29,60 Aktionspreis 14,80 Dr. Oetker High Protein Pudding 400-g-Packung ab 2 Packungen je 1,34 Iglo Hühner Sticks oder Hühner Nuggets 220 g ab 2 Packungen je 2,89 Dr. Oetker Bistro Baguette 250-g-Packung 1,99 Frosta Wokpfanne Paella oder Couscous 500-g-Packung ab 3 Packungen je 3,86 Aperol 0,7 Liter 8,99 Ariel Pulver 100 WG 23,99 SPAR-App-Gutschein 19,99 Axe Duschgel 250 ml 2+1 gratis ab 3 Stueck je 1,92 Zewa Toilettenpapier 20 Rollen 6,79 Plenty Kuechenrolle 6er-Packung 5,49 Syoss Shampoo Haarspray oder Haarschaum ab 3 Stueck je 3,32 Axe Deospray oder Deo Stick ab 2 Stueck je 2,99"
        ]
      };
    </script>
  `;
  const reference = await extractSparViewerReference({
    viewerHtml,
    sourceUrl: 'https://flugblatt.spar.at/steiermark/spar/260611-1-flugblatt-kw-24/',
    sourceRetailerFormat: 'spar',
    maxPages: 24,
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: reference,
    source: source('spar'),
    crawlJobId: '000000000000000000000777',
    region: 'AT',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260611-1-flugblatt-kw-24/',
    pdfSha256: 'viewer-fixture',
  });
  const titles = offers.map((offer) => offer.title);
  const recheisWeekly = offers.find((offer) => /Recheis/i.test(offer.title) && offer.priceCurrent.amount === 1.99);
  const recheisFrSa = offers.find((offer) => /Recheis/i.test(offer.title) && offer.priceCurrent.amount === 1.49);
  const wassermelone = offers.find((offer) => /Wassermelone/i.test(offer.title));
  const ariel = offers.find((offer) => /Ariel/i.test(offer.title));
  const aperol = offers.find((offer) => /Aperol/i.test(offer.title));

  assert.ok(titles.some((title) => /Recheis/i.test(title)));
  assert.ok(titles.some((title) => /Stiegl Goldbraeu/i.test(title)));
  assert.ok(titles.some((title) => /Wassermelone/i.test(title)));
  assert.ok(titles.some((title) => /Hendl Filetschnitzerl/i.test(title)));
  assert.ok(titles.some((title) => /Ariel/i.test(title)));
  assert.ok(titles.some((title) => /Axe/i.test(title)));
  assert.ok(titles.some((title) => /Zewa/i.test(title)));
  assert.ok(titles.some((title) => /Steinofen Weizen-Roggenbrot/i.test(title)));
  assert.ok(titles.some((title) => /Beef Burger/i.test(title)));
  assert.ok(titles.some((title) => /Leberkaese classic/i.test(title)));
  assert.ok(titles.some((title) => /Moosbacher/i.test(title)));
  assert.ok(titles.some((title) => /Creme Vega/i.test(title)));
  assert.ok(titles.some((title) => /Choco Leibniz/i.test(title)));
  assert.ok(titles.some((title) => /High Protein/i.test(title)));
  assert.ok(titles.some((title) => /Bistro Baguette/i.test(title)));
  assert.ok(titles.some((title) => /Frosta/i.test(title)));
  assert.ok(titles.some((title) => /Plenty/i.test(title)));
  assert.equal(dateKey(recheisWeekly.validTo), '2026-06-17');
  assert.equal(recheisFrSa.validFrom.toISOString(), '2026-06-11T22:00:00.000Z');
  assert.equal(recheisFrSa.validTo.toISOString(), '2026-06-13T21:59:59.999Z');
  assert.match(recheisWeekly.conditionsText, /ab 2 Packungen/);
  assert.match(recheisFrSa.conditionsText, /Zusatzpreis/);
  assert.equal(dateKey(wassermelone.validTo), '2026-06-13');
  assert.equal(ariel.priceCurrent.amount, 23.99);
  assert.match(ariel.conditionsText, /SPAR-App-Gutschein 19,99/);
  assert.equal(ariel.categoryPrimary, 'Haushalt');
  assert.equal(ariel.categorySecondary, 'Waschmittel & Reinigung');
  assert.equal(aperol.categoryPrimary, 'Getraenke');
  assert.equal(aperol.categorySecondary, 'Spirituosen');
});

test('current viewer normalization rejects an offer-level validity ending before the flyer starts', () => {
  const currentSource = {
    ...source('interspar'),
    crawlPolicy: { currentSnapshot: true },
  };
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: {
      validity: {
        validFrom: new Date('2026-08-26T22:00:00.000Z'),
        validTo: new Date('2026-09-09T21:59:59.999Z'),
      },
      candidates: [{
        id: 'stale-offer-override',
        page: 20,
        title: 'SIMPEX BASIC Stabmixer',
        brand: 'SIMPEX BASIC',
        price: 9.99,
        quantityText: '1 Stueck',
        validToOverride: new Date('2026-07-31T21:59:59.999Z'),
        rawText: 'SIMPEX BASIC Stabmixer 9,99',
      }],
    },
    source: currentSource,
    crawlJobId: '000000000000000000000778',
    region: 'Steiermark',
    pdfUrl: 'https://flugblatt.interspar.at/steiermark/steiermark_kw35/',
  });

  assert.deepEqual(offers, []);
});

test('extracts current KW24 offers from official INTERSPAR viewer pageTexts', async () => {
  const viewerHtml = `
    <script>
      window.staticSettings = {
        "name":"260601-1-Online-Flugblatt Steiermark KW 24",
        "pageTitle":"Do., 11.06.26 - Mi., 17.06.26",
        "pages":[{"number":1}],
        "pageTexts":[
          "Puntigamer Maerzen 24er-Tray ab 24 Dosen je 0,69 Milka Schokolade 190 g 2,66 Lotus Biscoff Doppelkeks 150 g ab 3 Rollen je 1,32 S-BUDGET Lachsfilet frisch mit Haut per kg 19,90 Bio-Hendl-Oberkeule 500-g-Packung Fr/Sa Zusatzpreis 5,39 S-BUDGET Leberkaese aus Oesterreich 500-g-Packung 3,99 De Cecco Pasta 500-g-Packung 1 Pkg. 2,99 ab 2 Packungen je 1,99 Barilla Collezione Pasta 1 Pkg. 2,99 ab 2 Packungen je 1,99 S-BUDGET Energy Drink 0,25 Liter 24er-Tray 6,96 S-BUDGET Cashews 150-g-Packung 1,99 S-BUDGET Chocolate Chip Cookies 225-g-Packung 1,79 S-BUDGET Grillsaucen 300-ml-Flasche 1,49 S-BUDGET Kaminwurzerl 300-g-Packung 4,98 Santa Maria Tortilla 320-371 g 2,49 Santa Maria Gewuerzmischungen 28-g-Packung 0,99 La Fiesta Mini Wraps 250-g-Packung 1,19 La Fiesta XXL Wraps 468-g-Packung 1,79"
        ]
      };
    </script>
  `;
  const reference = await extractSparViewerReference({
    viewerHtml,
    sourceUrl: 'https://flugblatt.interspar.at/steiermark/steiermark_kw24/',
    sourceRetailerFormat: 'interspar',
    maxPages: 24,
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: reference,
    source: source('interspar'),
    crawlJobId: '000000000000000000000778',
    region: 'AT',
    pdfUrl: 'https://flugblatt.interspar.at/steiermark/steiermark_kw24/',
    pdfSha256: 'viewer-fixture',
  });
  const titles = offers.map((offer) => offer.title);
  const bioHendlWeekly = offers.find((offer) => /Bio-Hendl-Oberkeule/i.test(offer.title) && offer.priceCurrent.amount === 7.19);
  const bioHendlFrSa = offers.find((offer) => /Bio-Hendl-Oberkeule/i.test(offer.title) && offer.priceCurrent.amount === 5.39);
  const lachsfilet = offers.find((offer) => /S-BUDGET Lachsfilet/i.test(offer.title));

  assert.equal(dateKey(reference.validity.validTo), '2026-06-17');
  assert.ok(titles.some((title) => /Puntigamer/i.test(title)));
  assert.ok(titles.some((title) => /Milka/i.test(title)));
  assert.ok(titles.some((title) => /Lotus Biscoff/i.test(title)));
  assert.ok(titles.some((title) => /S-BUDGET Lachsfilet/i.test(title)));
  assert.ok(titles.some((title) => /Bio-Hendl-Oberkeule/i.test(title)));
  assert.ok(titles.some((title) => /S-BUDGET Leberkaese/i.test(title)));
  assert.ok(titles.some((title) => /De Cecco Pasta/i.test(title)));
  assert.ok(titles.some((title) => /Barilla Collezione/i.test(title)));
  assert.ok(titles.some((title) => /Energy Drink/i.test(title)));
  assert.ok(titles.some((title) => /Cashews/i.test(title)));
  assert.ok(titles.some((title) => /Chocolate Chip Cookies/i.test(title)));
  assert.ok(titles.some((title) => /Grillsaucen/i.test(title)));
  assert.ok(titles.some((title) => /Kaminwurzerl/i.test(title)));
  assert.ok(titles.some((title) => /Santa Maria Tortilla/i.test(title)));
  assert.ok(titles.some((title) => /Mini Wraps/i.test(title)));
  assert.equal(dateKey(bioHendlWeekly.validTo), '2026-06-17');
  assert.equal(bioHendlFrSa.validFrom.toISOString(), '2026-06-11T22:00:00.000Z');
  assert.equal(bioHendlFrSa.validTo.toISOString(), '2026-06-13T21:59:59.999Z');
  assert.match(bioHendlFrSa.conditionsText, /Zusatzpreis/);
  assert.equal(lachsfilet.validFrom.toISOString(), '2026-06-11T22:00:00.000Z');
  assert.equal(lachsfilet.validTo.toISOString(), '2026-06-13T21:59:59.999Z');
});

test('extracts current SPAR enjoy KW26 offers from official PDF text', () => {
  const validity = {
    validFrom: new Date('2026-06-24T22:00:00.000Z'),
    validTo: new Date('2026-06-30T21:59:59.999Z'),
  };
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity,
    pages: [
      {
        pageNumber: 1,
        text: [
          'Angebote gueltig ab Donnerstag, 25.6. bis Dienstag, 30.6.2026',
          'SPAR enjoy Salate versch. Sorten, 220-250 g 3,49 statt 4,29',
          'SPAR enjoy Sandwich versch. Sorten, gekuehlt, 160 g - 170 g 1,79 statt 2,29',
          'SPAR enjoy Smoothie & Water Mango Tango oder Pink Dragon 0,33 Liter 1 Fl. 1,49 ab 2 Fl. je 0,99',
        ].join(' '),
      },
      {
        pageNumber: 2,
        text: [
          'SPAR enjoy by Neni Salate gekuehlt, taeglich frisch zubereitet, versch. Sorten, 200-225 g 1,99 statt 2,79',
          'SPAR enjoy Wraps gekuehlt, taeglich frisch zubereitet, versch. Sorten, 180-200 g 1,99 statt 2,39',
          'SPAR enjoy Laugenbaguette mit Thunfisch oder mit Cheddar gekuehlt, 180 g 2,29 statt 2,79',
          'SPAR enjoy Nudelsalat mit Huehnerbruststreifen oder Nudel Thunfischsalat gekuehlt, 170 g 2,29 statt 2,79',
        ].join(' '),
      },
      {
        pageNumber: 3,
        text: [
          'SPAR enjoy Bubble Tea Waldbeeregeschmack vegan, 0,45 Liter 1 Be. 3,99 ab 2 Be. je 2,99',
          'SPAR enjoy Dark Chocolate oder Chocolate Chip Cookie 60 g Aktion 1,29',
        ].join(' '),
      },
      {
        pageNumber: 4,
        text: [
          'SPAR Feine Kueche Kraeuter- oder Knoblauchbaguette gekuehlt, vegan, 175 g 1 Pkg. 1,19 ab 2 Pkg. je 0,79',
          'SPAR Feine Kueche Fertiggerichte gekuehlt, versch. Sorten, 330-450 g 1 Pkg. 3,69 ab 2 Pkg. je 2,99',
          'SPAR Feine Kueche Knoedel tiefgekuehlt, versch. Sorten, 400 g 1 Pkg. 3,29 ab 2 Pkg. je 2,29',
          'SPAR Feine Kueche Mohnnudeln tiefgekuehlt, 500 g 1 Pkg. 2,49 ab 2 Pkg. je 1,99',
          'SPAR Feine Kueche 4 Huehner-Schnitzel tiefgekuehlt, 500 g 1 Pkg. 6,79 ab 2 Pkg. je 5,99',
          'SPAR Feine Kueche Cheeseburger gekuehlt, 250 g 1 Pkg. 2,49 ab 2 Pkg. je 1,99',
          'SPAR Feine Kueche Kaerntner Kasnudel gekuehlt, 300 g 1 Pkg. 2,99 ab 2 Pkg. je 2,49',
        ].join(' '),
      },
    ],
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: { validity, candidates },
    source: source('spar'),
    crawlJobId: '000000000000000000000778',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260625-2-spar-enjoy-kw-26/getPdf.ashx',
    pdfSha256: 'kw26-spar-enjoy-fixture',
  });
  const titles = offers.map((offer) => offer.title);

  assert.ok(titles.includes('SPAR enjoy Salate'));
  assert.ok(titles.includes('SPAR enjoy Sandwich'));
  assert.ok(titles.includes('SPAR enjoy Smoothie & Water'));
  assert.ok(titles.includes('SPAR enjoy by Neni Salate'));
  assert.ok(titles.includes('SPAR enjoy Wraps'));
  assert.ok(titles.includes('SPAR enjoy Laugenbaguette'));
  assert.ok(titles.includes('SPAR enjoy Nudelsalat'));
  assert.ok(titles.includes('SPAR enjoy Bubble Tea'));
  assert.ok(titles.includes('SPAR enjoy Cookie'));
  assert.ok(titles.includes('SPAR Feine Kueche Kraeuter- oder Knoblauchbaguette'));
  assert.ok(titles.includes('SPAR Feine Kueche Fertiggerichte'));
  assert.ok(titles.includes('SPAR Feine Kueche Knoedel'));
  assert.ok(titles.includes('SPAR Feine Kueche Mohnnudeln'));
  assert.ok(titles.includes('SPAR Feine Kueche 4 Huehner-Schnitzel'));
  assert.ok(titles.includes('SPAR Feine Kueche Cheeseburger'));
  assert.ok(titles.includes('SPAR Feine Kueche Kaerntner Kasnudel'));
  assert.equal(offers.find((offer) => offer.title === 'SPAR enjoy Smoothie & Water').priceCurrent.amount, 0.99);
  assert.equal(offers.find((offer) => offer.title === 'SPAR Feine Kueche 4 Huehner-Schnitzel').priceCurrent.amount, 5.99);
  assert.equal(offers.every((offer) => offer.quality.comparisonSafe === false), true);
});

test('extracts SPAR KW25 current cover controls from official PDF text', () => {
  const validity = {
    validFrom: new Date('2026-06-17T22:00:00.000Z'),
    validTo: new Date('2026-06-30T21:59:59.999Z'),
  };
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity,
    pages: [
      {
        pageNumber: 1,
        text: [
          'KW 25 Angebote gueltig ab Donnerstag, 18.6. bis Dienstag, 30.6.2026',
          'Nektarinen-Angebot gueltig bis Sa., 20.6.2026',
          'Nivea Creme Dose 250 ml oder Creme Soft Tiegel 200 ml',
          '1 Fl. 17,99 ab 2 Fl. je 8,99(per Liter 12,84) 1 + 1 GRATIS Aperol 0,7 Liter',
          '7,79 statt 9,09 Ersparnis 1,30 (per kg 11,13)',
          'S-BUDGET Hendlfilet aus Oesterreich, in Selbstbedienung, 700 g',
          '-25% auf alle NIVEA-PRODUKTE und LABELLO 1 Stk. 4,39 ab 2 Stk. je 3,49 2,62',
          'fruchtig, frische SPAR Nektarinen Klasse 1, 1-kg-Tasse statt 2,99 Aktion! 2,-',
        ].join(' '),
      },
    ],
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: { validity, candidates },
    source: source('spar'),
    crawlJobId: '000000000000000000000779',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260618-1-flugblatt-kw-25/getPdf.ashx',
    pdfSha256: 'kw25-spar-cover-fixture',
  });

  const aperol = offers.find((offer) => offer.title === 'Aperol');
  const hendlfilet = offers.find((offer) => /Hendlfilet/i.test(offer.title));
  const nektarinen = offers.find((offer) => /Nektarinen/i.test(offer.title));
  const nivea = offers.find((offer) => /Nivea/i.test(offer.title));

  assert.ok(aperol);
  assert.equal(aperol.priceCurrent.amount, 8.99);
  assert.match(aperol.conditionsText, /1\+1 gratis/);
  assert.ok(hendlfilet);
  assert.equal(hendlfilet.priceCurrent.amount, 7.79);
  assert.equal(hendlfilet.priceReference.amount, 9.09);
  assert.equal(hendlfilet.quantityText, '700 g');
  assert.ok(nektarinen);
  assert.equal(nektarinen.priceCurrent.amount, 2.00);
  assert.equal(dateKey(nektarinen.validTo), '2026-06-20');
  assert.ok(nivea);
  assert.equal(nivea.priceCurrent.amount, 3.49);
  assert.equal(nivea.priceReference.amount, 4.39);
  assert.match(nivea.conditionsText, /NIVEA-Produkte/);
});

test('extracts INTERSPAR KW25 current cover controls from official PDF text', () => {
  const validity = {
    validFrom: new Date('2026-06-17T22:00:00.000Z'),
    validTo: new Date('2026-06-30T21:59:59.999Z'),
  };
  const candidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'interspar',
    validity,
    pages: [
      {
        pageNumber: 1,
        text: [
          'Angebote gueltig von Do, 18.6. bis Di, 30.6.2026',
          'Rindsschnitzel aus Oesterreich Geschnitten, nur 2-3 % Fett. In Bedienung per kg Niedrigster 30-Tage-Preis 19,99 1499',
          'Zewa Simply Soft Toilettenpapier 3-lagig, verschiedene Sorten, 20er-Packung oder Zewa Premium Toilettenpapier 4-lagig, 18er-Packung 679',
          'Aperol 0,7-Liter-Flasche (= per Liter 12,84) 899 1 Flasche 17,99 ab 2 Flaschen je 1 + 1 GRATIS',
        ].join(' '),
      },
    ],
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: { validity, candidates },
    source: source('interspar'),
    crawlJobId: '000000000000000000000780',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.interspar.at/steiermark/steiermark_kw25/getPdf.ashx',
    pdfSha256: 'kw25-interspar-cover-fixture',
  });

  const aperol = offers.find((offer) => offer.title === 'Aperol');
  const rindsschnitzel = offers.find((offer) => /Rindsschnitzel/i.test(offer.title));
  const zewa = offers.find((offer) => /Zewa/i.test(offer.title));

  assert.ok(aperol);
  assert.equal(aperol.priceCurrent.amount, 8.99);
  assert.match(aperol.conditionsText, /1\+1 gratis/);
  assert.ok(rindsschnitzel);
  assert.equal(rindsschnitzel.priceCurrent.amount, 14.99);
  assert.equal(rindsschnitzel.quantityText, '1 kg');
  assert.ok(zewa);
  assert.equal(zewa.priceCurrent.amount, 6.79);
  assert.equal(zewa.quantityText, '18-20 Rollen');
});

test('extracts SPAR KW25 current page 11 frozen fish and pizza controls from official PDF text', () => {
  const validity = {
    validFrom: new Date('2026-06-17T22:00:00.000Z'),
    validTo: new Date('2026-06-30T21:59:59.999Z'),
  };
  const pages = [
    {
      pageNumber: 11,
      text: [
        'Freitag & Samstag Angebote gueltig bei 11',
        '1 Pkg. 8,99 ab 2 Pkg. je 4,49 (per kg 17,96-22,45) 1 + 1 GRATIS',
        'Iglo Feinste Backhendlstreifen versch. Sorten, tiefgekuehlt, 200-250 g',
        '1 Pkg. 16,99 ab 2 Pkg. je 8,49 (per kg 17,69-42,45) 1 + 1 GRATIS',
        'Iglo Dorsch natur oder paniert, Dorsch in Knusperbroesel, Zander Naturfilets, Premium Atlantik Lachs, Forelle Naturfilets oder ASC Goldbrasse',
        '100% Filet aus nachhaltigem Fischfang, tiefgekuehlt, 200-480 g',
        '1 Pkg. 3,99 ab 3 Pkg. je 2,66 (per kg 6,82-8,31) 2 + 1 GRATIS',
        'Dr. Oetker Pizza Ristorante versch. Sorten, tiefgekuehlt, 320-390 g',
        'Bio-Lachsfilet aus Aquakultur Norwegen, in Selbstbedienung, 200 g',
        'Nur gueltig am Fr., 19.6. bis Sa., 20.6.2026 Mengenvorteil 1 Pkg. 7,99 ab 2 Pkg. je 6,99 (per kg 34,95)',
      ].join(' '),
    },
  ];
  const baseline = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity,
    pages: [{ pageNumber: 11, text: 'Freitag & Samstag Angebote gueltig bei 11 Rabattmarkerl ohne konkretes Produkt 1 + 1 GRATIS' }],
  }).filter((candidate) => !candidate.exclusionReason);
  const candidates = extractSparPdfCandidates({ sourceRetailerFormat: 'spar', validity, pages });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: { validity, candidates },
    source: source('spar'),
    crawlJobId: '000000000000000000000781',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260618-1-flugblatt-kw-25/getPdf.ashx',
    pdfSha256: 'kw25-spar-page-11-fixture',
  });

  const backhendl = offers.find((offer) => /Backhendlstreifen/i.test(offer.title));
  const igloFish = offers.find((offer) => /Iglo Dorsch/i.test(offer.title));
  const pizza = offers.find((offer) => /Pizza Ristorante/i.test(offer.title));
  const bioLachs = offers.find((offer) => offer.title === 'Bio-Lachsfilet');
  const titles = offers.map((offer) => offer.title);

  assert.ok(offers.length > baseline.length);
  assert.ok(backhendl);
  assert.equal(backhendl.priceCurrent.amount, 4.49);
  assert.equal(backhendl.quantityText, '200-250 g');
  assert.equal(dateKey(backhendl.validTo), '2026-06-30');
  assert.ok(igloFish);
  assert.equal(igloFish.priceCurrent.amount, 8.49);
  assert.match(igloFish.categorySecondary, /Fleisch|Fisch/);
  assert.ok(pizza);
  assert.equal(pizza.priceCurrent.amount, 2.66);
  assert.equal(pizza.quantityText, '320-390 g');
  assert.ok(bioLachs);
  assert.equal(bioLachs.priceCurrent.amount, 6.99);
  assert.equal(bioLachs.validFrom.toISOString(), '2026-06-18T22:00:00.000Z');
  assert.equal(bioLachs.validTo.toISOString(), '2026-06-20T21:59:59.999Z');
  assert.equal(titles.some((title) => /Freitag|Rabattmarkerl|GRATIS/i.test(title)), false);
});

test('extracts selected INTERSPAR KW25 current missed page offers without fragment explosion', () => {
  const validity = {
    validFrom: new Date('2026-06-17T22:00:00.000Z'),
    validTo: new Date('2026-06-30T21:59:59.999Z'),
  };
  const pages = [
    {
      pageNumber: 4,
      text: [
        'GENIESSEN GEHT AUCH OHNE! Goesser Naturradler Zitrone alkoholfrei oder Naturgold alkoholfrei 0,33-Liter-Flasche (= per 0,5 Liter 1,08)',
        '0 71 24er-Tray 17,04 1 Flasche 1,43 ab 24 Flaschen je 12 + 12 GRATIS',
        'La Gioiosa Sparkling alkoholfrei oder La Gioiosa Sparkling Rose alkoholfrei Ideal als Aperitif. 0,75-Liter-Flasche (= per Liter 6,65)',
        '4 99 statt 6,99 28% billiger!',
      ].join(' '),
    },
    {
      pageNumber: 5,
      text: [
        'Isostar Sport-Riegel 3 x 40 g oder Protein-Riegel 3 x 35 g, verschiedene Sorten (= per kg 20,75/23,71)',
        '2 49 1 Packung 3,69 ab 2 Packungen je 32% billiger! MENGEN VORTEIL',
        'Schaerdinger Protein Traum Pudding Vanille oder Schoko, 200-g-Becher (= per kg 4,30)',
        '0 86 1 Becher 1,29 ab 3 Becher je 2 + 1 GRATIS',
        'Nocco Verschiedene Sorten, jetzt NEU: Grand Sour, 0,33-Liter-Dose (= per Liter 5,42)',
        '1 79 1 Dose 1,99 ab 2 Dosen je Sie sparen 0,40!',
      ].join(' '),
    },
    {
      pageNumber: 6,
      text: 'weinwelt.at Pitu Cachaca Brasilien 0,7-Liter-Flasche (= per Liter 21,41) 14 99 AKTION!',
    },
    {
      pageNumber: 9,
      text: 'Rindfleischlasagne oder Spinatlasagne In allen INTERSPAR-Maerkten mit Heisser Theke erhaeltlich, per Stueck 23% billiger! 4 99 statt 6,49',
    },
    {
      pageNumber: 10,
      text: 'Branzino Aus Aquakultur Kroatien. In Bedienung per 100 g (= per kg 24,90) Angebot gueltig bis Mi, 8.7. 2 49 AKTION!',
    },
    {
      pageNumber: 11,
      text: [
        'Bio-Mohnflesserl Der Gebaeckklassiker aus Oesterreich, frisch gebacken aus der INTERSPAR-Backstube.',
        '0 83 1 Stueck 1,25 bei 3 Stueck je 2+1 GRATIS',
        'Focaccia Tomate & Oliven Frisch gebacken aus der INTERSPAR-Backstube. 350 g per Stueck (= per kg 9,40)',
        '3 29 statt 3,79 Sie sparen 0,50!',
      ].join(' '),
    },
    {
      pageNumber: 13,
      text: [
        'Thomy Ketch&Co, Mayonnaise oder Hot Sriracha Mayo 170-g-190-g-Tube (= per kg 10,47/11,71) 1 99 statt 2,29/2,79',
        'Hornig Caffe Crema oder Caffe Crema Intenso Ganze Bohne, 1-kg-Packung 23 99 statt 29,99 20% billiger!',
      ].join(' '),
    },
    {
      pageNumber: 15,
      text: [
        'Somat Vorteilspack Caps 75/84 WG oder Tabs 84/100 WG (= per WG 0,13-0,18) 13 49 AKTION!',
        'Felix Katzensnacks 180-g-200-g-Maxi Pack oder Felix Deli Moments 12 x 10-g-Maxi Pack, verschiedene Sorten (= per kg 17,45-29,08)',
        '3 49 1 Packung 3,99 ab 2 Packungen je Sie sparen 1,-! MENGEN VORTEIL',
        'Prozentaktion gilt auch auf Aktionspreise und bereits reduzierte Ware. Nicht mit anderen Prozentaktionen und Gutscheinen kombinierbar.',
      ].join(' '),
    },
    {
      pageNumber: 18,
      text: [
        'SPAR Alufolie 30 m Zum Backen, Grillen und Frischhalten geeignet.',
        '2 99 1 Stueck 3,49 ab 2 Stueck je Sie sparen 1,-! MENGEN VORTEIL',
        'DeLonghi Kaffeevollautomat Mod.-Nr.: ECAM220.20W, 2 Jahre Garantie',
        'Sie sparen 50,-! 299,- statt 349,- interspar.at 15 bar Pumpendruck',
      ].join(' '),
    },
  ];
  const candidates = extractSparPdfCandidates({ sourceRetailerFormat: 'interspar', validity, pages });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: { validity, candidates },
    source: source('interspar'),
    crawlJobId: '000000000000000000000782',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.interspar.at/steiermark/steiermark_kw25/getPdf.ashx',
    pdfSha256: 'kw25-interspar-current-missed-pages-fixture',
  });
  const byTitle = (pattern) => offers.find((offer) => pattern.test(offer.title));
  const titles = offers.map((offer) => offer.title);

  assert.ok(offers.length >= 14);
  assert.ok(offers.length < 30);
  assert.equal(byTitle(/Goesser Naturradler/i).priceCurrent.amount, 0.71);
  assert.equal(byTitle(/La Gioiosa/i).priceCurrent.amount, 4.99);
  assert.equal(byTitle(/Pitu/i).priceCurrent.amount, 14.99);
  assert.equal(byTitle(/Isostar/i).priceCurrent.amount, 2.49);
  assert.equal(byTitle(/Protein Traum/i).priceCurrent.amount, 0.86);
  assert.equal(byTitle(/Nocco/i).priceCurrent.amount, 1.79);
  assert.equal(byTitle(/Rindfleischlasagne/i).priceCurrent.amount, 4.99);
  assert.equal(byTitle(/Branzino/i).priceCurrent.amount, 2.49);
  assert.equal(byTitle(/Branzino/i).validTo.toISOString(), '2026-07-08T21:59:59.999Z');
  assert.equal(byTitle(/Bio-Mohnflesserl/i).priceCurrent.amount, 0.83);
  assert.equal(byTitle(/Focaccia/i).priceCurrent.amount, 3.29);
  assert.equal(byTitle(/Thomy/i).priceCurrent.amount, 1.99);
  assert.equal(byTitle(/Hornig/i).priceCurrent.amount, 23.99);
  assert.equal(byTitle(/Somat/i).priceCurrent.amount, 13.49);
  assert.equal(byTitle(/Felix Katzensnacks/i).categoryPrimary, 'Tierbedarf');
  assert.equal(byTitle(/SPAR Alufolie/i).priceCurrent.amount, 2.99);
  assert.equal(byTitle(/DeLonghi Kaffeevollautomat/i).priceCurrent.amount, 299.00);
  assert.equal(titles.some((title) => /Prozentaktion|Stattpreise|weinwelt|GENIESSEN GEHT/i.test(title)), false);
});

test('extracts KW25 current target offers from productive textlayer variants', () => {
  const validity = {
    validFrom: new Date('2026-06-17T22:00:00.000Z'),
    validTo: new Date('2026-06-30T21:59:59.999Z'),
  };
  const sparCandidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'spar',
    validity,
    pages: [
      {
        pageNumber: 11,
        text: [
          'Dr. Oetker Ristorante Pizza versch. Sorten, tiefgekuehlt, 320-390 g',
          '1 Pkg. 3,99 ab 3 Pkg. je 2 66 2 + 1 GRATIS',
          'Bio Lachsfilet aus Aquakultur Norwegen, in Selbstbedienung, 200 g',
          '1 Pkg. 7,99 ab 2 Pkg. je 6 99',
        ].join(' '),
      },
    ],
  });
  const sparOffers = normalizeSparPdfCandidatesToOffers({
    pdfReference: { validity, candidates: sparCandidates },
    source: source('spar'),
    crawlJobId: '000000000000000000000783',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.spar.at/steiermark/spar/260618-1-flugblatt-kw-25/getPdf.ashx',
    pdfSha256: 'kw25-spar-textlayer-variant-fixture',
  });

  const pizza = sparOffers.find((offer) => /Pizza Ristorante/i.test(offer.title));
  const bioLachs = sparOffers.find((offer) => offer.title === 'Bio-Lachsfilet');

  assert.ok(pizza);
  assert.equal(pizza.priceCurrent.amount, 2.66);
  assert.equal(pizza.quantityText, '320-390 g');
  assert.equal(pizza.categoryPrimary, 'Lebensmittel');
  assert.equal(pizza.quality.comparisonSafe, false);
  assert.ok(bioLachs);
  assert.equal(bioLachs.priceCurrent.amount, 6.99);
  assert.equal(bioLachs.quantityText, '200 g');
  assert.equal(bioLachs.categoryPrimary, 'Lebensmittel');

  const intersparCandidates = extractSparPdfCandidates({
    sourceRetailerFormat: 'interspar',
    validity,
    pages: [
      {
        pageNumber: 4,
        text: [
          'Goesser Naturradler Zitrone alkoholfrei oder Naturgold alkoholfrei 0,33-Liter-MEHRWEG-Flasche',
          '0 71 1 Flasche 1,43 ab 24 Flaschen je 12 + 12 GRATIS',
        ].join(' '),
      },
      {
        pageNumber: 5,
        text: [
          'Schardinger Protein Traum Pudding Vanille oder Schoko, 200-g-Becher',
          '0 86 1 Becher 1,29 ab 3 Becher je 2 + 1 GRATIS',
          'Nocco verschiedene Sorten, 0,33-Liter-EINWEG-Dose',
          '1 79 1 Dose 1,99 ab 2 Dosen je',
        ].join(' '),
      },
      {
        pageNumber: 11,
        text: [
          'SPAR Natur Pur BIO-Mohnflesserl 100% Bio-Mehl aus Oesterreich',
          '0 83 1 Stk. 1,25 bei 3 Stk. je 2+1 GRATIS',
          'Focaccia Tomate und Oliven frisch gebacken, 350 g per Stueck',
          '3 29 statt 3,79',
        ].join(' '),
      },
      {
        pageNumber: 15,
        text: [
          'Felix Deli Moments oder Felix Katzensnacks 180-g-200-g-Maxi Pack, verschiedene Sorten',
          '3 49 1 Packung 3,99 ab 2 Packungen je',
        ].join(' '),
      },
    ],
  });
  const intersparOffers = normalizeSparPdfCandidatesToOffers({
    pdfReference: { validity, candidates: intersparCandidates },
    source: source('interspar'),
    crawlJobId: '000000000000000000000784',
    region: 'Grossraum Graz',
    pdfUrl: 'https://flugblatt.interspar.at/steiermark/steiermark_kw25/getPdf.ashx',
    pdfSha256: 'kw25-interspar-textlayer-variant-fixture',
  });
  const byTitle = (pattern) => intersparOffers.find((offer) => pattern.test(offer.title));

  assert.equal(byTitle(/Goesser Naturradler/i).priceCurrent.amount, 0.71);
  assert.equal(byTitle(/Protein Traum/i).priceCurrent.amount, 0.86);
  assert.equal(byTitle(/Nocco/i).priceCurrent.amount, 1.79);
  assert.equal(byTitle(/Bio-Mohnflesserl/i).priceCurrent.amount, 0.83);
  assert.equal(byTitle(/Focaccia/i).priceCurrent.amount, 3.29);
  assert.equal(byTitle(/Felix Katzensnacks/i).priceCurrent.amount, 3.49);
  assert.equal(intersparOffers.some((offer) => /Prozentaktion|Stattpreise|GRATIS/i.test(offer.title)), false);
});
