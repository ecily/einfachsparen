const mongoose = require('mongoose');

const analyticsDailyAggregateSchema = new mongoose.Schema(
  {
    day: { type: String, required: true, index: true },
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
    count: { type: Number, default: 0 },
    metadataCounters: { type: Map, of: Number, default: {} },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

analyticsDailyAggregateSchema.index({ day: 1, eventName: 1 }, { unique: true });

module.exports = mongoose.model('AnalyticsDailyAggregate', analyticsDailyAggregateSchema);
