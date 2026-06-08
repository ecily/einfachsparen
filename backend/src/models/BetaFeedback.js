const mongoose = require('mongoose');

const FEEDBACK_TYPES = [
  'idea',
  'market_request',
  'shopping_list',
  'app_feature',
  'route_optimization',
  'price_quality',
  'other',
];

const FEATURE_INTERESTS = [
  'new_markets',
  'hardware_stores',
  'furniture_stores',
  'favorite_items_alert',
  'shopping_list_alerts',
  'optimal_shopping_route',
  'cheapest_alternatives',
  'fewer_store_stops',
  'app',
];

const betaFeedbackSchema = new mongoose.Schema(
  {
    name: { type: String, default: null, trim: true, maxlength: 120 },
    email: { type: String, default: null, trim: true, lowercase: true, maxlength: 254 },
    message: { type: String, required: true, trim: true, minlength: 20, maxlength: 3000 },
    feedbackType: {
      type: String,
      enum: FEEDBACK_TYPES,
      default: 'other',
      index: true,
    },
    requestedMarkets: { type: String, default: null, trim: true, maxlength: 500 },
    featureInterests: {
      type: [String],
      enum: FEATURE_INTERESTS,
      default: [],
    },
    sourcePage: { type: String, default: '/feedback', enum: ['/feedback'], index: true },
    status: {
      type: String,
      enum: ['new', 'reviewing', 'resolved', 'ignored'],
      default: 'new',
      index: true,
    },
    emailDeliveryStatus: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'timeout', 'skipped', 'not_configured'],
      default: 'pending',
      index: true,
    },
    emailDeliveryError: { type: String, default: null, trim: true, maxlength: 300 },
  },
  {
    strict: true,
    timestamps: true,
  }
);

betaFeedbackSchema.index({ createdAt: -1 });
betaFeedbackSchema.index({ feedbackType: 1, createdAt: -1 });

module.exports = mongoose.model('BetaFeedback', betaFeedbackSchema);
module.exports.FEEDBACK_TYPES = FEEDBACK_TYPES;
module.exports.FEATURE_INTERESTS = FEATURE_INTERESTS;
