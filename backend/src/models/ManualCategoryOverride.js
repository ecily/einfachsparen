const mongoose = require('mongoose');

const manualCategoryOverrideSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      enum: ['subcategory-category', 'article-subcategory', 'article-ignore'],
      required: true,
      index: true,
    },
    active: { type: Boolean, default: true, index: true },
    retailerKey: { type: String, default: '', index: true },
    titleNormalized: { type: String, default: '', index: true },
    titleDisplay: { type: String, default: '' },
    matchSubcategoryLabel: { type: String, default: '' },
    matchSubcategoryKey: { type: String, default: '', index: true },
    targetCategoryPrimary: { type: String, default: '' },
    targetCategorySecondary: { type: String, default: '' },
    note: { type: String, default: '' },
    createdBy: { type: String, default: 'admin' },
  },
  { timestamps: true }
);

manualCategoryOverrideSchema.index(
  { scope: 1, retailerKey: 1, titleNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: {
      scope: { $in: ['article-subcategory', 'article-ignore'] },
      titleNormalized: { $type: 'string' },
    },
  }
);

manualCategoryOverrideSchema.index(
  { scope: 1, matchSubcategoryKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      scope: 'subcategory-category',
      matchSubcategoryKey: { $type: 'string' },
    },
  }
);

module.exports = mongoose.model('ManualCategoryOverride', manualCategoryOverrideSchema);
