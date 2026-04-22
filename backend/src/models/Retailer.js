const mongoose = require('mongoose');

const retailerSchema = new mongoose.Schema(
  {
    retailerKey: { type: String, required: true, unique: true, index: true },
    retailerName: { type: String, required: true },
    offerCount: { type: Number, default: 0 },
    activeOfferCount: { type: Number, default: 0 },
    totalOffers: { type: Number, default: 0 },
    activeOffers: { type: Number, default: 0 },
    offersBySource: {
      type: [
        new mongoose.Schema(
          {
            sourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Source', default: null },
            label: { type: String, default: '' },
            channel: { type: String, default: '' },
            offerCount: { type: Number, default: 0 },
            activeOfferCount: { type: Number, default: 0 },
            lastSeenAt: { type: Date, default: null },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    offersByChannel: {
      type: [
        new mongoose.Schema(
          {
            channel: { type: String, default: '' },
            offerCount: { type: Number, default: 0 },
            activeOfferCount: { type: Number, default: 0 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    firstSeenAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
    lastSuccessfulCrawlAt: { type: Date, default: null },
    activeCoverageSignal: {
      type: String,
      enum: ['strong', 'medium', 'weak', 'empty'],
      default: 'empty',
    },
    coverageStatus: {
      type: String,
      enum: ['trusted', 'watch', 'gap'],
      default: 'gap',
      index: true,
    },
    coveragePriorityScore: { type: Number, default: 0 },
    coverageGapReasons: [{ type: String, default: [] }],
    activeCoverageTarget: { type: Number, default: 0 },
    activeCoverageRatio: { type: Number, default: 0 },
    sourceDiversity: { type: Number, default: 0 },
    channelDiversity: { type: Number, default: 0 },
    parsingConfidenceAverage: { type: Number, default: 0 },
    comparisonSafeShare: { type: Number, default: 0 },
    usableOfferShare: { type: Number, default: 0 },
    crawlStabilityScore: { type: Number, default: 0 },
    recentSuccessfulCrawlCount: { type: Number, default: 0 },
    recentFailedCrawlCount: { type: Number, default: 0 },
    repeatedLowYield: { type: Boolean, default: false },
    isActive: { type: Boolean, default: false, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

retailerSchema.index({ isActive: 1, sortOrder: 1, retailerName: 1 });
retailerSchema.index({ coverageStatus: 1, activeCoverageSignal: 1, retailerName: 1 });

module.exports = mongoose.model('Retailer', retailerSchema);
