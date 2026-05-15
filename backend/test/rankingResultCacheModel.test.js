const assert = require('node:assert/strict');
const test = require('node:test');

const RankingResultCache = require('../src/models/RankingResultCache');

test('RankingResultCache stores only result ids, minimal summary, and TTL index', () => {
  const paths = Object.keys(RankingResultCache.schema.paths);

  assert.ok(paths.includes('offerIds'));
  assert.ok(paths.includes('summaryBasis.resultCount'));
  assert.ok(paths.includes('summaryBasis.candidateCount'));
  assert.equal(paths.includes('rankedOffers'), false);
  assert.equal(paths.includes('offers'), false);

  const indexes = RankingResultCache.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0));
  assert.ok(indexes.some(([fields]) => fields.keyHash === 1));
  assert.ok(indexes.some(([fields]) => fields.resultSetToken === 1));
});
