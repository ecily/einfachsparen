const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseNumericAmount,
  extractCandidatesFromPage,
  summarizeRejections,
  normalizePennyPdfCandidatesToOffers,
  PARSER_VERSION,
  PENNY_PDF_SOURCE_KEY,
} = require('../src/services/crawl/pennyPdfLeafletParser');
const { enrichOfferForStorage } = require('../src/services/crawl/offerAuditEnrichment');
const {
  validatePdfOfferCandidate,
  buildPdfSourceMetadata,
} = require('../src/services/crawl/pdfOfferParsing');
const {
  buildPennyDiagnosticsReport,
} = require('../scripts/diagnosePennySources');

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
