const mongoose = require('mongoose');

const adminFeedbackSchema = new mongoose.Schema(
  {
    region: { type: String, required: true, index: true },
    scope: {
      type: String,
      enum: ['crawl-review', 'offer-review', 'general'],
      default: 'crawl-review',
      index: true,
    },
    note: { type: String, required: true, trim: true },
    digest: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminFeedback', adminFeedbackSchema);
