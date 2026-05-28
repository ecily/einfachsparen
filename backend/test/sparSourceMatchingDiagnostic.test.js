const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildSparPdfRejectedCandidateEvidence,
  buildSparSourceMatchingDiagnostic,
  scorePair,
} = require('../src/services/diagnostics/sparSourceMatchingDiagnostic');
const { summarizeRejections } = require('../src/services/crawl/sparOfficialFlyerPdfParser');

function offer(overrides = {}) {
  const sourceKey = overrides.sourceKey || 'spar-official-flyer-pdf';
  const sourceType = overrides.sourceType || 'spar-official-pdf';

  return {
    _id: overrides._id || `${sourceKey}-${Math.random().toString(16).slice(2)}`,
    retailerKey: overrides.retailerKey || 'spar',
    retailerName: overrides.retailerName || 'SPAR',
    sourceRetailerFormat: overrides.sourceRetailerFormat || 'spar',
    sourceKey,
    sourceType,
    title: overrides.title || 'Ja Natuerlich Bio Milch 1 l',
    titleNormalized: overrides.titleNormalized || '',
    brand: overrides.brand || 'Ja Natuerlich',
    categoryPrimary: overrides.categoryPrimary || 'Lebensmittel',
    categorySecondary: overrides.categorySecondary || 'Milchprodukte',
    categoryKey: overrides.categoryKey || 'milchprodukte',
    subcategoryKey: overrides.subcategoryKey || 'milch',
    priceCurrent: overrides.priceCurrent || { amount: 1.29, currency: 'EUR' },
    quantityText: overrides.quantityText || '1 l',
    unitValue: overrides.unitValue ?? 1,
    unitType: overrides.unitType || 'l',
    totalComparableAmount: overrides.totalComparableAmount ?? 1,
    comparableUnit: overrides.comparableUnit || 'l',
    validFrom: overrides.validFrom === undefined ? new Date('2026-05-21T00:00:00.000Z') : overrides.validFrom,
    validTo: overrides.validTo === undefined ? new Date('2026-05-27T23:59:59.000Z') : overrides.validTo,
    conditionsText: overrides.conditionsText || '',
    imageUrl: overrides.imageUrl || '',
    quality: overrides.quality || { comparisonSafe: true },
    rawFacts: overrides.rawFacts || { sourceKey, sourceType },
    ...overrides,
  };
}

function aggregator(overrides = {}) {
  const sourceKey = overrides.sourceKey || 'aktionsfinder-spar';
  return offer({
    sourceKey,
    sourceType: 'aktionsfinder-json',
    imageUrl: 'https://images.example.test/milch.jpg',
    rawFacts: { sourceKey, sourceType: 'aktionsfinder-json' },
    ...overrides,
  });
}

function textQuantity(overrides = {}) {
  return {
    quantityText: '',
    packCount: null,
    unitValue: null,
    unitType: '',
    totalComparableAmount: null,
    comparableUnit: '',
    normalizedUnitPrice: null,
    ...overrides,
  };
}

test('strong match for same brand title quantity price and SPAR format allows image validity and merge suggestions', () => {
  const result = scorePair(
    offer({ _id: 'pdf-milch' }),
    aggregator({ _id: 'af-milch' })
  );

  assert.equal(result.matchLevel, 'strong');
  assert.equal(result.canUseAggregatorImage, true);
  assert.equal(result.canUsePdfValidity, true);
  assert.equal(result.shouldMergeLater, true);
  assert.deepEqual(result.unsafeReasons, []);
});

test('Puntigamer crate threshold offer can be strong when mechanics quantity and price are compatible', () => {
  const pdf = offer({
    _id: 'pdf-puntigamer-kiste',
    title: 'Puntigamer Maerzen Kiste 20 x 0.5 l',
    brand: 'Puntigamer',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
    subcategoryKey: 'bier',
    priceCurrent: { amount: 14.9, currency: 'EUR' },
    quantityText: '20 x 0.5 l',
    packCount: 20,
    unitValue: 0.5,
    unitType: 'l',
    totalComparableAmount: 10,
    comparableUnit: 'l',
    conditionsText: '1+1 gratis / ab 2 Kisten je 14,90',
  });
  const af = aggregator({
    _id: 'af-puntigamer-kiste',
    title: 'Puntigamer Maerzen Kiste',
    brand: 'Puntigamer',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
    subcategoryKey: 'bier',
    priceCurrent: { amount: 14.9, currency: 'EUR' },
    quantityText: '20 x 0.5 l',
    packCount: 20,
    unitValue: 0.5,
    unitType: 'l',
    totalComparableAmount: 10,
    comparableUnit: 'l',
    conditionsText: 'ab 2 Kisten je 14,90',
    imageUrl: 'https://images.example.test/puntigamer-kiste.jpg',
  });

  const result = scorePair(pdf, af);

  assert.equal(result.matchLevel, 'strong');
  assert.equal(result.canUseAggregatorImage, true);
  assert.equal(result.canUsePdfConditions, true);
});

test('SPAR diagnostic treats equivalent beer crate text quantities as same quantity', () => {
  const result = scorePair(
    offer(textQuantity({
      _id: 'pdf-schwechater',
      title: 'Schwechater Bier 20 x 0,5 Liter',
      brand: 'Schwechater',
      categorySecondary: 'Bier',
      categoryKey: 'bier',
      subcategoryKey: 'bier',
      priceCurrent: { amount: 15.99, currency: 'EUR' },
    })),
    aggregator(textQuantity({
      _id: 'af-schwechater',
      title: 'Schwechater Bier 0.50 Liter 20 Stueck',
      brand: 'Schwechater',
      categorySecondary: 'Getraenke',
      categoryKey: 'getraenke',
      subcategoryKey: 'getraenke',
      priceCurrent: { amount: 15.99, currency: 'EUR' },
    }))
  );

  assert.equal(result.quantityDiagnostics.state, 'same');
  assert.equal(result.matchLevel, 'strong');
  assert.ok(result.reasons.includes('category-compatible'));
  assert.equal(result.unsafeReasons.includes('quantity-conflict'), false);
  assert.equal(result.canUseAggregatorImage, true);
});

test('Puntigamer crate threshold text matches only with compatible price and pack logic', () => {
  const pdf = offer(textQuantity({
    _id: 'pdf-puntigamer-text-kiste',
    title: 'Puntigamer Maerzen 1 Kiste 20 x 0.5 l',
    brand: 'Puntigamer',
    categorySecondary: 'Bier',
    categoryKey: 'bier',
    subcategoryKey: 'bier',
    priceCurrent: { amount: 14.9, currency: 'EUR' },
    conditionsText: 'ab 2 Kisten je 14,90',
  }));
  const matchingAggregator = aggregator(textQuantity({
    _id: 'af-puntigamer-text-kiste',
    title: 'Puntigamer Maerzen 0.5 Liter 20 Stueck',
    brand: 'Puntigamer',
    categorySecondary: 'Getraenke',
    categoryKey: 'getraenke',
    subcategoryKey: 'getraenke',
    priceCurrent: { amount: 14.9, currency: 'EUR' },
    conditionsText: 'ab 2 Kisten',
  }));
  const wrongPriceAggregator = aggregator(textQuantity({
    _id: 'af-puntigamer-wrong-price',
    title: 'Puntigamer Maerzen 0.5 Liter 20 Stueck',
    brand: 'Puntigamer',
    categorySecondary: 'Getraenke',
    categoryKey: 'getraenke',
    subcategoryKey: 'getraenke',
    priceCurrent: { amount: 19.99, currency: 'EUR' },
    conditionsText: 'ab 2 Kisten',
  }));

  const match = scorePair(pdf, matchingAggregator);
  const wrongPrice = scorePair(pdf, wrongPriceAggregator);

  assert.equal(match.matchLevel, 'strong');
  assert.equal(match.quantityDiagnostics.state, 'same');
  assert.notEqual(wrongPrice.matchLevel, 'strong');
  assert.ok(wrongPrice.unsafeReasons.includes('price-conflict'));
});

test('SPAR diagnostic matches cans and bottle multipack notation variants', () => {
  const cans = scorePair(
    offer(textQuantity({
      _id: 'pdf-cans',
      title: 'Ottakringer Bier 24 Dosen a 0.5 l',
      brand: 'Ottakringer',
      categoryKey: 'bier',
      subcategoryKey: 'bier',
      priceCurrent: { amount: 18.99, currency: 'EUR' },
    })),
    aggregator(textQuantity({
      _id: 'af-cans',
      title: 'Ottakringer Bier 0.5 l 24 Stueck',
      brand: 'Ottakringer',
      categoryKey: 'getraenke',
      subcategoryKey: 'getraenke',
      priceCurrent: { amount: 18.99, currency: 'EUR' },
    }))
  );
  const bottles = scorePair(
    offer(textQuantity({
      _id: 'pdf-bottles',
      title: 'Goesser Naturradler 6 Flaschen 0.33 l',
      brand: 'Goesser',
      categoryKey: 'bier',
      subcategoryKey: 'bier',
      priceCurrent: { amount: 5.49, currency: 'EUR' },
    })),
    aggregator(textQuantity({
      _id: 'af-bottles',
      title: 'Goesser Naturradler 6 x 0.33 l',
      brand: 'Goesser',
      categoryKey: 'getraenke',
      subcategoryKey: 'getraenke',
      priceCurrent: { amount: 5.49, currency: 'EUR' },
    }))
  );

  assert.equal(cans.quantityDiagnostics.state, 'same');
  assert.equal(cans.matchLevel, 'strong');
  assert.equal(bottles.quantityDiagnostics.state, 'same');
  assert.equal(bottles.matchLevel, 'strong');
});

test('medium match when quantity is missing on one side but identity and price are strong', () => {
  const result = scorePair(
    offer({
      _id: 'pdf-lavazza',
      title: 'Lavazza Caffe Crema ganze Bohne 1 kg',
      brand: 'Lavazza',
      categoryKey: 'kaffee',
      subcategoryKey: 'kaffee',
      priceCurrent: { amount: 12.99, currency: 'EUR' },
      quantityText: '1 kg',
      unitValue: 1,
      unitType: 'kg',
      totalComparableAmount: 1,
      comparableUnit: 'kg',
    }),
    aggregator({
      _id: 'af-lavazza',
      title: 'Lavazza Caffe Crema ganze Bohne',
      brand: 'Lavazza',
      categoryKey: 'kaffee',
      subcategoryKey: 'kaffee',
      priceCurrent: { amount: 12.99, currency: 'EUR' },
      quantityText: '',
      unitValue: null,
      unitType: '',
      totalComparableAmount: null,
      comparableUnit: '',
    })
  );

  assert.equal(result.matchLevel, 'medium');
  assert.equal(result.canUseAggregatorImage, false);
  assert.equal(result.canUsePdfValidity, false);
});

test('different retailer format prevents strong match and merge', () => {
  const result = scorePair(
    offer({ _id: 'pdf-spar', sourceRetailerFormat: 'spar', retailerKey: 'spar' }),
    aggregator({
      _id: 'af-interspar',
      sourceKey: 'aktionsfinder-interspar',
      sourceRetailerFormat: 'interspar',
      retailerKey: 'interspar',
    })
  );

  assert.equal(result.matchLevel, 'none');
  assert.equal(result.shouldMergeLater, false);
  assert.ok(result.unsafeReasons.includes('retailer-format-conflict'));
});

test('medium and weak matches never allow image transfer', () => {
  const medium = scorePair(
    offer({
      _id: 'pdf-medium',
      title: 'Coca Cola Original 1.5 l',
      brand: 'Coca Cola',
      quantityText: '1.5 l',
      unitValue: 1.5,
      totalComparableAmount: 1.5,
      priceCurrent: { amount: 1.49, currency: 'EUR' },
    }),
    aggregator({
      _id: 'af-medium',
      title: 'Coca Cola Original',
      brand: 'Coca Cola',
      quantityText: '',
      unitValue: null,
      totalComparableAmount: null,
      priceCurrent: { amount: 1.49, currency: 'EUR' },
    })
  );

  assert.equal(medium.matchLevel, 'medium');
  assert.equal(medium.canUseAggregatorImage, false);
});

test('same brand but different sort or quantity is unsafe and not mergeable', () => {
  const variant = scorePair(
    offer({
      _id: 'pdf-milka-vollmilch',
      title: 'Milka Schokolade Vollmilch 100 g',
      brand: 'Milka',
      quantityText: '100 g',
      unitValue: 100,
      unitType: 'g',
      totalComparableAmount: 0.1,
      comparableUnit: 'kg',
      priceCurrent: { amount: 1.49, currency: 'EUR' },
    }),
    aggregator({
      _id: 'af-milka-noisette',
      title: 'Milka Schokolade Noisette 100 g',
      brand: 'Milka',
      quantityText: '100 g',
      unitValue: 100,
      unitType: 'g',
      totalComparableAmount: 0.1,
      comparableUnit: 'kg',
      priceCurrent: { amount: 1.49, currency: 'EUR' },
    })
  );
  const quantity = scorePair(
    offer({
      _id: 'pdf-rama-250',
      title: 'Rama Cremefine 250 ml',
      brand: 'Rama',
      quantityText: '250 ml',
      unitValue: 250,
      unitType: 'ml',
      totalComparableAmount: 0.25,
      comparableUnit: 'l',
      priceCurrent: { amount: 1.49, currency: 'EUR' },
    }),
    aggregator({
      _id: 'af-rama-500',
      title: 'Rama Cremefine 500 ml',
      brand: 'Rama',
      quantityText: '500 ml',
      unitValue: 500,
      unitType: 'ml',
      totalComparableAmount: 0.5,
      comparableUnit: 'l',
      priceCurrent: { amount: 1.49, currency: 'EUR' },
    })
  );

  assert.notEqual(variant.matchLevel, 'strong');
  assert.equal(variant.shouldMergeLater, false);
  assert.ok(variant.unsafeReasons.includes('variant-or-sort-conflict'));
  assert.notEqual(quantity.matchLevel, 'strong');
  assert.equal(quantity.shouldMergeLater, false);
  assert.ok(quantity.unsafeReasons.includes('quantity-conflict'));
});

test('bundle conflict blocks conditions transfer', () => {
  const result = scorePair(
    offer({
      _id: 'pdf-bundle',
      title: 'Gourmet Kaffee 500 g',
      brand: 'Gourmet',
      quantityText: '500 g',
      unitValue: 500,
      unitType: 'g',
      totalComparableAmount: 0.5,
      comparableUnit: 'kg',
      priceCurrent: { amount: 5.99, currency: 'EUR' },
      conditionsText: '1+1 gratis',
    }),
    aggregator({
      _id: 'af-bundle',
      title: 'Gourmet Kaffee 500 g',
      brand: 'Gourmet',
      quantityText: '500 g',
      unitValue: 500,
      unitType: 'g',
      totalComparableAmount: 0.5,
      comparableUnit: 'kg',
      priceCurrent: { amount: 5.99, currency: 'EUR' },
      conditionsText: 'ab 3 Packungen',
    })
  );

  assert.notEqual(result.matchLevel, 'strong');
  assert.equal(result.canUsePdfConditions, false);
  assert.ok(result.unsafeReasons.includes('promotion-mechanic-conflict'));
});

test('single can is not a strong match for a 24 can multipack', () => {
  const result = scorePair(
    offer(textQuantity({
      _id: 'pdf-single-can',
      title: 'Goesser Bier 0.5 l Einzel-Dose',
      brand: 'Goesser',
      categoryKey: 'bier',
      subcategoryKey: 'bier',
      priceCurrent: { amount: 19.99, currency: 'EUR' },
    })),
    aggregator(textQuantity({
      _id: 'af-can-pack',
      title: 'Goesser Bier 24 Dosen a 0.5 l',
      brand: 'Goesser',
      categoryKey: 'bier',
      subcategoryKey: 'bier',
      priceCurrent: { amount: 19.99, currency: 'EUR' },
    }))
  );

  assert.notEqual(result.matchLevel, 'strong');
  assert.ok(result.unsafeReasons.includes('quantity-conflict'));
  assert.ok(result.quantityDiagnostics.unsafeQuantityReasons.includes('single-vs-multipack-risk'));
});

test('same beer brand but different variant is unsafe and not strong', () => {
  const result = scorePair(
    offer(textQuantity({
      _id: 'pdf-maerzen',
      title: 'Puntigamer Maerzen 20 x 0.5 l',
      brand: 'Puntigamer',
      categoryKey: 'bier',
      subcategoryKey: 'bier',
      priceCurrent: { amount: 14.9, currency: 'EUR' },
    })),
    aggregator(textQuantity({
      _id: 'af-radler',
      title: 'Puntigamer Radler 20 x 0.5 l',
      brand: 'Puntigamer',
      categoryKey: 'bier',
      subcategoryKey: 'bier',
      priceCurrent: { amount: 14.9, currency: 'EUR' },
    }))
  );

  assert.notEqual(result.matchLevel, 'strong');
  assert.ok(result.unsafeReasons.includes('variant-or-sort-conflict'));
});

test('same price alone is never strong', () => {
  const result = scorePair(
    offer({
      _id: 'pdf-price-only',
      title: 'S-Budget Teigwaren 500 g',
      brand: 'S-Budget',
      quantityText: '500 g',
      priceCurrent: { amount: 1.99, currency: 'EUR' },
    }),
    aggregator({
      _id: 'af-price-only',
      title: 'Frische Erdbeeren 500 g',
      brand: 'Natur Pur',
      quantityText: '500 g',
      priceCurrent: { amount: 1.99, currency: 'EUR' },
    })
  );

  assert.notEqual(result.matchLevel, 'strong');
  assert.equal(result.shouldMergeLater, false);
});

test('unsafe reasons detect tea coffee teebutter pet food and alcohol conflicts', () => {
  const coffeeTea = scorePair(
    offer({ _id: 'pdf-coffee', title: 'Jacobs Kaffee 500 g', brand: 'Jacobs', categoryKey: 'kaffee', subcategoryKey: 'kaffee' }),
    aggregator({ _id: 'af-teebutter', title: 'Schärdinger Teebutter 250 g', brand: 'Schärdinger', categoryKey: 'butter', subcategoryKey: 'butter' })
  );
  const petFood = scorePair(
    offer({ _id: 'pdf-food', title: 'Rind Fleisch 1 kg', brand: 'Tann', categoryKey: 'fleisch', subcategoryKey: 'fleisch' }),
    aggregator({ _id: 'af-pet', title: 'Whiskas Katzenfutter 1 kg', brand: 'Whiskas', categoryKey: 'tierfutter', subcategoryKey: 'tierfutter' })
  );
  const alcohol = scorePair(
    offer({ _id: 'pdf-radler', title: 'Goesser Naturradler Zitrone 0.5 l', brand: 'Goesser' }),
    aggregator({ _id: 'af-radler-zero', title: 'Goesser Naturradler Zitrone alkoholfrei 0.5 l', brand: 'Goesser' })
  );

  assert.ok(coffeeTea.unsafeReasons.includes('coffee-tea-teebutter-collision'));
  assert.ok(petFood.unsafeReasons.includes('pet-food-human-food-collision'));
  assert.ok(alcohol.unsafeReasons.includes('alcoholic-nonalcoholic-variant-risk'));
});

test('hard category conflicts remain unsafe for pet food and meat fish mismatches', () => {
  const petFood = scorePair(
    offer({ _id: 'pdf-wurst', title: 'Tann Wurst 500 g', brand: 'Tann', categoryKey: 'wurst', subcategoryKey: 'wurst' }),
    aggregator({ _id: 'af-dog', title: 'Cesar Hundefutter 500 g', brand: 'Cesar', categoryKey: 'tierfutter', subcategoryKey: 'hundefutter' })
  );
  const meatFish = scorePair(
    offer({ _id: 'pdf-fleisch', title: 'Tann Rind Fleisch 1 kg', brand: 'Tann', categoryKey: 'fleisch', subcategoryKey: 'fleisch' }),
    aggregator({ _id: 'af-lachs', title: 'Norway Lachs Filet 1 kg', brand: 'Norway', categoryKey: 'fisch', subcategoryKey: 'lachs' })
  );

  assert.ok(petFood.unsafeReasons.includes('pet-food-human-food-collision'));
  assert.ok(meatFish.unsafeReasons.includes('category-conflict'));
  assert.notEqual(meatFish.matchLevel, 'strong');
});

test('report aggregates transfer candidates breakdowns histograms and remains read-only', () => {
  const pdf = offer({ _id: 'pdf-milch' });
  const af = aggregator({ _id: 'af-milch' });
  const rejected = buildSparPdfRejectedCandidateEvidence({
    candidates: [{ exclusionReason: 'generic-missing-quantity', rawText: 'Spar Kaffee Crema 9,99' }],
    sourceKey: 'spar-official-flyer-pdf',
    retailerKey: 'spar',
  });
  const report = buildSparSourceMatchingDiagnostic({
    offers: [pdf, af],
    rejectedCandidateSamples: rejected,
    generatedAt: '2026-05-28T10:00:00.000Z',
  });

  assert.equal(report.ok, true);
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(report.totalPdfOffers, 1);
  assert.equal(report.totalAggregatorOffers, 1);
  assert.equal(report.matchedStrong, 1);
  assert.equal(report.imageTransferCandidates, 1);
  assert.equal(report.perRetailerBreakdown.spar.matchedStrong, 1);
  assert.equal(report.rejectionReasonHistogram['generic-missing-quantity'], 1);
  assert.equal(report.topRejectedCandidateSamples.length, 1);
});

test('rejected candidate evidence is compact bounded and keeps parser metrics stable', () => {
  const largeText = `${'Raw SPAR flyer text '.repeat(80)} Lavazza Kaffee 1 kg ab 2 Packungen je 9,99`;
  const candidates = Array.from({ length: 7 }, (_, index) => ({
    exclusionReason: 'generic-missing-quantity',
    parserHint: 'generic-text-layer-price-block',
    page: 2,
    blockIndex: index,
    rawText: largeText,
  }));

  const samples = buildSparPdfRejectedCandidateEvidence({
    candidates,
    sourceKey: 'spar-official-flyer-pdf',
    retailerKey: 'spar',
    validityContext: '2026-05-21 - 2026-05-27',
    createdAt: '2026-05-28T10:00:00.000Z',
    maxSamplesPerSourceReason: 3,
    maxSnippetLength: 120,
  });

  assert.equal(samples.length, 3);
  assert.equal(samples[0].reason, 'generic-missing-quantity');
  assert.equal(samples[0].stage, 'generic-text-layer-price-block');
  assert.ok(samples[0].snippet.length <= 120);
  assert.ok(samples[0].nearbyPriceTokens.includes('9,99'));
  assert.ok(samples[0].nearbyQuantityTokens.includes('1 kg'));
  assert.ok(samples[0].nearbyConditionTokens.some((token) => /ab 2/i.test(token)));
  assert.equal(Object.prototype.hasOwnProperty.call(samples[0], 'rawText'), false);
  assert.deepEqual(summarizeRejections(candidates), [
    { reason: 'generic-missing-quantity', count: 7 },
  ]);
});
