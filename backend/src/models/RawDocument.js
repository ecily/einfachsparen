const mongoose = require('mongoose');

const rawDocumentSchema = new mongoose.Schema(
  {
    sourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Source', required: true, index: true },
    crawlJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'CrawlJob', required: true, index: true },
    retailerKey: { type: String, required: true, index: true },
    region: { type: String, required: true },
    documentType: {
      type: String,
      enum: ['html', 'json', 'pdf', 'text'],
      default: 'html',
    },
    url: { type: String, required: true },
    canonicalUrl: { type: String, default: '' },
    title: { type: String, default: '' },
    fetchedAt: { type: Date, default: Date.now, index: true },
    contentHash: { type: String, required: true, index: true },
    contentSnippet: { type: String, default: '' },
    extractedPreview: [{ type: String }],
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

rawDocumentSchema.index({ sourceId: 1, contentHash: 1 });
rawDocumentSchema.index({ fetchedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 });

module.exports = mongoose.model('RawDocument', rawDocumentSchema);
