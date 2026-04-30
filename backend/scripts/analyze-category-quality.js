const mongoose = require('mongoose');
const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const { normalizeTitleForMatch } = require('../src/services/crawl/sourceEvidence');
const { determineCategoryDecision } = require('../src/services/crawl/categoryClassifier');

const STOP_WORDS = new Set([
  'ab',
  'aktion',
  'angebot',
  'artikel',
  'bei',
  'bio',
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'einer',
  'fur',
  'fuer',
  'gratis',
  'kg',
  'liter',
  'mit',
  'nur',
  'oder',
  'packung',
  'pro',
  'statt',
  'stueck',
  'stk',
  'und',
  'von',
  'zum',
]);

function tokenizeTitle(title) {
  return normalizeTitleForMatch(title)
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token));
}

function incrementMap(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function topEntries(map, limit = 20) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'de'))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function isCategoryWeak(offer) {
  const primary = String(offer?.categoryPrimary || '');
  const secondary = String(offer?.categorySecondary || '');

  return primary === 'Unkategorisiert' || secondary === 'Sonstiges' || !secondary;
}

function buildProjectedDecision(offer) {
  return determineCategoryDecision({
    title: offer.title || '',
    contextText: [
      offer.description,
      offer.rawFacts?.infoText,
      offer.rawFacts?.category,
      offer.rawFacts?.sourceCategory,
    ].filter(Boolean).join(' '),
    sourceCategory: offer.rawFacts?.category || offer.rawFacts?.sourceCategory || '',
  });
}

async function main() {
  await connectToDatabase();

  const offers = await Offer.find({
    $or: [
      { status: 'active' },
      { isActiveNow: true },
      { isActiveToday: true },
    ],
  })
    .select('retailerKey retailerName title categoryPrimary categorySecondary categoryConfidence subcategoryConfidence')
    .select('description rawFacts')
    .lean();

  const total = offers.length;
  const weakOffers = offers.filter(isCategoryWeak);
  const uncategorized = offers.filter((offer) => offer.categoryPrimary === 'Unkategorisiert');
  const sonstiges = offers.filter((offer) => offer.categorySecondary === 'Sonstiges');
  const withoutSubcategory = offers.filter((offer) => offer.categoryPrimary !== 'Unkategorisiert' && !offer.categorySecondary);
  const byRetailer = new Map();
  const weakTokens = new Map();
  const projectedByPrimary = new Map();
  const projectedBySecondary = new Map();
  const projectedStillUncategorizedTokens = new Map();
  const weakExamples = [];
  const projectedExamples = [];

  for (const offer of weakOffers) {
    const retailerKey = offer.retailerKey || offer.retailerName || 'unknown-retailer';

    if (!byRetailer.has(retailerKey)) {
      byRetailer.set(retailerKey, {
        total: 0,
        weak: 0,
        uncategorized: 0,
        sonstiges: 0,
        withoutSubcategory: 0,
      });
    }

    const retailer = byRetailer.get(retailerKey);
    const projectedDecision = buildProjectedDecision(offer);

    retailer.weak += 1;
    retailer.uncategorized += offer.categoryPrimary === 'Unkategorisiert' ? 1 : 0;
    retailer.sonstiges += offer.categorySecondary === 'Sonstiges' ? 1 : 0;
    retailer.withoutSubcategory += offer.categoryPrimary !== 'Unkategorisiert' && !offer.categorySecondary ? 1 : 0;

    for (const token of tokenizeTitle(offer.title)) {
      incrementMap(weakTokens, token);

      if (projectedDecision.primaryCategory === 'Unkategorisiert') {
        incrementMap(projectedStillUncategorizedTokens, token);
      }
    }

    incrementMap(projectedByPrimary, projectedDecision.primaryCategory || 'Unkategorisiert');
    incrementMap(projectedBySecondary, [
      projectedDecision.primaryCategory || 'Unkategorisiert',
      projectedDecision.secondaryCategory || '',
    ].filter(Boolean).join(' > ') || 'Unkategorisiert');

    if (weakExamples.length < 40) {
      weakExamples.push({
        retailerKey,
        title: offer.title,
        categoryPrimary: offer.categoryPrimary || '',
        categorySecondary: offer.categorySecondary || '',
        categoryConfidence: offer.categoryConfidence || 0,
        subcategoryConfidence: offer.subcategoryConfidence || 0,
      });
    }

    if (
      projectedExamples.length < 40
      && (
        projectedDecision.primaryCategory !== (offer.categoryPrimary || '')
        || projectedDecision.secondaryCategory !== (offer.categorySecondary || '')
      )
    ) {
      projectedExamples.push({
        retailerKey,
        title: offer.title,
        current: [offer.categoryPrimary || 'Unkategorisiert', offer.categorySecondary || ''].filter(Boolean).join(' > '),
        projected: [projectedDecision.primaryCategory || 'Unkategorisiert', projectedDecision.secondaryCategory || ''].filter(Boolean).join(' > '),
        projectedConfidence: projectedDecision.categoryConfidence,
        projectedSubcategoryConfidence: projectedDecision.subcategoryConfidence,
      });
    }
  }

  for (const offer of offers) {
    const retailerKey = offer.retailerKey || offer.retailerName || 'unknown-retailer';

    if (!byRetailer.has(retailerKey)) {
      byRetailer.set(retailerKey, {
        total: 0,
        weak: 0,
        uncategorized: 0,
        sonstiges: 0,
        withoutSubcategory: 0,
      });
    }

    byRetailer.get(retailerKey).total += 1;
  }

  const retailerSummary = [...byRetailer.entries()]
    .map(([retailerKey, stats]) => ({
      retailerKey,
      ...stats,
      weakShare: stats.total > 0 ? Number((stats.weak / stats.total).toFixed(3)) : 0,
    }))
    .sort((left, right) => right.weak - left.weak || left.retailerKey.localeCompare(right.retailerKey, 'de'));

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    total,
    weak: weakOffers.length,
    weakShare: total > 0 ? Number((weakOffers.length / total).toFixed(3)) : 0,
    uncategorized: uncategorized.length,
    sonstiges: sonstiges.length,
    withoutSubcategory: withoutSubcategory.length,
    byRetailer: retailerSummary,
    topWeakTokens: topEntries(weakTokens, 50),
    projectedWeakReclassification: {
      byPrimary: topEntries(projectedByPrimary, 30),
      bySecondary: topEntries(projectedBySecondary, 50),
      stillUncategorizedTokens: topEntries(projectedStillUncategorizedTokens, 50),
      changedExamples: projectedExamples,
    },
    examples: weakExamples,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
