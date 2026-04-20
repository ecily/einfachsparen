const mongoose = require('mongoose');

const retailerSchema = new mongoose.Schema(
  {
    retailerKey: { type: String, required: true, unique: true, index: true },
    retailerName: { type: String, required: true },
    offerCount: { type: Number, default: 0 },
    activeOfferCount: { type: Number, default: 0 },
    lastSeenAt: { type: Date, default: null },
    isActive: { type: Boolean, default: false, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

retailerSchema.index({ isActive: 1, sortOrder: 1, retailerName: 1 });

module.exports = mongoose.model('Retailer', retailerSchema);
