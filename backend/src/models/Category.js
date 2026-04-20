const mongoose = require('mongoose');

const subcategorySchema = new mongoose.Schema(
  {
    subcategoryKey: { type: String, required: true },
    subcategoryLabel: { type: String, required: true },
    offerCount: { type: Number, default: 0 },
  },
  { _id: false }
);

const categorySchema = new mongoose.Schema(
  {
    mainCategoryKey: { type: String, required: true, unique: true, index: true },
    mainCategoryLabel: { type: String, required: true },
    offerCount: { type: Number, default: 0 },
    subcategories: { type: [subcategorySchema], default: [] },
    lastSeenAt: { type: Date, default: null },
    isActive: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

categorySchema.index({ isActive: 1, mainCategoryLabel: 1 });

module.exports = mongoose.model('Category', categorySchema);
