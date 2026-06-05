const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildOfferCardDiagnostics,
  parsePriceAnchors,
} = require('../src/services/crawl/sparFamilyPdfCardDetector');

function item(text, x, y, w = 40, h = 10) {
  return { text, x, y, w, h };
}

test('layout-aware detector groups title, quantity and threshold condition around a price anchor', () => {
  const cards = buildOfferCardDiagnostics({
    pageNumber: 1,
    sourceKey: 'spar-official-flyer-pdf',
    textItems: [
      item('SPAR Muellsack mit Zugband', 80, 180, 140),
      item('35, 45 oder 70 Liter', 82, 164, 110),
      item('1 Pkg. 2,19', 84, 146, 70),
      item('ab 2 Pkg. je', 84, 130, 80),
      item('1,99', 88, 112, 45),
    ],
  });
  const card = cards.find((candidate) => candidate.anchor.amount === 1.99);

  assert.ok(card);
  assert.match(card.title, /SPAR Muellsack/);
  assert.equal(card.quantity, '70 l');
  assert.match(card.condition, /ab\/bei 2 Pkg/);
  assert.equal(card.neighborConflict, false);
});

test('layout-aware detector rejects zones with competing neighboring prices', () => {
  const cards = buildOfferCardDiagnostics({
    pageNumber: 2,
    textItems: [
      item('Produkt A', 100, 190, 70),
      item('500 g', 100, 174, 40),
      item('1,99', 104, 154, 38),
      item('Produkt B', 150, 188, 70),
      item('250 g', 150, 174, 40),
      item('2,49', 154, 154, 38),
      item('statt', 125, 146, 25),
      item('3,49', 128, 136, 38),
    ],
  });
  const conflicted = cards.find((candidate) => candidate.anchor.amount === 1.99);

  assert.ok(conflicted);
  assert.equal(conflicted.neighborConflict, true);
  assert.equal(conflicted.publishable, false);
  assert.ok(conflicted.rejectionReasons.includes('neighbor-conflict'));
});

test('layout-aware detector never marks nearby images as publishable without verified crop mapping', () => {
  const cards = buildOfferCardDiagnostics({
    pageNumber: 3,
    textItems: [
      item('Always Ultra Binden Big Pack', 90, 190, 150),
      item('12-26 Stueck', 92, 174, 80),
      item('ab 2 Pkg. je', 92, 158, 80),
      item('3,19', 95, 140, 38),
    ],
    imageItems: [
      { x: 70, y: 172, w: 55, h: 65 },
    ],
  });
  const card = cards.find((candidate) => candidate.anchor.amount === 3.19);

  assert.ok(card);
  assert.equal(card.nearbyImageCandidates, 1);
  assert.equal(card.imagePublishable, false);
  assert.match(card.imagePublishReason, /not-verified|no-unique/);
});

test('price anchor parser accepts split euro and cent tokens', () => {
  const anchors = parsePriceAnchors([
    item('14,', 100, 100, 24),
    item('90', 128, 102, 18),
  ]);

  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].amount, 14.9);
  assert.equal(anchors[0].kind, 'split-price');
});
