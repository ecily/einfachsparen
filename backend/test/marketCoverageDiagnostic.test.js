const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SMOKE_KEYWORDS,
  buildKeywordMatrix,
  buildHoferCategoryQualityDiagnostic,
  buildMarketCoverageDiagnostic,
  evaluateStatus,
  offerMatchesRetailer,
  simulateRankingVisibility,
  sourceDefinitionType,
  summarizeSourcesForRetailer,
} = require('../src/services/diagnostics/marketCoverageDiagnostic');

function offer(overrides = {}) {
  return {
    _id: overrides._id || Math.random().toString(16).slice(2),
    sourceId: overrides.sourceId || 'source-1',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    sourceRetailerFormat: 'spar',
    title: 'Kaffee 500 g',
    titleNormalized: 'kaffee 500 g',
    searchText: 'kaffee 500 g',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Kaffee & Tee',
    categoryKey: 'kaffee-tee',
    subcategoryKey: 'kaffee-tee',
    categoryConfidence: 0.9,
    sourceType: 'aktionsfinder-json',
    status: 'active',
    isActiveNow: true,
    validFrom: new Date('2026-05-08T00:00:00Z'),
    validTo: new Date('2026-05-12T23:59:59Z'),
    priceCurrent: { amount: 5.99 },
    quantityText: '500 g',
    normalizedUnitPrice: { amount: 11.98, unit: 'kg', comparable: true },
    conditionsText: '',
    customerProgramRequired: false,
    hasConditions: false,
    sortScoreDefault: 10,
    createdAt: new Date('2026-05-08T08:00:00Z'),
    updatedAt: new Date('2026-05-09T08:00:00Z'),
    ...overrides,
  };
}

test('maps source definitions into diagnostic source types', () => {
  assert.equal(sourceDefinitionType({ channel: 'official-site', sourceType: 'json', label: 'BILLA Aktionen' }), 'official_structured');
  assert.equal(sourceDefinitionType({ channel: 'official-flyer', sourceType: 'pdf', label: 'Flugblatt' }), 'official_flyer');
  assert.equal(sourceDefinitionType({ channel: 'aggregator', label: 'Aktionsfinder SPAR' }), 'aggregator');
  assert.equal(sourceDefinitionType({ channel: 'other', label: 'Manual note' }), 'other');
});

test('summarizes active and disabled retailer sources without mutating setup', () => {
  const summary = summarizeSourcesForRetailer({
    spec: { key: 'billa', label: 'BILLA', retailerKeys: ['billa'] },
    definitions: [],
    sources: [
      { retailerKey: 'billa', channel: 'official-site', sourceType: 'json', label: 'BILLA Aktionen', enabled: true, active: true },
      { retailerKey: 'billa', channel: 'aggregator', label: 'Marktguru BILLA', enabled: false, disabledReason: 'disabled-low-yield' },
    ],
  });

  assert.equal(summary.activeSourceCount, 1);
  assert.equal(summary.disabledSourceCount, 1);
  assert.equal(summary.hasActiveOfficialOrStructured, true);
  assert.equal(summary.disabledSources[0].reason, 'disabled-low-yield');
});

test('builds category and keyword matrix including required smoke keywords', () => {
  const keywords = buildKeywordMatrix();

  assert.equal(keywords.length, SMOKE_KEYWORDS.length);
  assert.ok(keywords.some((item) => item.keyword === 'kaffee'));
  assert.ok(keywords.some((item) => item.keyword === 'tiefkuehl'));
  assert.ok(keywords.every((item) => item.source === 'smoke-keyword'));
});

test('matches SPAR formats separately and through aggregate SPAR view', () => {
  const intersparOffer = offer({ sourceRetailerFormat: 'interspar' });

  assert.equal(offerMatchesRetailer(intersparOffer, { retailerKeys: ['spar'], formats: ['spar'] }), false);
  assert.equal(offerMatchesRetailer(intersparOffer, { retailerKeys: ['spar'], formats: ['interspar'] }), true);
  assert.equal(offerMatchesRetailer(intersparOffer, { retailerKeys: ['spar'], formats: ['spar', 'interspar', 'eurospar'], aggregate: true }), true);
});

test('evaluates status heuristic as ok, weak, critical, and unknown', () => {
  const goodSource = {
    activeSourceCount: 1,
    disabledSourceCount: 0,
    hasActiveOfficialOrStructured: true,
    hasOnlyAggregatorActive: false,
    hasNoUsableSource: false,
  };
  const quality = { missingOrUncertainCategoryShare: 0, sonstigesShare: 0 };

  assert.equal(evaluateStatus({
    sourceHealth: goodSource,
    categoryQuality: quality,
    metrics: {
      activeOfferCount: 6,
      totalOfferCount: 6,
      offersWithAnyValidity: 6,
      offersWithPrice: 6,
      offersWithUnitOrQuantity: 6,
      rankedOffersCount: 6,
    },
  }).status, 'ok');

  assert.equal(evaluateStatus({
    sourceHealth: { ...goodSource, hasOnlyAggregatorActive: true },
    categoryQuality: quality,
    metrics: {
      activeOfferCount: 3,
      totalOfferCount: 3,
      offersWithAnyValidity: 1,
      offersWithPrice: 3,
      offersWithUnitOrQuantity: 1,
      rankedOffersCount: 2,
    },
  }).status, 'weak');

  assert.equal(evaluateStatus({
    sourceHealth: { activeSourceCount: 1, disabledSourceCount: 0, hasActiveOfficialOrStructured: false, hasNoUsableSource: false },
    categoryQuality: quality,
    metrics: {
      activeOfferCount: 1,
      totalOfferCount: 1,
      offersWithAnyValidity: 1,
      offersWithPrice: 1,
      offersWithUnitOrQuantity: 1,
      rankedOffersCount: 1,
    },
  }).status, 'critical');

  assert.equal(evaluateStatus({
    sourceHealth: { activeSourceCount: 0, disabledSourceCount: 0, hasNoUsableSource: true },
    categoryQuality: quality,
    metrics: {
      activeOfferCount: 0,
      totalOfferCount: 0,
      offersWithAnyValidity: 0,
      offersWithPrice: 0,
      offersWithUnitOrQuantity: 0,
      rankedOffersCount: 0,
    },
  }).status, 'unknown');
});

test('simulates ranking visibility reasons without HTTP or DB', () => {
  const ranked = simulateRankingVisibility({
    query: 'kaffee',
    offers: [
      offer({ _id: 'visible', title: 'Kaffee sichtbar', searchText: 'kaffee sichtbar', sortScoreDefault: 20 }),
      offer({ _id: 'missing-search', title: '', searchText: '', sortScoreDefault: 10 }),
      offer({ _id: 'expired', title: 'Kaffee alt', status: 'expired', isActiveNow: false, validTo: new Date('2026-04-01T00:00:00Z') }),
    ],
    limit: 1,
  });

  assert.equal(ranked.rankedOffersCount, 1);
  assert.equal(ranked.dbOffersPresentButNotRanked, 1);
  assert.ok(ranked.visibilityReasons.some((reason) => reason.key === 'missing searchText'));
});

test('builds full read-only market coverage report with SPAR aggregate and recommendations', () => {
  const report = buildMarketCoverageDiagnostic({
    checkedAt: new Date('2026-05-09T12:00:00Z'),
    databaseName: 'test-db',
    categories: [
      { mainCategoryKey: 'kaffee-tee', mainCategoryLabel: 'Kaffee & Tee', isActive: true },
      { mainCategoryKey: 'milchprodukte', mainCategoryLabel: 'Milchprodukte', isActive: true },
    ],
    sources: [
      { retailerKey: 'spar', channel: 'aggregator', label: 'Aktionsfinder SPAR', sourceRetailerFormat: 'spar', enabled: true, active: true },
      { retailerKey: 'spar', channel: 'official-flyer', label: 'SPAR Aktionen', enabled: false, disabledReason: 'disabled-source-blocked' },
      { retailerKey: 'billa', channel: 'official-site', sourceType: 'json', label: 'BILLA Aktionen', enabled: true, active: true },
    ],
    offers: [
      offer({ _id: 'spar-coffee', sourceRetailerFormat: 'spar' }),
      offer({ _id: 'interspar-coffee', sourceRetailerFormat: 'interspar' }),
      offer({ _id: 'billa-milk', retailerKey: 'billa', retailerName: 'BILLA', title: 'Milch 1 l', searchText: 'milch 1 l', categoryKey: 'milchprodukte', categorySecondary: 'Milchprodukte' }),
    ],
  });

  const sparCoffee = report.coverageMatrix.find((item) =>
    item.retailerKey === 'spar' && item.dimensionType === 'keyword' && item.keyword === 'kaffee'
  );
  const aggregateCoffee = report.coverageMatrix.find((item) =>
    item.retailerKey === 'spar-aggregate' && item.dimensionType === 'keyword' && item.keyword === 'kaffee'
  );

  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(report.databaseName, 'test-db');
  assert.equal(sparCoffee.metrics.activeOfferCount, 1);
  assert.equal(aggregateCoffee.metrics.activeOfferCount, 2);
  assert.ok(report.recommendedNextActions.some((group) => group.cause === 'source_low_yield'));
  assert.ok(report.heuristic.statusRules.critical.length > 0);
});

test('keyword smoke ignores Buttergemuese as a real butter offer', () => {
  const report = buildMarketCoverageDiagnostic({
    checkedAt: new Date('2026-05-09T12:00:00Z'),
    categories: [],
    sources: [{ retailerKey: 'spar', channel: 'official-site', sourceType: 'json', label: 'SPAR Aktionen', enabled: true, active: true }],
    offers: [
      offer({
        _id: 'buttergemuese',
        title: 'iglo Buttergemuese 400 g',
        searchText: 'iglo buttergemuese lebensmittel tiefkuehl butter',
        categoryPrimary: 'Lebensmittel',
        categorySecondary: 'Tiefkuehl- & Fertigprodukte',
      }),
    ],
  });

  const butter = report.coverageMatrix.find((item) =>
    item.retailerKey === 'spar' && item.dimensionType === 'keyword' && item.keyword === 'butter'
  );
  const gemuese = report.coverageMatrix.find((item) =>
    item.retailerKey === 'spar' && item.dimensionType === 'keyword' && item.keyword === 'gemuese'
  );

  assert.equal(butter.metrics.totalOfferCount, 0);
  assert.equal(gemuese.metrics.totalOfferCount, 1);
});

test('keyword smoke treats Hendl as huhn synonym', () => {
  const report = buildMarketCoverageDiagnostic({
    checkedAt: new Date('2026-05-09T12:00:00Z'),
    categories: [],
    sources: [{ retailerKey: 'hofer', channel: 'official-site', sourceType: 'html', label: 'HOFER Angebote', enabled: true, active: true }],
    offers: [
      offer({
        _id: 'hofer-hendl',
        retailerKey: 'hofer',
        retailerName: 'HOFER',
        sourceRetailerFormat: '',
        title: 'Maishendl-Filetschnitzel mariniert HOFER 400 Gramm',
        searchText: 'maishendl filetschnitzel mariniert hofer fleisch',
        categoryPrimary: 'Lebensmittel',
        categorySecondary: 'Fleisch, Wurst & Fisch',
      }),
    ],
  });

  const huhn = report.coverageMatrix.find((item) =>
    item.retailerKey === 'hofer' && item.dimensionType === 'keyword' && item.keyword === 'huhn'
  );

  assert.equal(huhn.metrics.totalOfferCount, 1);
});

test('keyword smoke does not count category-only reis matches for passata', () => {
  const report = buildMarketCoverageDiagnostic({
    checkedAt: new Date('2026-05-09T12:00:00Z'),
    categories: [],
    sources: [{ retailerKey: 'spar', channel: 'official-site', sourceType: 'json', label: 'SPAR Aktionen', enabled: true, active: true }],
    offers: [
      offer({
        _id: 'passata',
        title: 'DESPAR Passata di Pomodoro 500 Gramm',
        searchText: 'despar passata di pomodoro pasta reis konserven lebensmittel',
        categoryPrimary: 'Lebensmittel',
        categorySecondary: 'Pasta, Reis & Konserven',
        categoryKey: 'pasta-reis-konserven',
        subcategoryKey: 'pasta-reis-konserven',
      }),
    ],
  });

  const reis = report.coverageMatrix.find((item) =>
    item.retailerKey === 'spar' && item.dimensionType === 'keyword' && item.keyword === 'reis'
  );

  assert.equal(reis.metrics.totalOfferCount, 0);
});

test('builds read-only HOFER category quality diagnostic split by source bucket', () => {
  const report = buildHoferCategoryQualityDiagnostic([
    offer({
      _id: 'hofer-weak-official',
      retailerKey: 'hofer',
      retailerName: 'HOFER',
      sourceType: 'hofer-official-html',
      title: 'Tandil Vollwaschmittel 2,025 kg',
      searchText: 'tandil vollwaschmittel',
      categoryPrimary: 'Freizeit / Sonstiges',
      categorySecondary: 'Sonstiges',
      categoryKey: 'sonstiges',
      subcategoryKey: 'sonstiges',
      categoryConfidence: 0.4,
      rawFacts: { sourceCategory: 'Aktionen' },
    }),
    offer({
      _id: 'hofer-weak-aktionsfinder',
      retailerKey: 'hofer',
      retailerName: 'HOFER',
      sourceType: 'aktionsfinder-json',
      title: 'Gardenline Premium Set',
      searchText: 'gardenline premium set',
      categoryPrimary: 'Unkategorisiert',
      categorySecondary: '',
      categoryKey: 'unkategorisiert',
      subcategoryKey: '',
      categoryConfidence: 0.2,
    }),
    offer({
      _id: 'spar-control',
      retailerKey: 'spar',
      retailerName: 'SPAR',
    }),
  ]);

  assert.equal(report.readOnly, true);
  assert.equal(report.totalOffers, 2);
  assert.equal(report.weakOffers, 2);
  assert.ok(report.sourceBuckets.some((bucket) => bucket.sourceBucket === 'hofer official flyer'));
  assert.ok(report.sourceBuckets.some((bucket) => bucket.sourceBucket === 'aktionsfinder-json'));
  assert.ok(report.productAreaCoverage.some((area) => area.key === 'haushalt-reinigung' && area.total === 1));
  assert.equal(report.projectedWithCurrentClassifier.improvedWeakOffers, 1);
  assert.equal(report.projectedWithCurrentClassifier.stillWeakOffers, 1);
});
