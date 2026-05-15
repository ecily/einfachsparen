const mongoose = require('mongoose');

const rankingResultCacheSchema = new mongoose.Schema(
  {
    keyHash: { type: String, required: true, unique: true, index: true },
    resultSetToken: { type: String, required: true, index: true },
    normalizedKey: { type: String, required: true },
    offerIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    filters: {
      query: { type: String, default: '' },
      unit: { type: String, default: 'all' },
      categories: { type: [String], default: [] },
      retailers: { type: [String], default: [] },
      programRetailers: { type: [String], default: [] },
      onlyWithoutProgram: { type: Boolean, default: false },
    },
    summaryBasis: {
      resultCount: { type: Number, default: 0 },
      candidateCount: { type: Number, default: 0 },
      candidateLimit: { type: Number, default: 0 },
      units: { type: [String], default: [] },
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

rankingResultCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
rankingResultCacheSchema.index({ resultSetToken: 1, expiresAt: 1 });

module.exports = mongoose.model('RankingResultCache', rankingResultCacheSchema);
