const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  PDF_CATEGORY_MISMATCH_REVIEW_REASON,
} = require('../src/services/crawl/pdfOfferParsing');
const {
  PARSER_VERSION,
  SOURCE_TYPE,
  buildRejectedCandidateSamples,
  extractSparPdfCandidates,
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
  assert.equal(accepted.some((candidate) => /^oder Monte/.test(candidate.title)), false);
  assert.ok(accepted.some((candidate) => candidate.title === 'Coca-Cola Limonaden versch. Sorten,'));
  assert.ok(candidates.some((candidate) => candidate.exclusionReason === 'generic-fragment-title'));
  assert.ok(candidates.some((candidate) => candidate.exclusionReason === 'generic-merge-risk'));
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
  const currentValidity = {
    validFrom: new Date('2026-05-20T12:00:00.000Z'),
    validTo: new Date('2026-06-02T12:00:00.000Z'),
  };
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
  const currentValidity = {
    validFrom: new Date('2026-05-20T12:00:00.000Z'),
    validTo: new Date('2026-06-02T12:00:00.000Z'),
  };
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
