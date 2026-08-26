const assert = require('node:assert/strict');
const test = require('node:test');

const Offer = require('../src/models/Offer');
const Category = require('../src/models/Category');
const Retailer = require('../src/models/Retailer');
const {
  buildOfferRanking,
  buildRankingBaseCacheKey,
  buildRankingResponseFromStoredResultCache,
  clearRankingResponseCache,
  getRankingResponseCacheSize,
} = require('../src/services/offers/offerRankingService');

function activeBillaOffer(id, amount) {
  const now = Date.now();
  return {
    _id: id,
    retailerKey: 'billa',
    retailerName: 'BILLA',
    title: `BILLA Testangebot ${id}`,
    titleNormalized: `billa testangebot ${id}`,
    categoryPrimary: 'Lebensmittel',
    categorySecondary: 'Test',
    status: 'active',
    isActiveNow: true,
    isActiveToday: true,
    validFrom: new Date(now - 60_000),
    validTo: new Date(now + 86_400_000),
    priceCurrent: { amount, currency: 'EUR' },
    normalizedUnitPrice: { amount, unit: 'stueck', comparable: true, confidence: 0.99 },
    totalComparableAmount: 1,
    comparableUnit: 'stueck',
    quantityText: '1 Stück',
    sourceType: 'billa-official-algolia',
    sourceRunStatus: 'success',
    publishStatus: 'crawl-run-success',
    customerProgramRequired: false,
    conditionsText: '',
    quality: { comparisonSafe: true },
  };
}

function leanQuery(value) {
  return {
    select() {
      return this;
    },
    sort() {
      return this;
    },
    async lean() {
      return value;
    },
  };
}

test('stored ranking hydration publishes the existing memory base without changing order or pagination', async () => {
  const originalOfferFind = Offer.find;
  const originalCategoryFind = Category.find;
  const originalRetailerFind = Retailer.find;
  const hydratedOffers = [activeBillaOffer('offer-1', 1.99), activeBillaOffer('offer-2', 0.99)];
  let offerFindCalls = 0;

  Offer.find = () => {
    offerFindCalls += 1;
    return leanQuery(hydratedOffers);
  };
  Category.find = () => leanQuery([]);
  Retailer.find = () => leanQuery([{ retailerKey: 'billa', retailerName: 'BILLA', activeOfferCount: 2 }]);
  clearRankingResponseCache();

  try {
    const baseCacheKey = buildRankingBaseCacheKey({ retailers: 'billa' });
    const cacheEntry = {
      offerIds: ['offer-2', 'offer-1'],
      resultSetToken: 'stable-token',
      summaryBasis: { units: ['stueck'], candidateCount: 3, candidateLimit: 1000, resultCount: 3 },
    };

    const hydrated = await buildRankingResponseFromStoredResultCache({
      cacheEntry,
      baseCacheKey,
      selectedRetailers: ['billa'],
      safeLimit: 1,
      safeOffset: 0,
    });
    const secondPage = await buildOfferRanking({
      retailers: 'billa',
      limit: 1,
      offset: 1,
      offsetExplicit: true,
    });

    assert.deepEqual(hydrated.rankedOffers.map((offer) => offer.id), ['offer-2']);
    assert.deepEqual(secondPage.rankedOffers.map((offer) => offer.id), ['offer-1']);
    assert.equal(hydrated.summary.totalCount, 2);
    assert.equal(secondPage.summary.totalCount, 2);
    assert.equal(hydrated.summary.resultCount, 3);
    assert.equal(secondPage.summary.resultCount, hydrated.summary.resultCount);
    assert.equal(secondPage.summary.resultSetToken, 'stable-token');
    assert.equal(offerFindCalls, 1);
    assert.equal(getRankingResponseCacheSize(), 1);
  } finally {
    clearRankingResponseCache();
    Offer.find = originalOfferFind;
    Category.find = originalCategoryFind;
    Retailer.find = originalRetailerFind;
  }
});

test('diagnostic stored-cache reads do not publish a reusable memory base', async () => {
  const originalOfferFind = Offer.find;
  const originalCategoryFind = Category.find;
  const originalRetailerFind = Retailer.find;
  Offer.find = () => leanQuery([activeBillaOffer('offer-1', 1.99)]);
  Category.find = () => leanQuery([]);
  Retailer.find = () => leanQuery([]);
  clearRankingResponseCache();

  try {
    await buildRankingResponseFromStoredResultCache({
      cacheEntry: {
        offerIds: ['offer-1'],
        resultSetToken: 'diagnostic-token',
        summaryBasis: { candidateCount: 1, candidateLimit: 1000, resultCount: 1 },
      },
      baseCacheKey: buildRankingBaseCacheKey({ retailers: 'billa' }),
      selectedRetailers: ['billa'],
      safeLimit: 60,
      debugTiming: true,
    });

    assert.equal(getRankingResponseCacheSize(), 0);
  } finally {
    clearRankingResponseCache();
    Offer.find = originalOfferFind;
    Category.find = originalCategoryFind;
    Retailer.find = originalRetailerFind;
  }
});
