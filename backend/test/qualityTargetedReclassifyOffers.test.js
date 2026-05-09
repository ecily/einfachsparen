const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertApplyAllowed,
  HOFER_CATEGORY_PROFILE,
  isAllowedProjectedTarget,
  matchedAllowlistRules,
  parseArgs,
  planHoferCategoryReclassification,
  planOfferReclassification,
  runTargetedReclassify,
} = require('../scripts/qualityTargetedReclassifyOffers');

function offer(overrides = {}) {
  return {
    _id: overrides._id || 'offer-1',
    title: 'Schartner Bombe versch. Sorten 0.33 Liter 1 Dose',
    titleNormalized: 'schartner bombe versch sorten 0 33 liter 1 dose',
    brand: '',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    sourceRetailerFormat: 'eurospar',
    sourceType: 'aktionsfinder-json',
    categoryPrimary: 'Haushalt',
    categorySecondary: 'Aufbewahrung & Folien',
    categoryKey: 'aufbewahrung-folien',
    subcategoryKey: 'aufbewahrung-folien',
    comparisonCategoryKey: 'aufbewahrung-folien',
    categoryConfidence: 0.88,
    subcategoryConfidence: 0.84,
    searchText: 'spar schartner bombe haushalt aufbewahrung folien',
    rawFacts: {},
    priceCurrent: { amount: 0.69 },
    quantityText: '0.33 Liter 1 Dose',
    validFrom: new Date('2026-05-01T00:00:00Z'),
    validTo: new Date('2026-05-12T23:59:59Z'),
    sourceId: 'source-1',
    sourceUrl: 'https://example.test/source',
    sourceUrls: ['https://example.test/source'],
    evidenceUrls: ['https://example.test/evidence'],
    dedupeKey: 'dedupe-1',
    offerKey: 'offer-key-1',
    comparisonGroup: 'schartner-bombe::0-33-l',
    ...overrides,
  };
}

function rankingBuilder() {
  return Promise.resolve({
    summary: { resultCount: 0, displayedCount: 0 },
    rankedOffers: [],
  });
}

function hoferOffer(overrides = {}) {
  return offer({
    _id: 'hofer-1',
    title: 'Powerade Mountain Blast HOFER 0.5 Liter 1 Flasche',
    titleNormalized: 'powerade mountain blast hofer 0 5 liter 1 flasche',
    retailerKey: 'hofer',
    retailerName: 'HOFER',
    sourceRetailerFormat: 'hofer',
    sourceType: 'aktionsfinder-json',
    categoryPrimary: 'Freizeit / Sonstiges',
    categorySecondary: 'Sonstiges',
    categoryKey: 'sonstiges',
    subcategoryKey: 'sonstiges',
    comparisonCategoryKey: 'sonstiges',
    categoryConfidence: 0.42,
    subcategoryConfidence: 0.3,
    searchText: 'hofer powerade freizeit sonstiges',
    ...overrides,
  });
}

test('parseArgs defaults to dry-run with low max updates', () => {
  const options = parseArgs([]);

  assert.equal(options.apply, false);
  assert.equal(options.profile, 'default');
  assert.equal(options.limit, 50);
  assert.equal(options.maxUpdates, 20);
});

test('parseArgs supports hofer category profile as dry-run default', () => {
  const options = parseArgs(['--profile=hofer-category']);

  assert.equal(options.apply, false);
  assert.equal(options.profile, HOFER_CATEGORY_PROFILE);
  assert.equal(options.limit, 1000);
});

test('dry-run plans updates without writing', async () => {
  let writes = 0;
  const mockOfferModel = {
    updateOne: async () => {
      writes += 1;
      return { modifiedCount: 1 };
    },
  };
  const result = await runTargetedReclassify({
    options: parseArgs(['--json']),
    databaseName: 'production',
    offerModel: mockOfferModel,
    loadOffers: async () => [offer()],
    rankingBuilder,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.plannedUpdateCount, 1);
  assert.equal(result.appliedUpdateCount, 0);
  assert.equal(writes, 0);
});

test('default profile keeps existing targeted allowlist behavior', async () => {
  const result = await runTargetedReclassify({
    options: parseArgs(['--json']),
    databaseName: 'production',
    offerModel: { updateOne: async () => ({ modifiedCount: 1 }) },
    loadOffers: async () => [offer()],
    rankingBuilder,
  });

  assert.equal(result.profile, 'default');
  assert.equal(result.plannedUpdateCount, 1);
  assert.equal(result.matchedCount, 1);
});

test('apply is blocked when database is not einfachsparen_dev', () => {
  assert.throws(
    () => assertApplyAllowed({
      apply: true,
      databaseName: 'production',
      plannedUpdateCount: 1,
      maxUpdates: 20,
    }),
    /databaseName must be exactly einfachsparen_dev/
  );
});

test('apply without --apply is treated as dry-run', () => {
  const result = assertApplyAllowed({
    apply: false,
    databaseName: 'production',
    plannedUpdateCount: 1,
    maxUpdates: 20,
  });

  assert.equal(result.dryRun, true);
});

test('hofer-category profile plans only HOFER offers', async () => {
  const result = await runTargetedReclassify({
    options: parseArgs(['--profile=hofer-category', '--json']),
    databaseName: 'production',
    offerModel: { updateOne: async () => ({ modifiedCount: 1 }) },
    loadOffers: async () => [
      hoferOffer({ _id: 'hofer-planned' }),
      hoferOffer({
        _id: 'spar-same-title',
        retailerKey: 'spar',
        retailerName: 'SPAR',
        sourceRetailerFormat: 'spar',
      }),
    ],
    rankingBuilder,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.plannedUpdateCount, 1);
  assert.equal(result.appliedUpdateCount, 0);
  assert.equal(result.diffSummary.changedOffers[0]._id, 'hofer-planned');
  assert.equal(result.skipReasons['not hofer'], 1);
});

test('hofer-category skips non-HOFER offers even when classifier could improve them', () => {
  const plan = planHoferCategoryReclassification(hoferOffer({
    retailerKey: 'spar',
    retailerName: 'SPAR',
    sourceRetailerFormat: 'spar',
  }));

  assert.equal(plan.status, 'skipped');
  assert.equal(plan.reason, 'not hofer');
  assert.equal(plan.update, null);
});

test('hofer-category skips brand-only titles without a safe product signal', () => {
  const plan = planHoferCategoryReclassification(hoferOffer({
    title: 'Mamia Vorteilspackung HOFER',
    rawFacts: { sourceCategory: 'Baby / Kinder Windeln' },
  }));

  assert.equal(plan.status, 'skipped');
  assert.equal(plan.reason, 'low-confidence / no safe product signal');
  assert.equal(plan.update, null);
});

test('hofer-category only plans allowed target categories', () => {
  const allowed = planHoferCategoryReclassification(hoferOffer());
  const outsideTarget = planHoferCategoryReclassification(hoferOffer({
    title: 'Gasteiner Infinity Water Powerade HOFER 0.5 Liter 1 Flasche',
  }));

  assert.equal(allowed.status, 'planned');
  assert.equal(allowed.after.categoryPrimary, 'Getraenke');
  assert.equal(allowed.after.categorySecondary, 'Softdrinks & Energy');
  assert.equal(outsideTarget.status, 'skipped');
  assert.equal(outsideTarget.reason, 'projected category outside allowed hofer targets');
});

test('hofer-category skips device and tool offers without a safe device target category', () => {
  const plan = planHoferCategoryReclassification(hoferOffer({
    title: 'Hyundai Hochdruckreiniger HOFER 1 Stueck',
    categoryPrimary: 'Freizeit / Sonstiges',
    categorySecondary: 'Sport & Camping',
    categoryKey: 'sport-camping',
    subcategoryKey: 'sport-camping',
    comparisonCategoryKey: 'sport-camping',
    categoryConfidence: 0.42,
    subcategoryConfidence: 0.3,
  }));

  assert.equal(plan.status, 'skipped');
  assert.equal(plan.reason, 'no safe target category for device/tool');
  assert.equal(plan.update, null);
});

test('hofer-category apply is blocked outside einfachsparen_dev', async () => {
  await assert.rejects(
    () => runTargetedReclassify({
      options: parseArgs(['--profile=hofer-category', '--apply']),
      databaseName: 'production',
      offerModel: { updateOne: async () => ({ modifiedCount: 1 }) },
      loadOffers: async () => [hoferOffer()],
      rankingBuilder,
    }),
    /databaseName must be exactly einfachsparen_dev/
  );
});

test('only allowlist titles are updated', async () => {
  const writes = [];
  const mockOfferModel = {
    updateOne: async (filter, update) => {
      writes.push({ filter, update });
      return { modifiedCount: 1 };
    },
  };
  const result = await runTargetedReclassify({
    options: parseArgs(['--apply']),
    databaseName: 'einfachsparen_dev',
    offerModel: mockOfferModel,
    loadOffers: async () => [
      offer({ _id: 'allowed' }),
      offer({
        _id: 'not-allowed',
        title: 'Unrelated Camping Set',
        categoryPrimary: 'Freizeit / Sonstiges',
        categorySecondary: 'Sport & Camping',
      }),
    ],
    rankingBuilder,
  });

  assert.equal(result.plannedUpdateCount, 1);
  assert.equal(result.appliedUpdateCount, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].filter, { _id: 'allowed' });
});

test('max-updates is respected and blocks apply', async () => {
  await assert.rejects(
    () => runTargetedReclassify({
      options: parseArgs(['--apply', '--max-updates=1']),
      databaseName: 'einfachsparen_dev',
      offerModel: { updateOne: async () => ({ modifiedCount: 1 }) },
      loadOffers: async () => [
        offer({ _id: 'one' }),
        offer({ _id: 'two', title: 'Gasteiner Infinity Water versch. Sorten 0.33 Liter 1 Dose' }),
      ],
      rankingBuilder,
    }),
    /planned updates 2 exceed --max-updates=1/
  );
});

test('projected targets must fit the matched allowlist rule', () => {
  assert.equal(
    isAllowedProjectedTarget(
      [{ allowedTargets: [['Getraenke', 'Wasser']] }],
      { primaryCategory: 'Getraenke', secondaryCategory: 'Wasser' }
    ),
    true
  );
  assert.equal(
    isAllowedProjectedTarget(
      [{ allowedTargets: [['Lebensmittel', 'Tiefkuehl- & Fertigprodukte']] }],
      { primaryCategory: 'Lebensmittel', secondaryCategory: 'Saucen, Oele & Gewuerze' }
    ),
    false
  );
});

test('price quantity validity source and dedupe fields stay unchanged in planned update', () => {
  const sourceOffer = offer();
  const plan = planOfferReclassification(sourceOffer);

  assert.equal(plan.status, 'planned');
  assert.ok(plan.changedFields.includes('categoryPrimary'));
  assert.equal(plan.after.price, sourceOffer.priceCurrent.amount);
  assert.equal(plan.after.quantityText, sourceOffer.quantityText);
  assert.equal(plan.after.validFrom, sourceOffer.validFrom.toISOString());
  assert.equal(plan.after.validTo, sourceOffer.validTo.toISOString());
  assert.equal(plan.after.sourceId, sourceOffer.sourceId);
  assert.equal(plan.after.sourceUrl, sourceOffer.sourceUrl);
  assert.equal(plan.after.dedupeKey, sourceOffer.dedupeKey);
  assert.deepEqual(Object.keys(plan.update).sort(), [
    'categoryConfidence',
    'categoryKey',
    'categoryPrimary',
    'categorySecondary',
    'comparisonCategoryKey',
    'searchText',
    'subcategoryConfidence',
    'subcategoryKey',
  ].sort());
});

test('hofer-category planned update leaves price quantity validity source and dedupe fields unchanged', () => {
  const sourceOffer = hoferOffer();
  const plan = planHoferCategoryReclassification(sourceOffer);

  assert.equal(plan.status, 'planned');
  assert.equal(plan.after.price, sourceOffer.priceCurrent.amount);
  assert.equal(plan.after.quantityText, sourceOffer.quantityText);
  assert.equal(plan.after.validFrom, sourceOffer.validFrom.toISOString());
  assert.equal(plan.after.validTo, sourceOffer.validTo.toISOString());
  assert.equal(plan.after.sourceId, sourceOffer.sourceId);
  assert.equal(plan.after.sourceUrl, sourceOffer.sourceUrl);
  assert.equal(plan.after.dedupeKey, sourceOffer.dedupeKey);
  assert.deepEqual(Object.keys(plan.update).sort(), [
    'categoryConfidence',
    'categoryKey',
    'categoryPrimary',
    'categorySecondary',
    'comparisonCategoryKey',
    'searchText',
    'subcategoryConfidence',
    'subcategoryKey',
  ].sort());
});

test('hofer-category summary includes profile and skip reasons', async () => {
  const result = await runTargetedReclassify({
    options: parseArgs(['--profile=hofer-category', '--json']),
    databaseName: 'production',
    offerModel: { updateOne: async () => ({ modifiedCount: 1 }) },
    loadOffers: async () => [
      hoferOffer(),
      hoferOffer({ _id: 'not-hofer', retailerKey: 'spar', retailerName: 'SPAR', sourceRetailerFormat: 'spar' }),
    ],
    rankingBuilder,
  });

  assert.equal(result.afterSummary.profile, HOFER_CATEGORY_PROFILE);
  assert.equal(result.diffSummary.profile, HOFER_CATEGORY_PROFILE);
  assert.equal(result.afterSummary.skipReasons['not hofer'], 1);
});

test('category change is reported as diff', () => {
  const plan = planOfferReclassification(offer());

  assert.equal(plan.before.categoryPrimary, 'Haushalt');
  assert.equal(plan.after.categoryPrimary, 'Getraenke');
  assert.equal(plan.after.categorySecondary, 'Softdrinks & Energy');
  assert.ok(plan.changedFields.includes('categoryPrimary'));
  assert.ok(plan.changedFields.includes('categorySecondary'));
});

test('unchanged allowlist offers are skipped', () => {
  const unchanged = offer({
    title: 'Gasteiner Infinity Water versch. Sorten 0.33 Liter 1 Dose',
    categoryPrimary: 'Getraenke',
    categorySecondary: 'Wasser',
    categoryKey: 'wasser',
    subcategoryKey: 'wasser',
    comparisonCategoryKey: 'wasser',
    searchText: 'spar gasteiner infinity water getraenke wasser wasser 0 33 liter 1 dose',
  });
  const plan = planOfferReclassification(unchanged);

  assert.equal(matchedAllowlistRules(unchanged).length, 1);
  assert.equal(plan.status, 'skipped');
  assert.equal(plan.reason, 'unchanged');
  assert.equal(plan.update, null);
});
