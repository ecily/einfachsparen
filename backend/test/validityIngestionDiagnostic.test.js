const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildValidityIngestionDiagnostic,
  inferGroupReason,
  recommendedFirstProductiveFix,
} = require('../src/services/diagnostics/validityIngestionDiagnostic');

function offer(overrides = {}) {
  return {
    _id: overrides._id || Math.random().toString(16).slice(2),
    sourceId: overrides.sourceId || 'source-a',
    retailerKey: overrides.retailerKey || 'billa',
    retailerName: overrides.retailerName || 'BILLA',
    sourceType: overrides.sourceType || 'billa-official-algolia',
    sourceUrl: overrides.sourceUrl || 'https://www.billa.at/unsere-aktionen/aktionen',
    title: overrides.title || 'Ja Natuerlich Bio Milch',
    validFrom: null,
    validTo: null,
    rawFacts: {},
    ...overrides,
  };
}

test('aggregates validity ingestion diagnostics for target source groups', () => {
  const report = buildValidityIngestionDiagnostic({
    offers: [
      offer({
        retailerKey: 'lidl',
        retailerName: 'Lidl',
        sourceType: 'lidl-official-flyer-api',
        validFrom: new Date('2026-05-01T00:00:00Z'),
        validTo: new Date('2026-05-08T23:59:59Z'),
        rawFacts: {
          validityText: '2026-05-01 - 2026-05-08',
        },
      }),
      offer({
        retailerKey: 'billa',
        sourceType: 'billa-official-algolia',
        validFrom: new Date('2026-05-08T12:00:00Z'),
        validTo: null,
        rawFacts: {
          snapshotCurrent: true,
        },
      }),
    ],
    rawDocuments: [
      {
        retailerKey: 'billa',
        title: 'BILLA Algolia Promotions',
        fetchedAt: new Date('2026-05-08T12:00:00Z'),
        payload: {
          sampleNames: ['Milch'],
        },
      },
    ],
    generatedAt: '2026-05-08T12:00:00.000Z',
  });
  const lidl = report.sources.find((row) => row.retailerKey === 'lidl');
  const billa = report.sources.find((row) => row.retailerKey === 'billa' && row.sourceType === 'billa-official-algolia');

  assert.equal(report.ok, true);
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(report.summary.sourceTypesAnalyzed.includes('lidl/lidl-official-flyer-api'), true);
  assert.equal(lidl.recoverability, 'safe');
  assert.equal(lidl.signalLevel, 'offer');
  assert.equal(billa.recoverability, 'not-safe');
});

test('classifies explicit offer-level validity signals as safe', () => {
  const result = inferGroupReason({
    group: { retailerKey: 'spar', sourceType: 'aktionsfinder-json' },
    offers: [
      offer({
        retailerKey: 'spar',
        sourceType: 'aktionsfinder-json',
        rawFacts: {
          validityText: 'ab 01.05.2026 bis 08.05.2026',
        },
      }),
    ],
    rawDocuments: [],
    sourceSignals: [],
    rawSignals: [],
    offerSignals: [
      {
        path: 'offer.rawFacts.validityText',
        value: 'ab 01.05.2026 bis 08.05.2026',
        hasDate: true,
        hasRange: true,
        fetchedAtOnly: false,
      },
    ],
  });

  assert.equal(result.recoverability, 'safe');
  assert.equal(result.signalLevel, 'offer');
});

test('does not recommend fetchedAt as validity', () => {
  const result = inferGroupReason({
    group: { retailerKey: 'bipa', sourceType: 'aktionsfinder-json' },
    offers: [],
    rawDocuments: [],
    sourceSignals: [],
    rawSignals: [
      {
        path: 'rawDocument.fetchedAt',
        value: '2026-05-08T12:00:00.000Z',
        hasDate: true,
        hasRange: false,
        fetchedAtOnly: true,
      },
    ],
    offerSignals: [],
  });

  assert.equal(result.recoverability, 'not-safe');
  assert.equal(result.signalLevel, 'none');
  assert.match(result.whyMissing, /fetchedAt/);
});

test('marks source-level or url-level dates as conditional', () => {
  const result = inferGroupReason({
    group: { retailerKey: 'penny', sourceType: 'aktionsfinder-json' },
    offers: [],
    rawDocuments: [
      {
        url: 'https://www.aktionsfinder.at/l/penny-flugblatt-01-05-2026-08-05-2026/',
      },
    ],
    sourceSignals: [],
    rawSignals: [],
    offerSignals: [],
  });

  assert.equal(result.recoverability, 'conditional');
  assert.equal(result.signalLevel, 'url');
});

test('read-only contract is explicit in the diagnostic output', () => {
  const report = buildValidityIngestionDiagnostic({
    offers: [],
    sources: [],
    rawDocuments: [],
  });

  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(report.sources.every((row) => row.recoverability === 'not-safe'), true);
});

test('first productive fix prefers safe mappings before conditional source-level work', () => {
  const safe = recommendedFirstProductiveFix([
    {
      retailerKey: 'spar',
      sourceType: 'aktionsfinder-json',
      recoverability: 'safe',
      currentValidityCoverage: { bothValidityPresentPct: 0 },
    },
  ]);
  const conditional = recommendedFirstProductiveFix([
    {
      retailerKey: 'penny',
      sourceType: 'aktionsfinder-json',
      recoverability: 'conditional',
      currentValidityCoverage: { bothValidityPresentPct: 0 },
    },
  ]);

  assert.match(safe, /explizite offer-level/);
  assert.match(conditional, /leafletHref/);
});
