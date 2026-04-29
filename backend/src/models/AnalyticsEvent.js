const mongoose = require('mongoose');

const analyticsEventSchema = new mongoose.Schema(
  {
    eventName: {
      type: String,
      enum: [
        'landing_page_view',
        'shopping_list_opened',
        'offer_search_started',
        'offer_search_result',
        'offer_added_to_list',
        'apk_download_click',
        'legal_page_opened',
        'app_open',
      ],
      required: true,
      index: true,
    },
    createdAt: { type: Date, default: Date.now, index: true },
    expireAt: { type: Date, required: true },
    path: { type: String, default: '' },
    referrerHost: { type: String, default: '' },
    deviceType: {
      type: String,
      enum: ['desktop', 'mobile', 'tablet', 'unknown'],
      default: 'unknown',
    },
    browserFamily: {
      type: String,
      enum: ['chrome', 'safari', 'firefox', 'edge', 'other', 'unknown'],
      default: 'unknown',
    },
    sessionIdHash: { type: String, default: '', index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { versionKey: false }
);

analyticsEventSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
analyticsEventSchema.index({ eventName: 1, createdAt: -1 });
analyticsEventSchema.index({ createdAt: -1, referrerHost: 1 });
analyticsEventSchema.index({ createdAt: -1, deviceType: 1 });

module.exports = mongoose.model('AnalyticsEvent', analyticsEventSchema);