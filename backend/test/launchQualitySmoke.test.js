const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildLaunchReadiness,
  buildSmokeReadOnlyContract,
  detectSideHit,
  evaluateLaunchQualityResult,
} = require('../src/services/diagnostics/launchQualitySmoke');

function offer(overrides = {}) {
  return {
    _id: overrides._id || 'offer-id',
    retailerKey: 'hofer',
    retailerName: 'HOFER',
    title: 'Bio Vollmilch 1 l',
    titleNormalized: 'bio vollmilch 1 l',
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Milchprodukte',
    categoryKey: 'milchprodukte',
    sourceType: 'hofer-official-html',
    status: 'active',
    isActiveNow: true,
    validFrom: new Date('2026-05-07T12:00:00Z'),
    validTo: new Date('2026-05-12T12:00:00Z'),
    priceCurrent: { amount: 1.49, currency: 'EUR' },
    quantityText: '1 l',
    comparableUnit: 'l',
    normalizedUnitPrice: { amount: 1.49, unit: 'l', comparable: true },
    quality: { comparisonSafe: true },
    conditionsText: '',
    customerProgramRequired: false,
    hasConditions: false,
    isMultiBuy: false,
    ...overrides,
  };
}

test('launch smoke recognizes butter side hits', () => {
  const sideHit = detectSideHit('butter', offer({
    title: 'Peanut Butter Cups',
    categorySecondary: 'Suesswaren & Knabbereien',
  }));

  assert.equal(sideHit.isSideHit, true);
  assert.equal(sideHit.isSevereSideHit, true);
  assert.ok(sideHit.sideMatches.includes('peanut'));
});

test('launch smoke recognizes milk side hits', () => {
  const sideHit = detectSideHit('milch', offer({
    title: 'Milka Vollmilch Schokolade',
    categorySecondary: 'Suesswaren & Knabbereien',
  }));

  assert.equal(sideHit.isSideHit, true);
  assert.equal(sideHit.isSevereSideHit, true);
});

test('launch smoke recognizes reis category-only side hits', () => {
  const sideHit = detectSideHit('reis', offer({
    title: 'Tomaten Passata',
    titleNormalized: 'tomaten passata',
    categorySecondary: 'Reis & Pasta',
    categoryKey: 'reis-pasta',
  }));

  assert.equal(sideHit.isSideHit, true);
  assert.equal(sideHit.categoryOnlySideHit, true);
});

test('launch smoke recognizes chicken pet-food side hits', () => {
  const sideHit = detectSideHit('huhn', offer({
    title: 'Sheba Nassfutter mit Huhn',
    brand: 'Sheba',
    categoryPrimary: 'Tierbedarf',
    categorySecondary: 'Katzenfutter',
  }));

  assert.equal(sideHit.isSideHit, true);
  assert.equal(sideHit.isSevereSideHit, true);
});

test('launch smoke flags missing price quantity and validity', () => {
  const result = evaluateLaunchQualityResult({
    query: 'milch',
    rankedOffers: [
      offer({
        priceCurrent: { amount: null },
        quantityText: '',
        unitValue: null,
        totalComparableAmount: null,
        validTo: null,
        normalizedUnitPrice: { amount: null, unit: 'l', comparable: false },
        quality: { comparisonSafe: false },
      }),
    ],
    resultCount: 1,
  });
  const flags = result.rankedOffers[0].qualityFlags;

  assert.equal(flags.missingPrice, true);
  assert.equal(flags.missingQuantity, true);
  assert.equal(flags.unsafeOrMissingValidity, true);
  assert.equal(result.status, 'watch');
});

test('launch smoke flags visible duplicates', () => {
  const result = evaluateLaunchQualityResult({
    query: 'milch',
    rankedOffers: [
      offer({ _id: 'a' }),
      offer({ _id: 'b' }),
    ],
    resultCount: 2,
  });

  assert.equal(result.duplicateIssueCount, 2);
  assert.equal(result.rankedOffers[0].qualityFlags.likelyDuplicateVisible, true);
  assert.equal(result.rankedOffers[1].qualityFlags.likelyDuplicateVisible, true);
});

test('launch smoke status logic returns pass watch and fail conservatively', () => {
  const passResult = evaluateLaunchQualityResult({
    query: 'milch',
    rankedOffers: [
      offer({ _id: 'pass-a', title: 'Bio Vollmilch 1 l', titleNormalized: 'bio vollmilch 1 l' }),
      offer({ _id: 'pass-b', title: 'Frischmilch 1 l', titleNormalized: 'frischmilch 1 l', priceCurrent: { amount: 1.39 } }),
    ],
    resultCount: 2,
  });
  const watchResult = evaluateLaunchQualityResult({
    query: 'milch',
    rankedOffers: [
      offer({ _id: 'watch-a', validTo: null }),
    ],
    resultCount: 1,
  });
  const failResult = evaluateLaunchQualityResult({
    query: 'butter',
    rankedOffers: [
      offer({ _id: 'fail-a', title: 'Peanut Butter Cups', titleNormalized: 'peanut butter cups', categorySecondary: 'Suesswaren' }),
      offer({ _id: 'fail-b', title: 'Buttergemuese', titleNormalized: 'buttergemuese', categorySecondary: 'Tiefkuehl' }),
      offer({ _id: 'fail-c', title: 'Butter Me Up Lippenbalsam', titleNormalized: 'butter me up lippenbalsam', categoryPrimary: 'Drogerie / Hygiene', categorySecondary: 'Kosmetik' }),
    ],
    resultCount: 3,
  });
  const emptyResult = evaluateLaunchQualityResult({
    query: 'reis',
    rankedOffers: [],
    resultCount: 0,
  });

  assert.equal(passResult.status, 'pass');
  assert.equal(watchResult.status, 'watch');
  assert.equal(failResult.status, 'fail');
  assert.equal(emptyResult.status, 'fail');
});

test('launch smoke declares an explicit read-only contract', () => {
  assert.deepEqual(buildSmokeReadOnlyContract(), {
    readOnly: true,
    mutatedCollections: [],
  });
});

test('launch readiness classifies severe wrong Top 5 results as blockers', () => {
  const result = evaluateLaunchQualityResult({
    query: 'butter',
    rankedOffers: [
      offer({
        _id: 'wrong-butter',
        title: 'Peanut Butter Cups',
        titleNormalized: 'peanut butter cups',
        categorySecondary: 'Suesswaren',
      }),
    ],
    resultCount: 1,
  });
  const readiness = buildLaunchReadiness([result], []);

  assert.equal(readiness.status, 'not_ready');
  assert.equal(readiness.blockerCount, 1);
  assert.equal(readiness.blockers[0].readinessClass, 'launch_blocker');
  assert.ok(readiness.blockers[0].failReasons.includes('fail_severe_wrong_results'));
});

test('launch readiness classifies high-priority global zero results as blockers', () => {
  const result = evaluateLaunchQualityResult({
    query: 'reis',
    rankedOffers: [],
    resultCount: 0,
  });
  const readiness = buildLaunchReadiness([result], []);

  assert.equal(readiness.status, 'not_ready');
  assert.equal(readiness.blockerCount, 1);
  assert.ok(readiness.blockers[0].failReasons.includes('fail_zero_results'));
});

test('launch readiness classifies retailer-specific zero results as acceptable gaps when global coverage exists', () => {
  const globalResult = evaluateLaunchQualityResult({
    query: 'butter',
    rankedOffers: [
      offer({
        _id: 'butter-global',
        title: 'Teebutter 250 g',
        titleNormalized: 'teebutter 250 g',
        quantityText: '250 g',
      }),
    ],
    resultCount: 1,
  });
  const retailerResult = evaluateLaunchQualityResult({
    query: 'butter',
    retailer: { retailerKey: 'billa', retailerName: 'BILLA' },
    rankedOffers: [],
    resultCount: 0,
  });
  const readiness = buildLaunchReadiness([globalResult], [retailerResult]);

  assert.equal(readiness.blockerCount, 0);
  assert.equal(readiness.acceptableGapCount, 1);
  assert.equal(readiness.acceptableGaps[0].readinessClass, 'acceptable_mvp_gap');
  assert.ok(readiness.acceptableGaps[0].failReasons.includes('fail_retailer_specific_gap'));
});

test('launch readiness keeps validity-only uncertainty as watch and not blocker', () => {
  const result = evaluateLaunchQualityResult({
    query: 'milch',
    rankedOffers: [
      offer({
        _id: 'validity-watch',
        validTo: null,
      }),
    ],
    resultCount: 1,
  });
  const readiness = buildLaunchReadiness([result], []);

  assert.equal(readiness.blockerCount, 0);
  assert.equal(readiness.watchCount, 1);
  assert.ok(readiness.watchItems[0].failReasons.includes('fail_validity_watch_only'));
});

test('launch readiness treats tiernahrung zero results as MVP scope limit', () => {
  const result = evaluateLaunchQualityResult({
    query: 'tiernahrung',
    rankedOffers: [],
    resultCount: 0,
  });
  const readiness = buildLaunchReadiness([result], []);

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.blockerCount, 0);
  assert.equal(readiness.acceptableGapCount, 1);
  assert.ok(readiness.acceptableGaps[0].failReasons.includes('fail_zero_results'));
  assert.ok(readiness.recommendedMvpScopeLimits[0].includes('tiernahrung'));
});

test('launch readiness keeps plausible thin butter and reis coverage on watch without blockers', () => {
  const butterResult = evaluateLaunchQualityResult({
    query: 'butter',
    rankedOffers: [
      offer({ _id: 'butter-a', title: 'Teebutter 250 g', titleNormalized: 'teebutter 250 g', quantityText: '250 g' }),
      offer({ _id: 'butter-b', title: 'Streichfett 400 g', titleNormalized: 'streichfett 400 g', quantityText: '400 g' }),
      offer({ _id: 'butter-c', title: 'Butterschmalz 200 g', titleNormalized: 'butterschmalz 200 g', quantityText: '200 g' }),
      offer({ _id: 'butter-d', title: 'Margarine 500 g', titleNormalized: 'margarine 500 g', quantityText: '500 g' }),
    ],
    resultCount: 4,
  });
  const reisResult = evaluateLaunchQualityResult({
    query: 'reis',
    rankedOffers: [
      offer({ _id: 'reis-a', title: 'Basmati Reis 1 kg', titleNormalized: 'basmati reis 1 kg', quantityText: '1 kg', categorySecondary: 'Reis' }),
      offer({ _id: 'reis-b', title: 'Jasmin Reis 1 kg', titleNormalized: 'jasmin reis 1 kg', quantityText: '1 kg', categorySecondary: 'Reis' }),
      offer({ _id: 'reis-c', title: 'Risottoreis 500 g', titleNormalized: 'risottoreis 500 g', quantityText: '500 g', categorySecondary: 'Reis' }),
      offer({ _id: 'reis-d', title: 'Milchreis 500 g', titleNormalized: 'milchreis 500 g', quantityText: '500 g', categorySecondary: 'Reis' }),
      offer({ _id: 'reis-e', title: 'Langkorn Reis 1 kg', titleNormalized: 'langkorn reis 1 kg', quantityText: '1 kg', categorySecondary: 'Reis' }),
    ],
    resultCount: 5,
  });
  const readiness = buildLaunchReadiness([butterResult, reisResult], []);

  assert.equal(readiness.status, 'watch');
  assert.equal(readiness.blockerCount, 0);
  assert.equal(readiness.watchCount, 2);
  assert.deepEqual(readiness.watchItems.map((item) => item.query).sort(), ['butter', 'reis']);
  assert.ok(readiness.watchItems.every((item) => item.failReasons.includes('fail_too_few_results')));
});
