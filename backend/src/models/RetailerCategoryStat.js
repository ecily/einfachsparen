const mongoose = require('mongoose');

const retailerCategoryStatSchema = new mongoose.Schema(
  {
    retailerKey: { type: String, required: true, index: true },
    mainCategoryKey: { type: String, required: true, index: true },
    mainCategoryLabel: { type: String, required: true },
    subcategoryKey: { type: String, default: '', index: true },
    subcategoryLabel: { type: String, default: '' },
    offerCount: { type: Number, default: 0 },
    activeOfferCount: { type: Number, default: 0 },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

retailerCategoryStatSchema.index({ retailerKey: 1, mainCategoryKey: 1 });
retailerCategoryStatSchema.index({ retailerKey: 1, mainCategoryKey: 1, subcategoryKey: 1 }, { unique: true });
retailerCategoryStatSchema.index({ mainCategoryKey: 1, subcategoryKey: 1, retailerKey: 1 });

module.exports = mongoose.model('RetailerCategoryStat', retailerCategoryStatSchema);
