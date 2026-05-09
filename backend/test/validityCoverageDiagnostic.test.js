const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildValidityCoverageDiagnostic,
  classifyValidityRecovery,
  inferRecoverability,
} = require('../src/services/diagnostics/validityCoverageDiagnostic');

function offer(overrides = {}) {
  return {
    _id: overrides._id || Math.random().toString(16).slice(2),
    sourceId: overrides.sourceId || 'source-a',
    retailerKey: 'billa',
    retailerName: 'BILLA',
    sourceType: 'billa-official-algolia',
    title: 'Ja Natuerlich Bio Milch',
    sourceUrl: 'https://shop.billa.at/aktionen',
    validFrom: null,
    validTo: null,
    status: 'active',
    isActiveNow: false,
    isActiveToday: false,
    rawFacts: {},
    parserVersion: 'test-parser',
    ...overrides,
  };
}

test('aggregates validity coverage by retailer and sourceType', () => {
  const report = buildValidityCoverageDiagnostic({
    offers: [
      offer({
        _id: 'billa-present',
        sourceType: 'billa-official-algolia',
        validFrom: new Date('2026-05-01T00:00:00Z'),
        validTo: new Date('2026-05-08T23:59:59Z'),
      }),
      offer({
        _id: 'billa-missing',
        sourceType: 'billa-official-algolia',
      }),
      offer({
        _id: 'penny-present',
        retailerKey: 'penny',
        retailerName: 'PENNY',
        sourceType: 'penny-official-html',
        validFrom: new Date('2026-05-07T00:00:00Z'),
        validTo: new Date('2026-05-12T23:59:59Z'),
      }),
    ],
    generatedAt: '2026-05-08T12:00:00.000Z',
  });
  const billa = report.rows.find((row) => row.retailerKey === 'billa' && row.sourceType === 'billa-official-algolia');
  const penny = report.rows.find((row) => row.retailerKey === 'penny' && row.sourceType === 'penny-official-html');

  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(report.summary.totalOffersAnalyzed, 3);
  assert.equal(billa.totalOffers, 2);
  assert.equal(billa.offersWithValidFrom, 1);
  assert.equal(billa.offersWithValidTo, 1);
  assert.equal(billa.offersWithAnyValidity, 1);
  assert.equal(billa.statusCounts.already_safe, 1);
  assert.equal(penny.anyValidityPresentPct, 100);
});

test('offer-level validFrom and validTo remains already_safe', () => {
  const result = classifyValidityRecovery({
    offer: offer({
      validFrom: new Date('2026-05-01T00:00:00Z'),
      validTo: new Date('2026-05-08T23:59:59Z'),
    }),
  });

  assert.equal(result.status, 'already_safe');
  assert.equal(result.safety, 'safe');
  assert.deepEqual(result.recoveredValidity, {
    validFrom: '2026-05-01',
    validTo: '2026-05-08',
  });
});

test('validityLabel with explicit German date range is safe recoverable', () => {
  const result = classifyValidityRecovery({
    offer: offer({
      rawFacts: {
        validityLabel: 'gueltig von 01.05.2026 bis 08.05.2026',
      },
    }),
  });

  assert.equal(result.status, 'safely_recoverable_from_validity_label');
  assert.equal(result.safety, 'safe');
  assert.deepEqual(result.recoveredValidity, {
    validFrom: '01.05.2026',
    validTo: '08.05.2026',
    sourceText: 'gueltig von 01.05.2026 bis 08.05.2026',
  });
});

test('explicit offer rawFacts validity text is safe recoverable', () => {
  const result = classifyValidityRecovery({
    offer: offer({
      rawFacts: {
        offerStartDate: '2026-05-01',
        offerEndDate: '2026-05-08',
      },
    }),
  });

  assert.equal(result.status, 'safely_recoverable_from_explicit_offer_text');
  assert.equal(result.safety, 'safe');
});

test('source-title-only explicit date range is conditional and not safe', () => {
  const result = classifyValidityRecovery({
    offer: offer({ sourceId: 'source-flyer' }),
    source: {
      _id: 'source-flyer',
      label: 'Flugblatt Do 07.05. bis Di 12.05.2026',
      sourceUrl: 'https://example.test/flyer-07-05-2026-12-05-2026',
    },
  });

  assert.equal(result.status, 'conditional_source_context_only');
  assert.equal(result.safety, 'conditional');
  assert.equal(inferRecoverability({
    offer: offer({ sourceId: 'source-flyer' }),
    source: { _id: 'source-flyer', label: 'Flugblatt Do 07.05. bis Di 12.05.2026' },
  }), 'conditional_source_context_only');
});

test('URL calendar week without explicit calendar date is conditional and not safe', () => {
  const result = classifyValidityRecovery({
    offer: offer({
      sourceUrl: 'https://example.test/angebote/kw-19/aktuelles-flugblatt',
    }),
  });

  assert.equal(result.status, 'conditional_source_context_only');
  assert.equal(result.safety, 'conditional');
});

test('fetchedAt observedAt and checkedAt are never safe', () => {
  const result = classifyValidityRecovery({
    offer: offer({
      rawFacts: {
        fetchedAt: '2026-05-01T00:00:00.000Z',
        observedAt: '2026-05-02T00:00:00.000Z',
        checkedAt: '2026-05-03T00:00:00.000Z',
      },
    }),
  });

  assert.equal(result.status, 'unsafe_fetched_or_observed_time');
  assert.equal(result.safety, 'unsafe');
});

test('missing validity evidence remains missing', () => {
  const result = classifyValidityRecovery({
    offer: offer({ sourceUrl: '' }),
  });

  assert.equal(result.status, 'missing');
  assert.equal(result.safety, 'unsafe');
});

test('diagnostic remains read-only and records no mutated collections', () => {
  const report = buildValidityCoverageDiagnostic({
    offers: [
      offer({
        validFrom: new Date('2026-05-01T00:00:00Z'),
        validTo: new Date('2026-05-08T23:59:59Z'),
      }),
    ],
  });

  assert.equal(report.ok, true);
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
});

test('safeSmallFixCandidates excludes source context only evidence', () => {
  const report = buildValidityCoverageDiagnostic({
    offers: [
      offer({
        _id: 'source-only',
        sourceId: 'source-flyer',
        sourceUrl: 'https://example.test/angebote/kw-19/aktuelles-flugblatt',
      }),
      offer({
        _id: 'safe-label',
        rawFacts: {
          validityLabel: 'gueltig von 01.05.2026 bis 08.05.2026',
        },
      }),
    ],
    sources: [
      {
        _id: 'source-flyer',
        retailerKey: 'billa',
        sourceType: 'billa-official-algolia',
        label: 'Aktuelles Flugblatt KW 19',
      },
    ],
  });

  assert.equal(report.summary.safelyRecoverableValidityCount, 1);
  assert.equal(report.summary.conditionallyRecoverableValidityCount, 1);
  assert.equal(report.safeSmallFixCandidates.length, 1);
  assert.equal(report.safeSmallFixCandidates[0].safety, 'safe');
});
