const mongoose = require('mongoose');

const { connectToDatabase } = require('../src/config/mongodb');
const {
  buildOfferRanking,
  clearRankingResponseCache,
} = require('../src/services/offers/offerRankingService');

const smokeCases = [
  { label: 'ranking?limit=1', args: { limit: 1 } },
  { label: 'ranking?q=zzzzzzzz&limit=1', args: { query: 'zzzzzzzz', limit: 1 } },
  { label: 'ranking?q=kaffee&limit=20', args: { query: 'kaffee', limit: 20 } },
  { label: 'ranking?q=butter&limit=20', args: { query: 'butter', limit: 20 } },
  { label: 'ranking?q=reis&limit=20', args: { query: 'reis', limit: 20 } },
  { label: 'ranking?q=waschmittel&limit=20', args: { query: 'waschmittel', limit: 20 } },
];

async function measureSmokeCase(smokeCase) {
  clearRankingResponseCache();
  const startedAt = process.hrtime.bigint();
  const response = await buildOfferRanking(smokeCase.args);
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  return {
    case: smokeCase.label,
    durationMs: Number(durationMs.toFixed(1)),
    resultCount: response.summary?.resultCount ?? null,
    displayedCount: response.summary?.displayedCount ?? null,
    candidateCount: response.summary?.candidateCount ?? null,
    candidateLimit: response.summary?.candidateLimit ?? null,
    shape: {
      hasFilters: Boolean(response.filters),
      hasCategories: Array.isArray(response.categories),
      hasRetailers: Array.isArray(response.retailers),
      hasSummary: Boolean(response.summary),
      hasRankedGroups: Array.isArray(response.rankedGroups),
      hasRankedOffers: Array.isArray(response.rankedOffers),
    },
  };
}

async function main() {
  await connectToDatabase();

  const results = [];

  for (const smokeCase of smokeCases) {
    results.push(await measureSmokeCase(smokeCase));
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    readOnly: true,
    cases: results,
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
