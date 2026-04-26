const mongoose = require('mongoose');

const crawlJobSchema = new mongoose.Schema(
  {
    sourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Source', required: true, index: true },
    retailerKey: { type: String, required: true, index: true },
    region: { type: String, required: true },
    status: {
      type: String,
      enum: ['running', 'success', 'partial', 'failed'],
      default: 'running',
      index: true,
    },
    trigger: {
      type: String,
      enum: ['manual', 'scheduled', 'startup'],
      default: 'manual',
    },
    startedAt: { type: Date, default: Date.now, index: true },
    finishedAt: { type: Date, default: null },
    stats: {
      foundRawItems: { type: Number, default: 0 },
      parsedOffers: { type: Number, default: 0 },
      productiveOffers: { type: Number, default: 0 },
      rejectedOffers: { type: Number, default: 0 },
      discoveredPages: { type: Number, default: 0 },
      rawDocuments: { type: Number, default: 0 },
      offersExtracted: { type: Number, default: 0 },
      offersStored: { type: Number, default: 0 },
      warnings: { type: Number, default: 0 },
      errors: { type: Number, default: 0 },
    },
    sourceType: { type: String, default: '', index: true },
    sourceUrl: { type: String, default: '' },
    parserVersion: { type: String, default: '' },
    normalizationVersion: { type: String, default: '' },
    rejectionReasons: [
      {
        reason: { type: String, default: '' },
        count: { type: Number, default: 0 },
      },
    ],
    httpLog: {
      status: { type: Number, default: null },
      contentType: { type: String, default: '' },
      finalUrl: { type: String, default: '' },
      downloadBytes: { type: Number, default: 0 },
      contentHash: { type: String, default: '' },
    },
    warningMessages: [{ type: String }],
    errorMessages: [{ type: String }],
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CrawlJob', crawlJobSchema);
