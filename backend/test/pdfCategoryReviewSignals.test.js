const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PDF_CATEGORY_MISMATCH_REVIEW_REASON,
  detectPdfCategoryMismatchReviewSignal,
} = require('../src/services/crawl/pdfOfferParsing');

test('flags strong official PDF title/category contradictions', () => {
  const signal = detectPdfCategoryMismatchReviewSignal({
    sourceType: 'spar-official-pdf',
    sourceKey: 'eurospar-official-flyer-pdf',
    title: 'Schokolade versch. Sorten',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
  });

  assert.equal(signal.reason, PDF_CATEGORY_MISMATCH_REVIEW_REASON);
  assert.equal(signal.productGroup, 'sweets');
  assert.equal(signal.categoryGroup, 'beer');
});

test('does not flag matching official PDF beer category', () => {
  const signal = detectPdfCategoryMismatchReviewSignal({
    sourceType: 'spar-official-pdf',
    sourceKey: 'spar-official-flyer-pdf',
    title: 'Goesser Maerzen',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
  });

  assert.equal(signal, null);
});

test('does not flag broad drogerie category for washing detergent', () => {
  const signal = detectPdfCategoryMismatchReviewSignal({
    sourceType: 'penny-official-pdf',
    sourceKey: 'penny-official-flyer-pdf',
    title: 'Persil Waschmittel Universal',
    categoryPrimary: 'Drogerie / Hygiene',
    categorySecondary: '',
    categoryKey: 'drogerie-hygiene',
  });

  assert.equal(signal, null);
});

test('does not flag non-PDF offers', () => {
  const signal = detectPdfCategoryMismatchReviewSignal({
    sourceType: 'aktionsfinder-json',
    sourceKey: 'aktionsfinder-spar',
    title: 'Schokolade versch. Sorten',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
  });

  assert.equal(signal, null);
});

test('does not flag div Sorten without a strong product cue', () => {
  const signal = detectPdfCategoryMismatchReviewSignal({
    sourceType: 'spar-official-pdf',
    sourceKey: 'spar-official-flyer-pdf',
    title: 'div. Sorten',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
  });

  assert.equal(signal, null);
});
