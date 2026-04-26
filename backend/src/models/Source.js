const mongoose = require('mongoose');

const sourceSchema = new mongoose.Schema(
  {
    retailerKey: { type: String, required: true, index: true },
    retailerName: { type: String, required: true },
    channel: {
      type: String,
      enum: ['official-site', 'official-flyer', 'aggregator', 'other'],
      required: true,
    },
    label: { type: String, required: true },
    regionScope: { type: String, default: 'Austria' },
    sourceUrl: { type: String, required: true },
    sourceType: {
      type: String,
      enum: ['offers-page', 'flyer', 'pdf', 'image-flyer', 'sitemap', 'json', 'product-search', 'aggregator', 'other'],
      default: 'other',
      index: true,
    },
    urlTemplate: { type: String, default: '' },
    priority: { type: Number, default: 50, index: true },
    enabled: { type: Boolean, default: true },
    crawlPolicy: { type: mongoose.Schema.Types.Mixed, default: {} },
    parserHint: { type: String, default: '' },
    parserVersion: { type: String, default: '' },
    normalizationVersion: { type: String, default: '' },
    active: { type: Boolean, default: true },
    notes: { type: String, default: '' },
    capabilities: {
      discoverOffers: { type: Boolean, default: false },
      parseOfferPages: { type: Boolean, default: false },
      parseFlyers: { type: Boolean, default: false },
    },
    latestRunAt: { type: Date, default: null },
    latestStatus: {
      type: String,
      enum: ['idle', 'success', 'partial', 'failed', 'inactive'],
      default: 'idle',
    },
  },
  { timestamps: true }
);

sourceSchema.index({ retailerKey: 1, sourceUrl: 1 }, { unique: true });

module.exports = mongoose.model('Source', sourceSchema);
