const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeOcrBox,
  findPriceBoxes,
  groupNearbyOcrText,
  buildOcrOfferBlockCandidates,
  buildCandidateBlockPreview,
  buildCandidateBlockPreviews,
  buildQualityFlags,
  summarizeOcrDiagnostics,
  buildPriceCandidateComparison,
} = require('../src/services/crawl/ocrBoxDiagnostics');

test('normalizes OCR boxes from polygon coordinates', () => {
  const box = normalizeOcrBox({
    text: '  Kaffee Crema  ',
    confidence: '0.93',
    polygon: [[10, 20], [110, 20], [110, 50], [10, 50]],
    pageNumber: 2,
  });

  assert.equal(box.text, 'Kaffee Crema');
  assert.equal(box.confidence, 0.93);
  assert.deepEqual(box.bbox, {
    x: 10,
    y: 20,
    width: 100,
    height: 30,
  });
  assert.equal(box.pageNumber, 2);
});

test('detects price boxes and skips unit prices', () => {
  const boxes = [
    normalizeOcrBox({ text: '4.99', bbox: { x: 10, y: 100, width: 40, height: 20 }, pageNumber: 1 }),
    normalizeOcrBox({ text: '1 kg = 2.49', bbox: { x: 10, y: 130, width: 80, height: 20 }, pageNumber: 1 }),
    normalizeOcrBox({ text: 'Gueltig bis 12.05.', bbox: { x: 10, y: 160, width: 120, height: 20 }, pageNumber: 1 }),
    normalizeOcrBox({ text: '11.05.', bbox: { x: 10, y: 190, width: 80, height: 20 }, pageNumber: 1 }),
    normalizeOcrBox({ text: '07.05.2026', bbox: { x: 10, y: 220, width: 110, height: 20 }, pageNumber: 1 }),
  ];

  const priceBoxes = findPriceBoxes(boxes);

  assert.equal(priceBoxes.length, 1);
  assert.equal(priceBoxes[0].text, '4.99');
  assert.equal(priceBoxes[0].amount, 4.99);
});

test('groups nearby OCR text by page and distance', () => {
  const price = normalizeOcrBox({ text: '1.49', bbox: { x: 100, y: 100, width: 40, height: 20 }, pageNumber: 1 });
  const nearTitle = normalizeOcrBox({ text: 'Bananen', bbox: { x: 90, y: 60, width: 80, height: 24 }, pageNumber: 1 });
  const otherPage = normalizeOcrBox({ text: 'Aepfel', bbox: { x: 90, y: 60, width: 80, height: 24 }, pageNumber: 2 });
  const farTitle = normalizeOcrBox({ text: 'Milch', bbox: { x: 900, y: 900, width: 80, height: 24 }, pageNumber: 1 });

  const nearby = groupNearbyOcrText(price, [price, nearTitle, otherPage, farTitle], {
    maxDistance: 120,
  });

  assert.equal(nearby.length, 1);
  assert.equal(nearby[0].text, 'Bananen');
  assert.equal(nearby[0].direction, 'before');
  assert.equal(nearby[0].titleLike, true);
});

test('does not include the price box itself in nearby OCR text', () => {
  const boxes = [
    normalizeOcrBox({ text: 'Bananen', bbox: { x: 90, y: 60, width: 80, height: 24 }, pageNumber: 1 }),
    normalizeOcrBox({ text: '1.49', bbox: { x: 100, y: 100, width: 40, height: 20 }, pageNumber: 1 }),
  ];
  const candidates = buildOcrOfferBlockCandidates(boxes, { maxDistance: 120 });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].nearbyTextByDistance.length, 1);
  assert.equal(candidates[0].nearbyTextByDistance[0].text, 'Bananen');
});

test('builds OCR offer block candidates from synthetic boxes', () => {
  const boxes = [
    normalizeOcrBox({ text: 'Kaffee Crema', bbox: { x: 100, y: 80, width: 130, height: 30 }, pageNumber: 1 }),
    normalizeOcrBox({ text: '500 g', bbox: { x: 100, y: 115, width: 60, height: 20 }, pageNumber: 1 }),
    normalizeOcrBox({ text: '4.99', bbox: { x: 120, y: 150, width: 50, height: 34 }, pageNumber: 1 }),
  ];

  const candidates = buildOcrOfferBlockCandidates(boxes, {
    maxDistance: 140,
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].price, 4.99);
  assert.equal(candidates[0].nearestTitleText, 'Kaffee Crema');
  assert.equal(candidates[0].rejectionHints.length, 0);
  assert.equal(candidates[0].likelyExtractable, true);
  assert.equal(candidates[0].needsManualReview, false);
  assert.ok(candidates[0].confidenceHints.includes('nearest-title-box'));
});

test('builds compact candidateBlock preview with price context and quality flags', () => {
  const boxes = [
    normalizeOcrBox({ text: 'Kaffee Crema', confidence: 0.91, bbox: { x: 100, y: 80, width: 130, height: 30 }, pageNumber: 1 }),
    normalizeOcrBox({ text: '500 g', confidence: 0.88, bbox: { x: 100, y: 115, width: 60, height: 20 }, pageNumber: 1 }),
    normalizeOcrBox({ text: '4.99', confidence: 0.96, bbox: { x: 120, y: 150, width: 50, height: 34 }, pageNumber: 1 }),
  ];
  const [candidate] = buildOcrOfferBlockCandidates(boxes, { maxDistance: 140 });
  const preview = buildCandidateBlockPreview(candidate, 0);

  assert.equal(preview.blockIndex, 1);
  assert.equal(preview.pageNumber, 1);
  assert.equal(preview.priceText, '4.99');
  assert.equal(preview.parsedPrice, 4.99);
  assert.equal(preview.productText, 'Kaffee Crema');
  assert.equal(preview.likelyExtractable, true);
  assert.equal(preview.needsManualReview, false);
  assert.match(preview.nearbyText, /Kaffee Crema/);
  assert.deepEqual(preview.titleCandidates.map((candidate) => candidate.text), ['Kaffee Crema']);
  assert.deepEqual(preview.unitCandidates.map((candidate) => candidate.text), ['500 g']);
  assert.deepEqual(preview.conditionCandidates, []);
  assert.deepEqual(preview.noiseCandidates, []);
  assert.equal(preview.possibleQuantityOrUnitText, '500 g');
  assert.equal(preview.qualityFlags.hasPrice, true);
  assert.equal(preview.qualityFlags.hasNearbyText, true);
  assert.equal(preview.qualityFlags.lowConfidence, false);
  assert.ok(preview.priceBox);
  assert.ok(preview.textBox);
  assert.ok(preview.mergedTextBox);
  assert.equal(preview.rawLineCount, 3);
});

test('candidateBlock previews handle empty inputs without crashing', () => {
  assert.deepEqual(buildCandidateBlockPreviews([], { limit: 20 }), []);

  const preview = buildCandidateBlockPreview(null, 0);
  assert.equal(preview.blockIndex, 1);
  assert.equal(preview.priceText, '');
  assert.equal(preview.qualityFlags.hasPrice, false);
  assert.equal(preview.qualityFlags.hasNearbyText, false);
});

test('classifies OCR noise and condition text as manual review instead of product title', () => {
  const boxes = [
    normalizeOcrBox({ text: 'witGutschein', bbox: { x: 90, y: 55, width: 100, height: 20 }, pageNumber: 1 }),
    normalizeOcrBox({ text: '30-Tage-Preise.', bbox: { x: 90, y: 80, width: 120, height: 20 }, pageNumber: 1 }),
    normalizeOcrBox({ text: '[USTERREICH', bbox: { x: 90, y: 105, width: 100, height: 20 }, pageNumber: 1 }),
    normalizeOcrBox({ text: 'Pkg.', bbox: { x: 90, y: 130, width: 45, height: 20 }, pageNumber: 1 }),
    normalizeOcrBox({ text: '2.49', bbox: { x: 120, y: 160, width: 50, height: 34 }, pageNumber: 1 }),
  ];

  const [candidate] = buildOcrOfferBlockCandidates(boxes, { maxDistance: 140 });
  const preview = buildCandidateBlockPreview(candidate, 0);

  assert.equal(candidate.nearestTitleText, '');
  assert.equal(candidate.likelyExtractable, false);
  assert.equal(candidate.needsManualReview, true);
  assert.ok(candidate.rejectionHints.includes('no-usable-product-title'));
  assert.ok(candidate.rejectionHints.includes('condition-text-instead-of-title'));
  assert.ok(candidate.rejectionHints.includes('unit-text-instead-of-title'));
  assert.ok(candidate.rejectionHints.includes('noise-text-instead-of-title'));
  assert.deepEqual(preview.titleCandidates, []);
  assert.deepEqual(preview.conditionCandidates.map((item) => item.text), ['30-Tage-Preise.', 'witGutschein']);
  assert.deepEqual(preview.unitCandidates.map((item) => item.text), ['Pkg.']);
  assert.deepEqual(preview.noiseCandidates.map((item) => item.text), ['[USTERREICH']);
});

test('does not create OCR candidate blocks from date-like price text', () => {
  const diagnostics = summarizeOcrDiagnostics([
    normalizeOcrBox({ text: 'Kaffee Crema', bbox: { x: 100, y: 80, width: 130, height: 30 }, pageNumber: 1 }),
    normalizeOcrBox({ text: '11.05.', bbox: { x: 120, y: 150, width: 50, height: 34 }, pageNumber: 1 }),
    normalizeOcrBox({ text: '07.05.2026', bbox: { x: 120, y: 190, width: 80, height: 34 }, pageNumber: 1 }),
  ], { maxDistance: 140 });

  assert.equal(diagnostics.detectedPriceBoxes.length, 0);
  assert.equal(diagnostics.candidateBlocks.length, 0);
});

test('quality flags mark low confidence and condition-like OCR context', () => {
  const flags = buildQualityFlags({
    priceText: '2.49',
    price: 2.49,
    priceConfidence: 0.44,
    nearestTitleText: 'App Gutschein',
    nearestTitleConfidence: 0.42,
    nearbyTextByDistance: [
      { text: '2+1 GRATIS', confidence: 0.9 },
      { text: 'nur mit App', confidence: 0.8 },
    ],
  });

  assert.equal(flags.hasPrice, true);
  assert.equal(flags.hasNearbyText, true);
  assert.equal(flags.lowConfidence, true);
  assert.equal(flags.possibleConditionOnly, true);
  assert.equal(flags.possibleMultiBuy, true);
  assert.equal(flags.possibleLoyaltyCondition, true);
});

test('summarizes OCR diagnostics with clean and problem previews without mutation fields', () => {
  const diagnostics = summarizeOcrDiagnostics([
    normalizeOcrBox({ text: 'Kaffee Crema', bbox: { x: 100, y: 80, width: 130, height: 30 }, pageNumber: 1 }),
    normalizeOcrBox({ text: '4.99', bbox: { x: 120, y: 150, width: 50, height: 34 }, pageNumber: 1 }),
    normalizeOcrBox({ text: '1.99', bbox: { x: 800, y: 900, width: 50, height: 34 }, pageNumber: 1 }),
  ], { maxDistance: 120, previewLimit: 10 });

  assert.equal(diagnostics.candidateBlocks.length, 2);
  assert.equal(diagnostics.cleanCandidateBlocks.length, 1);
  assert.equal(diagnostics.problemBlocks.length, 1);
  assert.equal(diagnostics.candidateBlocksPreview.length, 2);
  assert.equal(diagnostics.cleanCandidateBlocksPreview.length, 1);
  assert.equal(diagnostics.problemBlocksPreview.length, 1);
  assert.equal(Object.hasOwn(diagnostics, 'mutatedCollections'), false);
});

test('compares text-flow price candidates with OCR price boxes by page and amount', () => {
  const ocrBoxes = [
    normalizeOcrBox({ text: 'Kaffee Crema', bbox: { x: 100, y: 80, width: 130, height: 30 }, pageNumber: 1 }),
    normalizeOcrBox({ text: '4.99', bbox: { x: 120, y: 150, width: 50, height: 34 }, pageNumber: 1 }),
    normalizeOcrBox({ text: 'Bananen', bbox: { x: 300, y: 80, width: 100, height: 30 }, pageNumber: 2 }),
    normalizeOcrBox({ text: '1.49', bbox: { x: 320, y: 150, width: 50, height: 34 }, pageNumber: 2 }),
  ];
  const ocrDiagnostics = summarizeOcrDiagnostics(ocrBoxes, { maxDistance: 140 });
  const comparison = buildPriceCandidateComparison({
    layoutDiagnostics: {
      pages: [
        {
          pageNumber: 1,
          priceCandidates: [{ text: '4.99', amount: 4.99, lineIndex: 2 }],
        },
        {
          pageNumber: 2,
          priceCandidates: [{ text: '2.99', amount: 2.99, lineIndex: 5 }],
        },
      ],
    },
    ocrDiagnostics,
  });

  assert.equal(comparison.totals.textFlowPriceCandidates, 2);
  assert.equal(comparison.totals.ocrPriceBoxes, 2);
  assert.equal(comparison.totals.matchedByPageAndAmount, 1);
  assert.equal(comparison.totals.cleanCandidateBlocks, 2);
  assert.equal(comparison.pages[0].matchedByAmount, 1);
  assert.equal(comparison.pages[1].ocrOnlyPriceExamples[0].amount, 1.49);
});
