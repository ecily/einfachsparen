const assert = require('node:assert/strict');
const test = require('node:test');
const {
  splitTextLines,
  findPriceCandidatesFromLines,
  getNearbyText,
  buildLayoutCandidate,
  buildPageLayoutDiagnostics,
  buildPdfLayoutDiagnosticsFromPages,
} = require('../src/services/crawl/pdfLayoutDiagnostics');
const {
  pickPdfUrl,
  redactUrl,
} = require('../scripts/diagnosePennyPdfLayout');

test('detects offer price candidates from text-flow lines without unit prices', () => {
  const lines = splitTextLines([
    'CAPSA Nespresso- 1 Kapsel=0.29 XXL',
    'KAFFEE CREMA',
    '4.99',
    'RAPSO REINES RAPSÖL 0,75 l',
    '1 l=5.32',
    'Gültig von Do 07.05. bis Di 12.05.2026',
    '* Nur solange der Vorrat reicht. 1 Zzgl. € 0.25 Einwegpfand',
  ].join('\n'));
  const candidates = findPriceCandidatesFromLines(lines);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].amount, 4.99);
  assert.equal(candidates[0].lineIndex, 2);
  assert.equal(candidates[0].bbox, null);
});

test('returns nearby text around a price candidate', () => {
  const lines = ['A', 'B', 'Preis 1.49', 'C', 'D'];
  const nearby = getNearbyText(lines, 2, 1);

  assert.deepEqual(nearby.before, ['B']);
  assert.equal(nearby.line, 'Preis 1.49');
  assert.deepEqual(nearby.after, ['C']);
});

test('builds reusable read-only PDF layout candidate shape', () => {
  const lines = [
    'BANANEN',
    '1 kg',
    '1.49',
    'ERDBEEREN',
  ];
  const candidate = buildLayoutCandidate({
    retailerKey: 'penny',
    sourceType: 'penny-official-pdf',
    sourceKey: 'penny-official-flyer-pdf',
    pageNumber: 3,
    lines,
    priceCandidate: {
      text: '1.49',
      amount: 1.49,
      lineIndex: 2,
      bbox: null,
    },
  });

  assert.equal(candidate.retailerKey, 'penny');
  assert.equal(candidate.sourceType, 'penny-official-pdf');
  assert.equal(candidate.sourceKey, 'penny-official-flyer-pdf');
  assert.equal(candidate.pageNumber, 3);
  assert.equal(candidate.layoutMode, 'text-flow');
  assert.equal(candidate.bboxAvailable, false);
  assert.equal(candidate.priceCandidate.amount, 1.49);
  assert.ok(Array.isArray(candidate.confidenceHints));
  assert.ok(candidate.rejectionHints.includes('bbox-unavailable-text-flow-only'));
});

test('summarizes page layout diagnostics without database mutation fields', () => {
  const page = buildPageLayoutDiagnostics({
    retailerKey: 'penny',
    sourceType: 'penny-official-pdf',
    sourceKey: 'penny-official-flyer-pdf',
    pageNumber: 1,
    text: [
      'KAFFEE CREMA',
      '500 g',
      '4.99',
      'SCHOKOLADE',
      '100 g',
      '1.19',
    ].join('\n'),
  });

  assert.equal(page.priceCandidateCount, 2);
  assert.equal(page.blockCandidates.length, 2);
  assert.equal(Object.hasOwn(page, 'mutatedCollections'), false);
});

test('builds multi-page text-flow diagnostics and keeps URL selection side-effect free', () => {
  const report = buildPdfLayoutDiagnosticsFromPages({
    retailerKey: 'penny',
    sourceType: 'penny-official-pdf',
    sourceKey: 'penny-official-flyer-pdf',
    pages: [
      { pageNumber: 1, text: 'MILCH\n1 l\n1.29' },
      { pageNumber: 2, text: 'KAESE\n250 g\n2.49' },
    ],
  });

  assert.equal(report.bboxAvailable, false);
  assert.equal(report.layoutMode, 'text-flow');
  assert.equal(report.totals.pages, 2);
  assert.equal(report.totals.priceCandidates, 2);
  assert.equal(pickPdfUrl({ finalUrl: 'https://example.test/final.pdf', url: 'https://example.test/page' }), 'https://example.test/final.pdf');
  assert.equal(redactUrl('https://example.test/final.pdf?token=secret'), 'https://example.test/final.pdf?[redacted]');
});
