const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  READ_ONLY_CONTRACT,
  SOURCE_TYPE,
  splitPdfTextIntoBlocks,
  parseOfferPriceCandidate,
  extractQuantityAndUnit,
  extractValidityEvidence,
  extractSourceContextValidityCandidate,
  extractConditionCandidate,
  buildOfferCandidateFromBlock,
  buildCoffeeEvidence,
  buildSparPdfOfferPrototypeReport,
} = require('../src/services/diagnostics/sparPdfOfferPrototype');

function buildSource(overrides = {}) {
  return {
    key: 'spar-steiermark-kw19-pdf',
    url: 'https://example.test/spar.pdf',
    finalUrl: 'https://example.test/spar.pdf',
    ...overrides,
  };
}

function buildCandidateFromText(text, overrides = {}) {
  const [block] = splitPdfTextIntoBlocks(text);

  return buildOfferCandidateFromBlock({
    block,
    source: buildSource(),
    pageNumber: 1,
    validityContext: 'Gültig von 08.05.2026 bis 14.05.2026',
    ...overrides,
  });
}

test('splits PDF text into offer blocks around clear prices', () => {
  const blocks = splitPdfTextIntoBlocks([
    'REGIO Gold Kaffee',
    '500 g',
    '4,99',
    'Tassimo Kapseln',
    '16 Stück',
    '3,99',
  ].join('\n'));

  assert.equal(blocks.length, 2);
  assert.match(blocks[0].text, /REGIO Gold Kaffee/);
  assert.match(blocks[1].text, /Tassimo Kapseln/);
});

test('recognizes PDF prices defensively', () => {
  assert.equal(parseOfferPriceCandidate('nur 4,99'), 4.99);
  assert.equal(parseOfferPriceCandidate('€ 3.49'), 3.49);
  assert.equal(parseOfferPriceCandidate('1 Kapsel=0.29'), null);
  assert.equal(parseOfferPriceCandidate('Gültig von 08.05. bis 14.05.2026'), null);
});

test('extracts quantity and unit from PDF text', () => {
  assert.deepEqual(extractQuantityAndUnit('REGIO Gold Kaffee 500 g 4,99'), {
    quantityCandidate: '500 g',
    unitCandidate: 'g',
  });
  assert.deepEqual(extractQuantityAndUnit('Cafe Royal 10 Kapseln'), {
    quantityCandidate: '10 Kapseln',
    unitCandidate: 'Kapseln',
  });
  assert.deepEqual(extractQuantityAndUnit('Schokolade 1 Tafel'), {
    quantityCandidate: '1 Tafel',
    unitCandidate: 'Tafel',
  });
  assert.deepEqual(extractQuantityAndUnit('Nescafe 0.75 Liter'), {
    quantityCandidate: '0.75 Liter',
    unitCandidate: 'Liter',
  });
  assert.deepEqual(extractQuantityAndUnit('Kaffee gemahlen 200 g'), {
    quantityCandidate: '200 g',
    unitCandidate: 'g',
  });
});

test('explicit validity in PDF offer text is import-safe', () => {
  const evidence = extractValidityEvidence('REGIO Gold Kaffee\nGÃ¼ltig von 08.05.2026 bis 14.05.2026\n500 g\n4,99');

  assert.equal(evidence.validityCandidate, 'GÃ¼ltig von 08.05.2026 bis 14.05.2026');
  assert.equal(evidence.validityEvidenceType, 'explicit-offer-text');
  assert.equal(evidence.validityConfidence, 'high');
  assert.equal(evidence.validitySafeForImport, true);
});

test('source-context-only validity is not automatically import-safe', () => {
  const evidence = extractSourceContextValidityCandidate({
    url: 'https://example.test/prospekte/spar-08-05-2026-14-05-2026/',
  });

  assert.equal(evidence.validityCandidate, '08.05.2026 bis 14.05.2026');
  assert.equal(evidence.validityEvidenceType, 'source-context-only');
  assert.equal(evidence.validityConfidence, 'low');
  assert.equal(evidence.validitySafeForImport, false);
});

test('fetchedAt and checkedAt are never used as validity', () => {
  const candidate = buildCandidateFromText([
    'REGIO Gold Kaffee',
    '500 g',
    '4,99',
  ].join('\n'), {
    source: buildSource({
      fetchedAt: '2026-05-08T12:00:00.000Z',
      checkedAt: '2026-05-09T12:00:00.000Z',
    }),
    validityContext: '',
  });

  assert.equal(candidate.validityCandidate, '');
  assert.equal(candidate.validityEvidenceType, 'missing');
  assert.equal(candidate.validitySafeForImport, false);
});

test('detects SPAR coffee evidence in candidates', () => {
  const candidate = buildCandidateFromText([
    'Dallmayr Prodomo Kaffee',
    '500 g',
    '5,99',
  ].join('\n'));
  const evidence = buildCoffeeEvidence([candidate], []);
  const terms = evidence.terms.map((term) => term.normalized);

  assert.equal(evidence.candidateCount, 1);
  assert.ok(terms.includes('dallmayr'));
  assert.ok(terms.includes('prodomo'));
  assert.ok(terms.includes('kaffee'));
});

test('does not merge multiple nearby offers into one ready candidate', () => {
  const text = [
    'REGIO Gold Kaffee',
    '500 g',
    '4,99',
    'Cafe Royal Kapseln',
    '10 Kapseln',
    '3,99',
  ].join('\n');
  const blocks = splitPdfTextIntoBlocks(text);
  const candidates = blocks.map((block) => buildOfferCandidateFromBlock({
    block,
    source: buildSource(),
    pageNumber: 1,
    validityContext: 'Gültig von 08.05.2026 bis 14.05.2026',
  }));

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].titleCandidate, 'REGIO Gold Kaffee');
  assert.equal(candidates[1].titleCandidate, 'Cafe Royal Kapseln');
});

test('mixed offer blocks stay non-ready when several titles are too tightly mixed', () => {
  const block = {
    price: 4.99,
    lines: [
      'REGIO Gold Kaffee',
      'Tassimo Kapseln',
      'Cafe Royal Kapseln',
      '500 g',
      '4,99',
    ],
    text: 'REGIO Gold Kaffee\nTassimo Kapseln\nCafe Royal Kapseln\n500 g\n4,99',
    mixedOfferBlock: true,
  };
  const candidate = buildOfferCandidateFromBlock({
    block,
    source: buildSource(),
    pageNumber: 1,
    pageText: 'GÃ¼ltig von 08.05.2026 bis 14.05.2026',
  });

  assert.equal(candidate.candidateStatus, 'reject');
  assert.match(candidate.rejectionReason, /mixed-offer-block/);
});

test('candidate without clear price is not ready', () => {
  const block = {
    price: null,
    lines: ['REGIO Gold Kaffee', '500 g'],
    text: 'REGIO Gold Kaffee\n500 g',
    mixedOfferBlock: false,
  };
  const candidate = buildOfferCandidateFromBlock({
    block,
    source: buildSource(),
    pageNumber: 1,
    validityContext: 'Gültig von 08.05.2026 bis 14.05.2026',
  });

  assert.equal(candidate.candidateStatus, 'reject');
  assert.ok(candidate.missingFields.includes('priceCandidate'));
  assert.match(candidate.rejectionReason, /missing-clear-price/);
});

test('candidate without clear title is not ready', () => {
  const candidate = buildCandidateFromText([
    '500 g',
    '4,99',
  ].join('\n'));

  assert.equal(candidate.candidateStatus, 'reject');
  assert.ok(candidate.missingFields.includes('titleCandidate'));
  assert.match(candidate.rejectionReason, /missing-clear-title/);
});

test('detects -25 percent coffee condition', () => {
  const condition = extractConditionCandidate([
    '-25 % auf alle Kaffees',
    'nur mit SPAR App',
  ].join('\n'));

  assert.match(condition, /-25 % auf alle Kaffees/);
  assert.match(condition, /SPAR App/);
});

test('keeps report read-only and mutation-free with mocked PDF text pages', async () => {
  const report = await buildSparPdfOfferPrototypeReport({
    now: '2026-05-09T10:00:00.000Z',
    candidates: [
      { key: 'spar-steiermark-kw19-pdf', url: 'https://example.test/spar.pdf', expectedMode: 'pdf' },
    ],
    fetchSource: async () => ({
      status: 200,
      contentType: 'application/pdf',
      finalUrl: 'https://example.test/spar.pdf',
      size: 100,
      buffer: Buffer.from('%PDF mocked'),
    }),
    extractPages: async () => ({
      pageCount: 1,
      textLength: 80,
      fullText: 'Gültig von 08.05.2026 bis 14.05.2026\nREGIO Gold Kaffee\n500 g\n4,99',
      pages: [
        {
          pageNumber: 1,
          text: 'GÃ¼ltig von 08.05.2026 bis 14.05.2026\nREGIO Gold Kaffee\n500 g\nnur mit SPAR App\n4,99',
          charCount: 30,
        },
      ],
    }),
  });

  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(report.candidates[0].sourceType, SOURCE_TYPE);
  assert.equal(report.summary.readyCandidates, 1);
  assert.equal(report.summary.safeValidityCount, 1);
  assert.equal(report.candidates[0].validitySafeForImport, true);
  assert.deepEqual(report.mutatedCollections, []);
});

test('coffee evidence reports blockers per focus product', () => {
  const candidate = buildCandidateFromText([
    'Dallmayr Prodomo Kaffee',
    '500 g',
    '5,99',
  ].join('\n'), {
    validityContext: '',
  });
  const evidence = buildCoffeeEvidence([candidate], []);
  const prodomo = evidence.focusProducts.find((product) => product.key === 'dallmayrProdomo');

  assert.equal(prodomo.candidateDetected, true);
  assert.equal(prodomo.titleClear, true);
  assert.equal(prodomo.priceClear, true);
  assert.equal(prodomo.quantityClear, true);
  assert.equal(prodomo.validityClear, false);
  assert.match(prodomo.mainBlocker, /validityCandidate/);
});

test('read-only contract stays explicit and service does not import DB or models', () => {
  assert.equal(READ_ONLY_CONTRACT.readOnly, true);
  assert.deepEqual([...READ_ONLY_CONTRACT.mutatedCollections], []);

  const servicePath = path.join(__dirname, '..', 'src', 'services', 'diagnostics', 'sparPdfOfferPrototype.js');
  const source = fs.readFileSync(servicePath, 'utf8');
  const requireLines = source.split(/\r?\n/).filter((line) => line.includes('require(')).join('\n');

  assert.doesNotMatch(requireLines, /config[\\/]+mongodb/);
  assert.doesNotMatch(requireLines, /models[\\/]+[A-ZA-z]/);
  assert.doesNotMatch(requireLines, /RawDocument|mongoose/);
});
