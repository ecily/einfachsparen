const mongoose = require('mongoose');

const retailerCategoryOfferCacheSchema = new mongoose.Schema(
  {
    retailerKey: { type: String, required: true, index: true },
    retailerName: { type: String, required: true },
    mainCategoryKey: { type: String, required: true, index: true },
    mainCategoryLabel: { type: String, required: true },
    subcategoryKey: { type: String, default: '', index: true },
    subcategoryLabel: { type: String, default: '' },
    offerCount: { type: Number, default: 0 },
    activeOfferCount: { type: Number, default: 0 },
    lastSeenAt: { type: Date, default: null },
    offers: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

retailerCategoryOfferCacheSchema.index({ retailerKey: 1, mainCategoryKey: 1, subcategoryKey: 1 }, { unique: true });
retailerCategoryOfferCacheSchema.index({ retailerKey: 1, mainCategoryKey: 1 });
retailerCategoryOfferCacheSchema.index({ retailerKey: 1, mainCategoryLabel: 1 });
retailerCategoryOfferCacheSchema.index({ retailerKey: 1, subcategoryLabel: 1 });

module.exports = mongoose.model('RetailerCategoryOfferCache', retailerCategoryOfferCacheSchema);
