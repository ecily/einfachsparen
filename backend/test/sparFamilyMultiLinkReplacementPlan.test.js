const assert = require('node:assert/strict');
const test = require('node:test');

const fixtures = require('./fixtures/spar-family-multi-link-p1b-fixtures.json');
const {
  buildOfferDedupeKey,
  buildSparFamilyMultiLinkReplacementPlan,
  evaluateCoverageGuard,
} = require('../src/services/crawl/sparFamilyMultiLinkReplacementPlan');

function buildPlan(fixture, options = {}) {
  return buildSparFamilyMultiLinkReplacementPlan({
    group: fixture.group,
    links: fixture.links,
    ...options,
  });
}

test('plans SPAR main current links as one atomic replacement after all links are parsed', () => {
  const plan = buildPlan(fixtures.sparHappyPath);

  assert.equal(plan.diagnosticOnly, true);
  assert.equal(plan.productionEnabled, false);
  assert.equal(plan.status, 'ready-for-atomic-replacement');
  assert.equal(plan.shouldReplaceOnce, true);
  assert.equal(plan.plannedReplaceCallCount, 1);
  assert.equal(plan.partialReplacementAllowed, false);
  assert.equal(plan.previousDataRetention, 'replace-after-all-links-accepted');
  assert.deepEqual(plan.replacementScope, {
    retailerFormat: 'spar',
    region: 'steiermark',
    sourceKey: 'spar-official-flyer-current',
  });
  assert.equal(plan.collectedOfferCount, 5);
  assert.equal(plan.offerDocuments.length, 4);
  assert.equal(plan.duplicateCount, 1);

  const urlClasses = new Set(plan.offerDocuments.map((offer) => offer.sourceUrlClass));
  assert.deepEqual([...urlClasses].sort(), [
    'spar-main-flyer-regional-extra',
    'spar-main-flyer-weekly',
  ]);

  for (const offer of plan.offerDocuments) {
    assert.equal(offer.sourceKey, 'spar-official-flyer-current');
    assert.equal(offer.sourceRetailerFormat, 'spar');
    assert.equal(offer.retailerFormat, 'spar');
    assert.equal(offer.region, 'steiermark');
    assert.equal(offer.folderType, 'main-flyer');
    assert.equal(offer.rawFacts.sourceKey, 'spar-official-flyer-current');
    assert.equal(offer.rawFacts.sourceRetailerFormat, 'spar');
    assert.equal(offer.rawFacts.region, 'steiermark');
    assert.ok(offer.rawFacts.sourceUrlClass);
    assert.ok(offer.validFrom);
    assert.ok(offer.validTo);
  }
});

test('dedupes exact cross-link duplicates without dropping distinct offer variants', () => {
  const plan = buildPlan(fixtures.sparHappyPath);
  const titles = plan.offerDocuments.map((offer) => offer.title).sort();

  assert.equal(titles.filter((title) => title === 'DESPAR Olio Extra Vergine').length, 1);
  assert.ok(titles.includes('DESPAR Olio Extra Vergine Bio'));
  assert.notEqual(
    buildOfferDedupeKey(plan.offerDocuments.find((offer) => offer.title === 'DESPAR Olio Extra Vergine')),
    buildOfferDedupeKey(plan.offerDocuments.find((offer) => offer.title === 'DESPAR Olio Extra Vergine Bio'))
  );
});

test('plans INTERSPAR online current links together and tolerates small fragment rejections', () => {
  const plan = buildPlan(fixtures.intersparHappyPath);

  assert.equal(plan.status, 'ready-for-atomic-replacement');
  assert.equal(plan.plannedReplaceCallCount, 1);
  assert.equal(plan.offerDocuments.length, 4);
  assert.equal(plan.diagnostics.fragmentTitleCount, 1);
  assert.equal(plan.stopReasons.length, 0);
  assert.deepEqual(plan.replacementScope, {
    retailerFormat: 'interspar',
    region: 'steiermark',
    sourceKey: 'interspar-official-flyer-current',
  });
  assert.deepEqual(
    plan.offerDocuments.map((offer) => offer.title).sort(),
    [
      'Bio-Mohnflesserl',
      'Goesser Naturradler alkoholfrei',
      'Nocco BCAA',
      'Schaerdinger Protein Traum',
    ]
  );
});

test('blocks zero parsed group and keeps existing data', () => {
  const plan = buildPlan(fixtures.stopRuleCases.zeroParsed);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.shouldReplaceOnce, false);
  assert.equal(plan.plannedReplaceCallCount, 0);
  assert.equal(plan.previousDataRetention, 'keep-existing');
  assert.deepEqual(plan.offerDocuments, []);
  assert.ok(plan.stopReasons.includes('zero-parsed-offers'));
});

test('blocks coverage drop against stored baseline', () => {
  const plan = buildPlan(fixtures.stopRuleCases.coverageDrop);

  assert.equal(plan.status, 'blocked');
  assert.ok(plan.stopReasons.includes('coverage-drop'));
  assert.equal(plan.coverageGuard.baselineStoredCount, 28);
  assert.equal(plan.coverageGuard.nextCount, 2);
  assert.equal(plan.plannedReplaceCallCount, 0);
  assert.deepEqual(plan.offerDocuments, []);
});

test('evaluates coverage guard with SPAR and INTERSPAR baseline examples', () => {
  const spar = evaluateCoverageGuard({ baselineStoredCount: 28, nextCount: 26 });
  const interspar = evaluateCoverageGuard({ baselineStoredCount: 15, nextCount: 10 });

  assert.equal(spar.blocked, false);
  assert.equal(spar.baselineStoredCount, 28);
  assert.equal(spar.nextCount, 26);
  assert.equal(interspar.blocked, false);
  assert.equal(interspar.baselineStoredCount, 15);
  assert.equal(interspar.nextCount, 10);
});

test('blocks fragment-heavy parser output before replacement', () => {
  const plan = buildPlan(fixtures.stopRuleCases.fragmentHeavy);

  assert.equal(plan.status, 'blocked');
  assert.ok(plan.stopReasons.includes('fragment-heavy'));
  assert.equal(plan.previousDataRetention, 'keep-existing');
  assert.equal(plan.plannedReplaceCallCount, 0);
});

test('blocks missing per-link or per-offer validity', () => {
  const plan = buildPlan(fixtures.stopRuleCases.missingValidity);

  assert.equal(plan.status, 'blocked');
  assert.ok(plan.stopReasons.includes('missing-validity'));
  assert.equal(plan.previousDataRetention, 'keep-existing');
});

test('blocks transport failures such as 403 or 429 without partial replacement', () => {
  const plan = buildPlan(fixtures.stopRuleCases.transportBlocked);

  assert.equal(plan.status, 'blocked');
  assert.ok(plan.stopReasons.includes('transport-blocked'));
  assert.ok(plan.stopReasons.includes('zero-parsed-offers'));
  assert.equal(plan.partialReplacementAllowed, false);
  assert.equal(plan.plannedReplaceCallCount, 0);
});

test('blocks offers without a positive price', () => {
  const plan = buildPlan(fixtures.stopRuleCases.offersWithoutPrice);

  assert.equal(plan.status, 'blocked');
  assert.ok(plan.stopReasons.includes('offers-without-price'));
  assert.equal(plan.previousDataRetention, 'keep-existing');
});

test('blocks parser explosion when parsed offers exceed raw candidate shape', () => {
  const plan = buildPlan(fixtures.stopRuleCases.parserExplosion);

  assert.equal(plan.status, 'blocked');
  assert.ok(plan.stopReasons.includes('parser-explosion'));
  assert.equal(plan.previousDataRetention, 'keep-existing');
  assert.equal(plan.plannedReplaceCallCount, 0);
});

test('keeps replacement scope at retailer format, region, and source key instead of URL', () => {
  const plan = buildPlan(fixtures.intersparHappyPath);

  assert.deepEqual(Object.keys(plan.replacementScope).sort(), [
    'region',
    'retailerFormat',
    'sourceKey',
  ]);
  assert.equal(plan.replacementScope.sourceKey, 'interspar-official-flyer-current');
  assert.equal(plan.replacementScope.retailerFormat, 'interspar');
  assert.equal(plan.replacementScope.region, 'steiermark');
  assert.equal(plan.replacementScope.url, undefined);
  assert.equal(plan.replacementScope.sourceUrlClass, undefined);
});
