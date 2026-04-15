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
      discoveredPages: { type: Number, default: 0 },
      rawDocuments: { type: Number, default: 0 },
      offersExtracted: { type: Number, default: 0 },
      offersStored: { type: Number, default: 0 },
      warnings: { type: Number, default: 0 },
      errors: { type: Number, default: 0 },
    },
    warningMessages: [{ type: String }],
    errorMessages: [{ type: String }],
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CrawlJob', crawlJobSchema);
