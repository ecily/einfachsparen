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
