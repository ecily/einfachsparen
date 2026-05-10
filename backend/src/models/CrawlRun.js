const mongoose = require('mongoose');

const compactSourceSummarySchema = new mongoose.Schema(
  {
    sourceId: { type: String, default: '' },
    sourceKey: { type: String, default: '' },
    retailerKey: { type: String, default: '' },
    retailerName: { type: String, default: '' },
    channel: { type: String, default: '' },
    sourceType: { type: String, default: '' },
    status: { type: String, default: '' },
    foundRawItems: { type: Number, default: 0 },
    parsedOffers: { type: Number, default: 0 },
    offersStored: { type: Number, default: 0 },
    rejectedOffers: { type: Number, default: 0 },
    skipped: { type: Boolean, default: false },
    message: { type: String, default: '' },
    error: { type: String, default: '' },
  },
  { _id: false }
);

const perRetailerSchema = new mongoose.Schema(
  {
    retailerKey: { type: String, default: '' },
    matchedSources: { type: Number, default: 0 },
    successfulSources: { type: Number, default: 0 },
    failedSources: { type: Number, default: 0 },
    foundRawItems: { type: Number, default: 0 },
    parsedOffers: { type: Number, default: 0 },
    offersStored: { type: Number, default: 0 },
    rejectedOffers: { type: Number, default: 0 },
  },
  { _id: false }
);

const sourceTypeSchema = new mongoose.Schema(
  {
    sourceType: { type: String, default: '' },
    channel: { type: String, default: '' },
    matchedSources: { type: Number, default: 0 },
    successfulSources: { type: Number, default: 0 },
    failedSources: { type: Number, default: 0 },
    offersStored: { type: Number, default: 0 },
  },
  { _id: false }
);

const crawlRunSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['queued', 'running', 'success', 'partial', 'failed', 'skipped'],
      default: 'queued',
      index: true,
    },
    trigger: {
      type: String,
      enum: ['manual', 'scheduled'],
      default: 'manual',
      index: true,
    },
    mode: {
      type: String,
      enum: ['full', 'scoped'],
      default: 'full',
      index: true,
    },
    dryRun: { type: Boolean, default: false, index: true },
    region: { type: String, default: '' },
    retailerKeys: { type: [String], default: [] },
    sourceKeys: { type: [String], default: [] },
    sourceIds: { type: [String], default: [] },
    allowDisabled: { type: Boolean, default: false },
    sourceSelectionRequested: { type: Boolean, default: false },
    startedAt: { type: Date, default: null, index: true },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },
    lockKey: { type: String, default: 'crawl-run-global', index: true },
    sourceIdsMatched: { type: [String], default: [] },
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },
    perRetailer: { type: [perRetailerSchema], default: [] },
    sourceTypes: { type: [sourceTypeSchema], default: [] },
    result: {
      sources: { type: [compactSourceSummarySchema], default: [] },
      dedupe: { type: mongoose.Schema.Types.Mixed, default: {} },
      filterMetadata: { type: mongoose.Schema.Types.Mixed, default: {} },
      effectiveRetailerKeys: { type: [String], default: [] },
      requestedSourceKeys: { type: [String], default: [] },
      requestedSourceIds: { type: [String], default: [] },
    },
    errorMessages: { type: [String], default: [] },
    warnings: { type: [String], default: [] },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

crawlRunSchema.index({ status: 1, startedAt: -1 });
crawlRunSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CrawlRun', crawlRunSchema);
