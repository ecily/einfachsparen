const mongoose = require('mongoose');

const priceSchema = new mongoose.Schema(
  {
    amount: { type: Number, default: null },
    currency: { type: String, default: 'EUR' },
    originalText: { type: String, default: '' },
  },
  { _id: false }
);

const unitPriceSchema = new mongoose.Schema(
  {
    amount: { type: Number, default: null },
    unit: { type: String, default: '' },
    comparable: { type: Boolean, default: false },
    confidence: { type: Number, default: 0 },
  },
  { _id: false }
);

const sourceEvidenceSchema = new mongoose.Schema(
  {
    sourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Source', default: null },
    channel: { type: String, default: '' },
    sourceUrl: { type: String, default: '' },
    label: { type: String, default: '' },
    observedUrl: { type: String, default: '' },
    matchType: { type: String, default: 'primary' },
    observedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const offerSchema = new mongoose.Schema(
  {
    crawlJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'CrawlJob', required: true, index: true },
    sourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Source', required: true, index: true },
    retailerKey: { type: String, required: true, index: true },
    retailerName: { type: String, required: true },
    region: { type: String, required: true },
    title: { type: String, required: true, index: true },
    brand: { type: String, default: '' },
    categoryPrimary: { type: String, default: 'Unkategorisiert', index: true },
    categorySecondary: { type: String, default: '' },
    comparisonSignature: { type: String, default: '', index: true },
    comparisonQuantityKey: { type: String, default: '', index: true },
    comparisonCategoryKey: { type: String, default: '', index: true },
    description: { type: String, default: '' },
    sourceUrl: { type: String, required: true },
    imageUrl: { type: String, default: '' },
    supportingSources: { type: [sourceEvidenceSchema], default: [] },
    validFrom: { type: Date, default: null, index: true },
    validTo: { type: Date, default: null, index: true },
    benefitType: {
      type: String,
      enum: ['price-cut', 'multi-buy', 'card-required', 'sticker', 'unknown'],
      default: 'unknown',
    },
    conditionsText: { type: String, default: '' },
    customerProgramRequired: { type: Boolean, default: false },
    availabilityScope: { type: String, default: 'Steiermark / Graz Umgebung' },
    priceCurrent: { type: priceSchema, default: () => ({}) },
    priceReference: { type: priceSchema, default: () => ({}) },
    quantityText: { type: String, default: '' },
    normalizedUnitPrice: { type: unitPriceSchema, default: () => ({}) },
    quality: {
      completenessScore: { type: Number, default: 0 },
      parsingConfidence: { type: Number, default: 0 },
      comparisonSafe: { type: Boolean, default: false },
      issues: [{ type: String }],
    },
    rawFacts: { type: mongoose.Schema.Types.Mixed, default: {} },
    adminReview: {
      status: {
        type: String,
        enum: ['pending', 'reviewed', 'needs-fix'],
        default: 'pending',
        index: true,
      },
      note: { type: String, default: '' },
      feedbackDigest: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

offerSchema.index({ retailerKey: 1, validFrom: 1, validTo: 1 });

module.exports = mongoose.model('Offer', offerSchema);
