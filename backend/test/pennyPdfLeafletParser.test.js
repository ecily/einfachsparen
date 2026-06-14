const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseNumericAmount,
  extractCandidatesFromPage,
  summarizeRejections,
  normalizePennyPdfCandidatesToOffers,
  PARSER_VERSION,
  PENNY_PDF_SOURCE_KEY,
  dateKey,
} = require('../src/services/crawl/pennyPdfLeafletParser');
const { enrichOfferForStorage } = require('../src/services/crawl/offerAuditEnrichment');
const {
  validatePdfOfferCandidate,
  buildPdfSourceMetadata,
} = require('../src/services/crawl/pdfOfferParsing');
const {
  buildPennyDiagnosticsReport,
} = require('../scripts/diagnosePennySources');
const {
  isOfferFreshForActiveUse,
} = require('../src/services/offers/offerFreshness');

function pennySource() {
  return {
    _id: '000000000000000000000123',
    retailerKey: 'penny',
    retailerName: 'PENNY',
    channel: 'official-flyer',
    sourceUrl: 'https://www.penny.at/angebote/flugblaetter',
  };
}

function pennyKw24Validity() {
  return {
    validFrom: new Date('2026-06-11T12:00:00.000Z'),
    validTo: new Date('2026-06-17T12:00:00.000Z'),
    detectedDates: ['2026-06-11', '2026-06-17'],
  };
}

test('parses common PDF price formats defensively', () => {
  assert.equal(parseNumericAmount('nur 1,49'), 1.49);
  assert.equal(parseNumericAmount('€ 1.49'), 1.49);
  assert.equal(parseNumericAmount('1 49'), 1.49);
  assert.equal(parseNumericAmount('12.-'), 12);
  assert.equal(parseNumericAmount('0.690.99'), null);
  assert.equal(parseNumericAmount('CAPSA Nespresso- 1 Kapsel=0.29 XXL'), null);
  assert.equal(parseNumericAmount('RAPSO REINES RAPS\u00d6L 0,75 l 1 l=5.32'), null);
  assert.equal(parseNumericAmount('Gueltig von 01.05.2026 bis 07.05.2026'), null);
});

test('rejects PDF candidates without clear product title and price', () => {
  assert.deepEqual(validatePdfOfferCandidate({
    title: '1.49',
    price: 1.49,
  }), { ok: false, reason: 'implausible-title' });

  assert.deepEqual(validatePdfOfferCandidate({
    title: 'Seite 3',
    price: 1.49,
  }), { ok: false, reason: 'bad-title-line' });

  assert.deepEqual(validatePdfOfferCandidate({
    title: 'G\u00fcnstig.',
    price: 1.49,
  }), { ok: false, reason: 'bad-title-line' });

  assert.deepEqual(validatePdfOfferCandidate({
    title: 'G\u00fcnstig. DALLMAYR CAPSA Nespresso-',
    price: 0.29,
  }), { ok: false, reason: 'bad-title-line' });

  assert.deepEqual(validatePdfOfferCandidate({
    title: '90 WG/100 WG od. DISCS Universal, 76 WG',
    price: 17.99,
  }), { ok: false, reason: 'implausible-title' });

  assert.deepEqual(validatePdfOfferCandidate({
    title: 'PACK AB 2 ST\u00dcCK',
    price: 3.19,
  }), { ok: false, reason: 'implausible-title' });

  assert.deepEqual(validatePdfOfferCandidate({
    title: 'div. Sorten, 1,35 l1 GREENLAND BROKKOLI',
    price: 1,
  }), { ok: false, reason: 'implausible-title' });

  assert.deepEqual(validatePdfOfferCandidate({
    title: 'Bananen 1 kg',
    price: null,
  }), { ok: false, reason: 'missing-price' });

  assert.deepEqual(validatePdfOfferCandidate({
    title: 'Bananen 1 kg',
    price: 1.49,
  }), { ok: true, reason: '' });
});

test('extracts separate PDF offer candidates without merging nearby offers', () => {
  const candidates = extractCandidatesFromPage({
    page: 2,
    text: [
      'PENNY',
      'Seite 2',
      'Bananen',
      '1 kg',
      '1 49',
      'Gueltig von 01.05.2026 bis 07.05.2026',
      'Kaffee Crema',
      '500 g',
      '€ 4.99',
      'Impressum und Teilnahmebedingungen',
    ].join('\n'),
  }).filter((candidate) => !candidate.exclusionReason);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].title, 'Bananen');
  assert.equal(candidates[0].price, 1.49);
  assert.equal(candidates[1].title, 'Kaffee Crema');
  assert.equal(candidates[1].price, 4.99);
});

test('extracts PENNY Kirschen as tight short-window coupon fixture', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-13T10:00:00+02:00') });

  const candidates = extractCandidatesFromPage({
    page: 2,
    text: [
      'PLATTPFIRSICHE',
      'Kl. I, pro Packung',
      '1 kg=3.98',
      '500 g',
      '0.99',
      'Mit Gutschein',
      'von dieser Seite',
      '0.89',
      '2.99',
      'Mit Gutschein',
      'von dieser Seite',
      '2.69',
      'KIRSCHEN',
      'Kl. I, pro Packung',
      '1 kg=5.98',
      '500 g',
      'Wochenend-Kick',
      'Gültig von Do 11.06. bis Sa 13.06.2026',
    ].join('\n'),
  });
  const kirschen = candidates.find((candidate) => candidate.title === 'Kirschen');

  assert.ok(kirschen);
  assert.equal(kirschen.price, 2.99);
  assert.match(kirschen.quantityText, /500 g/);
  assert.match(kirschen.conditionsText, /Gutschein/);
  assert.match(kirschen.rawText, /2\.69/);

  const [offer] = normalizePennyPdfCandidatesToOffers({
    source: pennySource(),
    crawlJobId: '000000000000000000000456',
    region: 'AT',
    pdfUrl: 'https://example.test/penny.pdf',
    pdfReference: {
      validity: pennyKw24Validity(),
      candidates: [kirschen],
    },
  });

  assert.equal(offer.title, 'Kirschen');
  assert.equal(offer.priceCurrent.amount, 2.99);
  assert.equal(offer.priceReference.amount, null);
  assert.equal(offer.customerProgramRequired, true);
  assert.match(offer.conditionsText, /Gutschein/);
  assert.equal(dateKey(offer.validTo), '2026-06-13');
  assert.equal(offer.status, 'active');
  assert.equal(isOfferFreshForActiveUse(offer, new Date('2026-06-13T10:00:00+02:00')), true);
});

test('expires PENNY Kirschen short-window fixture after 13.06', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-14T10:00:00+02:00') });

  const [kirschen] = extractCandidatesFromPage({
    page: 2,
    text: [
      'KIRSCHEN',
      'Kl. I, pro Packung',
      '1 kg=5.98',
      '500 g',
      '2.99',
      'Mit Gutschein',
      'von dieser Seite',
      '2.69',
      'Gültig von Do 11.06. bis Sa 13.06.2026',
    ].join('\n'),
  }).filter((candidate) => candidate.title === 'Kirschen');

  const [offer] = normalizePennyPdfCandidatesToOffers({
    source: pennySource(),
    crawlJobId: '000000000000000000000456',
    region: 'AT',
    pdfUrl: 'https://example.test/penny.pdf',
    pdfReference: {
      validity: pennyKw24Validity(),
      candidates: [kirschen],
    },
  });

  assert.equal(offer.status, 'expired');
  assert.equal(offer.isActiveNow, false);
  assert.equal(isOfferFreshForActiveUse(offer, new Date('2026-06-14T10:00:00+02:00')), false);
});

test('rejects unsafe PENNY PDF neighbor merges for Polardorsch and Gouda', () => {
  const candidates = [
    ...extractCandidatesFromPage({
      page: 5,
      text: [
        'NESCAFÉ',
        'EDELMISCHUNG',
        'GOLD',
        '200 g',
        '100 g=4.25',
        '8.4916.49',
        'IGLO',
        'POLARDORSCH*',
        'div. Sorten',
        '300 g/400 g',
        '1 kg=11.23/14.97',
        '7.99',
        'bei 4 Stk. je',
        '1.741 Stk. 3.49',
        '2+2GRATIS',
        'bei 2 Stk. je',
      ].join('\n'),
    }),
    ...extractCandidatesFromPage({
      page: 8,
      text: [
        'SALZBURGMILCH',
        'PREMIUM KÄSE-',
        'SELEKTION*',
        'in Scheiben',
        'mild-fein, Sorten:',
        'Tilsiter, Gouda',
        'und Almkönig',
        '1 kg',
        '2.89',
      ].join('\n'),
    }),
  ];

  assert.equal(candidates.some((candidate) => candidate.title === 'GOLD IGLO POLARDORSCH' && !candidate.exclusionReason), false);
  assert.equal(candidates.some((candidate) => /SELEKTION.*Gouda/i.test(candidate.title) && !candidate.exclusionReason), false);
  assert.ok(candidates.some((candidate) => candidate.exclusionReason === 'unsafe-neighbor-merged-title'));
});

test('extracts tight PENNY Gouda evidence without mixing cheese neighbours', () => {
  const candidates = extractCandidatesFromPage({
    page: 4,
    text: [
      'XXL',
      'SCHÄRDINGER',
      'GOUDA*',
      '1 kg',
      'VIER',
      'DIAMANTEN',
      'THUNFISCH',
      'div. Sorten',
      '185 g',
      '100 g=1.08',
      '1.992.89',
      '6.99',
    ].join('\n'),
  });
  const gouda = candidates.find((candidate) => candidate.title === 'Schaerdinger Gouda');

  assert.ok(gouda);
  assert.equal(gouda.price, 6.99);
  assert.equal(gouda.quantityText, '1 kg Packung');
  assert.doesNotMatch(gouda.rawText, /SELEKTION|Tilsiter|Landfrisch/i);
});

test('extracts tight PENNY pro-kg meat conflict evidence without price override', () => {
  const candidates = [
    ...extractCandidatesFromPage({
      page: 6,
      text: [
        'SCHOPF od.',
        'KARREE',
        'ohne Knochen',
        'geschnitten od.',
        'im Stück',
        'natur od. gewürzt',
        'pro kg',
        'SCHWEINE-',
        'FLEISCH FÜR',
        'REISFLEISCH/',
        'GULASCH',
        'geschnitten',
        'pro kg',
        '6.99',
        '7.99',
      ].join('\n'),
    }),
    ...extractCandidatesFromPage({
      page: 7,
      text: [
        '15.99',
        'RINDS-',
        'SCHNITZEL-',
        'FLEISCH',
        'geschnitten od.',
        'im Stück, pro kg',
      ].join('\n'),
    }),
  ];
  const byTitle = new Map(candidates.filter((candidate) => !candidate.exclusionReason).map((candidate) => [candidate.title, candidate]));

  assert.equal(byTitle.get('Schopf od. Karree').price, 6.99);
  assert.equal(byTitle.get('Schopf od. Karree').quantityText, 'pro kg');
  assert.equal(byTitle.get('Schweinefleisch fuer Reisfleisch/Gulasch').price, 7.99);
  assert.equal(byTitle.get('Schweinefleisch fuer Reisfleisch/Gulasch').quantityText, 'pro kg');
  assert.equal(byTitle.get('Rindsschnitzelfleisch').price, 15.99);
  assert.match(byTitle.get('Rindsschnitzelfleisch').quantityText, /pro kg/);
});

test('keeps PENNY weekly offers on flyer-level validity fallback', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-14T10:00:00+02:00') });

  const [weeklyOffer] = normalizePennyPdfCandidatesToOffers({
    source: pennySource(),
    crawlJobId: '000000000000000000000456',
    region: 'AT',
    pdfUrl: 'https://example.test/penny.pdf',
    pdfReference: {
      validity: pennyKw24Validity(),
      candidates: [{
        id: 'p3-1',
        page: 3,
        title: 'Kaffee Crema',
        titleNormalized: 'kaffee crema',
        price: 4.99,
        quantityText: '500 g',
        conditionsText: '',
        rawText: 'Kaffee Crema 500 g 4.99',
      }],
    },
  });

  assert.equal(dateKey(weeklyOffer.validTo), '2026-06-17');
  assert.equal(weeklyOffer.status, 'active');
  assert.equal(weeklyOffer.isActiveNow, true);
});

test('summarizes PDF parser rejections compactly', () => {
  assert.deepEqual(summarizeRejections([
    { exclusionReason: 'missing-price' },
    { exclusionReason: 'missing-price' },
    { exclusionReason: 'implausible-title' },
    {},
  ]), [
    { reason: 'missing-price', count: 2 },
    { reason: 'implausible-title', count: 1 },
  ]);
});

test('builds compact reusable PDF source metadata', () => {
  const metadata = buildPdfSourceMetadata({
    source: {
      _id: '000000000000000000000123',
      retailerKey: 'penny',
      retailerName: 'PENNY',
    },
    sourceKey: 'penny-official-flyer-pdf',
    pdfUrl: 'https://example.test/flyer.pdf',
    page: 4,
    parserVersion: 'penny-pdf-v1',
    evidence: 'Kaffee Crema 500 g 4.99',
  });

  assert.equal(metadata.sourceKind, 'pdf');
  assert.equal(metadata.sourceKey, 'penny-official-flyer-pdf');
  assert.equal(metadata.retailerKey, 'penny');
  assert.equal(metadata.retailerName, 'PENNY');
  assert.equal(metadata.flyer.page, 4);
  assert.equal(metadata.parserVersion, 'penny-pdf-v1');
  assert.equal(metadata.evidence, 'Kaffee Crema 500 g 4.99');
});

test('normalizes PENNY PDF offers with consistent metadata for storage', () => {
  const source = {
    _id: '000000000000000000000123',
    retailerKey: 'penny',
    retailerName: 'PENNY',
    channel: 'official-flyer',
    sourceUrl: 'https://www.penny.at/angebote/flugblaetter',
  };
  const rawOffer = normalizePennyPdfCandidatesToOffers({
    source,
    crawlJobId: '000000000000000000000456',
    region: 'Grossraum Graz',
    pdfUrl: 'https://example.test/penny.pdf',
    pdfReference: {
      validity: {
        validFrom: new Date(Date.now() - 60 * 60 * 1000),
        validTo: new Date(Date.now() + 24 * 60 * 60 * 1000),
        detectedDates: [],
      },
      candidates: [
        {
          id: 'p3-1',
          page: 3,
          title: 'Kaffee Crema',
          titleNormalized: 'kaffee crema',
          price: 4.99,
          quantityText: '500 g',
          conditionsText: '',
          rawText: 'Kaffee Crema 500 g 4.99',
        },
      ],
    },
  })[0];
  const storedOffer = enrichOfferForStorage(rawOffer, {
    source,
    sourceType: 'penny-official-pdf',
    parserVersion: PARSER_VERSION,
  });

  assert.equal(storedOffer.sourceType, 'penny-official-pdf');
  assert.equal(storedOffer.retailerKey, 'penny');
  assert.equal(storedOffer.retailerName, 'PENNY');
  assert.equal(storedOffer.parserVersion, 'penny-pdf-v1');
  assert.equal(storedOffer.rawFacts.parserVersion, 'penny-pdf-v1');
  assert.equal(storedOffer.rawFacts.sourceKind, 'pdf');
  assert.equal(storedOffer.rawFacts.sourceKey, PENNY_PDF_SOURCE_KEY);
  assert.equal(storedOffer.rawFacts.sourceMetadata.sourceKey, PENNY_PDF_SOURCE_KEY);
  assert.equal(storedOffer.rawFacts.page, 3);
  assert.equal(storedOffer.rawFacts.pageNumber, 3);
  assert.equal(storedOffer.rawFacts.pdfPage, 3);
  assert.match(storedOffer.rawFacts.evidenceText, /Kaffee Crema/);
});

test('builds PENNY diagnostics report without database access', () => {
  const report = buildPennyDiagnosticsReport({
    sourceDistribution: [
      { _id: 'aktionsfinder-json', offers: 193, activeNow: 193 },
      { _id: 'penny-official-html', offers: 17, activeNow: 17 },
      { _id: 'penny-official-pdf', offers: 132, activeNow: 132 },
    ],
    rawDocumentSourceDistribution: [
      {
        _id: { sourceType: 'penny-official-pdf', documentType: 'pdf' },
        documents: 1,
        parsedOffers: 132,
      },
    ],
    latestPdfDocuments: [
      {
        sourceType: 'penny-official-pdf',
        parserVersion: 'penny-pdf-v1',
        payload: {
          sourceKind: 'pdf',
          sourceKey: 'penny-official-flyer-pdf',
          parserVersion: 'penny-pdf-v1',
          retailerKey: 'penny',
          retailerName: 'PENNY',
          detectedPageCount: 28,
        },
      },
    ],
    pdfOfferMetadataCounts: {
      totalPdfOffers: 132,
      missingSourceKey: 0,
      missingParserVersion: 0,
      unexpectedParserVersion: 0,
      missingSourceKind: 0,
    },
    samplePdfOffers: [
      {
        title: 'Kaffee Crema',
        priceCurrent: { amount: 4.99 },
        sourceType: 'penny-official-pdf',
        parserVersion: 'penny-pdf-v1',
        rawFacts: {
          sourceKind: 'pdf',
          sourceKey: 'penny-official-flyer-pdf',
          parserVersion: 'penny-pdf-v1',
          page: 3,
          evidenceText: 'Kaffee Crema 500 g 4.99',
        },
      },
    ],
    badTitles: [],
  });

  assert.equal(report.ok, true);
  assert.equal(report.expectedPdfMetadata.parserVersion, 'penny-pdf-v1');
  assert.equal(report.pdfOfferMetadataCounts.missingSourceKey, 0);
  assert.equal(report.latestPdfDocuments[0].sourceKey, 'penny-official-flyer-pdf');
  assert.equal(report.samplePdfOffers[0].parserVersion, 'penny-pdf-v1');
  assert.equal(report.suspiciousPdfTitles.length, 0);
});
