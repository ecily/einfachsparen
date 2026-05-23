const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildBlockedReport,
  buildImageDedupeRepairPotentialDiagnostic,
  imageDomainOrShortUrl,
} = require('../src/services/diagnostics/imageDedupeRepairPotentialDiagnostic');

function offer(overrides = {}) {
  return {
    _id: overrides._id || Math.random().toString(16).slice(2),
    retailerKey: 'bipa',
    sourceId: 'source-official',
    sourceType: 'bipa-official-html',
    title: 'Duschgel Fresh 250 ml',
    titleNormalized: 'duschgel fresh 250 ml',
    priceCurrent: { amount: 1.99, currency: 'EUR' },
    effectiveDiscountType: 'price-cut',
    customerProgramRequired: false,
    validTo: new Date('2026-06-01T23:59:59.000Z'),
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    isActiveNow: true,
    quality: { comparisonSafe: true, completenessScore: 90, parsingConfidence: 0.9 },
    imageUrl: '',
    ...overrides,
  };
}

test('image dedupe repair diagnostic counts canonical image gap with sibling image', () => {
  const canonical = offer({ _id: 'canonical', sourceId: 'source-official', imageUrl: '' });
  const sibling = offer({
    _id: 'sibling',
    sourceId: 'source-aggregator',
    sourceType: 'aktionsfinder-json',
    quality: { comparisonSafe: true, completenessScore: 80, parsingConfidence: 0.8 },
    imageUrl: 'https://img.example.test/product.jpg',
  });
  const report = buildImageDedupeRepairPotentialDiagnostic({
    offers: [canonical, sibling],
    sources: [
      { _id: 'source-official', channel: 'official-site', sourceType: 'bipa-official-html', retailerKey: 'bipa' },
      { _id: 'source-aggregator', channel: 'aggregator', sourceType: 'aktionsfinder-json', retailerKey: 'bipa' },
    ],
    queries: ['duschgel', 'bier'],
  });

  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(report.summary.safeDuplicateGroups, 1);
  assert.equal(report.summary.canonicalWithoutImageGroups, 1);
  assert.equal(report.summary.potentialRepairableGroups, 1);
  assert.equal(report.potential.byRetailer[0].key, 'bipa');
  assert.equal(report.potential.byQuery.find((row) => row.query === 'duschgel').count, 1);
  assert.equal(report.potential.byQuery.find((row) => row.query === 'bier').count, 0);
  assert.equal(report.examples.topRepairableCanonicalGaps[0].canonicalOfferId, 'canonical');
});

test('image dedupe repair diagnostic does not count invalid sibling image values', () => {
  const report = buildImageDedupeRepairPotentialDiagnostic({
    offers: [
      offer({ _id: 'canonical', imageUrl: '' }),
      offer({ _id: 'sibling', imageUrl: 'https://img.example.test/no-image.png' }),
    ],
    queries: ['duschgel'],
  });

  assert.equal(report.summary.safeDuplicateGroups, 1);
  assert.equal(report.summary.canonicalWithoutImageGroups, 1);
  assert.equal(report.summary.potentialRepairableGroups, 0);
  assert.equal(report.summary.duplicateGroupCanonicalImageGapsWithoutSiblingImage, 1);
});

test('image dedupe repair diagnostic keeps separate dedupe keys out of potential', () => {
  const report = buildImageDedupeRepairPotentialDiagnostic({
    offers: [
      offer({ _id: 'canonical', titleNormalized: 'duschgel fresh 250 ml', imageUrl: '' }),
      offer({ _id: 'different', titleNormalized: 'bier maerzen 500 ml', imageUrl: 'https://img.example.test/bier.jpg' }),
    ],
    queries: ['duschgel'],
  });

  assert.equal(report.summary.safeDuplicateGroups, 0);
  assert.equal(report.summary.potentialRepairableGroups, 0);
});

test('blocked report preserves read-only contract', () => {
  const report = buildBlockedReport({ message: 'Atlas whitelist blocked' });

  assert.equal(report.ok, false);
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.match(report.blocked.dbReason, /Atlas/);
});

test('short image URL report output avoids long URLs', () => {
  assert.equal(
    imageDomainOrShortUrl('https://images.example.test/some/really/really/really/really/really/long/path/product.jpg?token=secretish'),
    'images.example.test/some/really/really/really/really/really/long...'
  );
});
