const mongoose = require('mongoose');

const crawlRunLockSchema = new mongoose.Schema(
  {
    _id: { type: String },
    runId: { type: mongoose.Schema.Types.ObjectId, ref: 'CrawlRun', default: null, index: true },
    status: {
      type: String,
      enum: ['queued', 'running', 'released'],
      default: 'queued',
      index: true,
    },
    acquiredAt: { type: Date, default: Date.now },
    heartbeatAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null, index: true },
    owner: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CrawlRunLock', crawlRunLockSchema);
