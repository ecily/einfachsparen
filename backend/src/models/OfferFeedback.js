const mongoose = require('mongoose');

const FEEDBACK_REASONS = [
  'price_wrong',
  'condition_wrong',
  'image_wrong',
  'category_wrong',
  'duplicate',
  'expired_or_not_found',
  'offer_nonsense',
  'search_result_wrong',
  'other',
];

const priceSnapshotSchema = new mongoose.Schema(
  {
    amount: { type: Number, default: null },
    currency: { type: String, default: 'EUR', trim: true },
  },
  { _id: false }
);

const normalizedUnitPriceSnapshotSchema = new mongoose.Schema(
  {
    amount: { type: Number, default: null },
    unit: { type: String, default: null, trim: true },
    comparable: { type: Boolean, default: null },
  },
  { _id: false }
);

const offerRefSchema = new mongoose.Schema(
  {
    offerId: { type: String, default: '', trim: true, index: true },
    stableId: { type: String, default: null, trim: true, index: true },
    sourceId: { type: String, default: null, trim: true },
    dedupeKey: { type: String, default: null, trim: true, index: true },
  },
  { _id: false }
);

const offerSnapshotSchema = new mongoose.Schema(
  {
    title: { type: String, default: '', trim: true },
    brand: { type: String, default: null, trim: true },
    rawTitle: { type: String, default: null, trim: true },
    displayTitle: { type: String, default: null, trim: true },
    retailerKey: { type: String, default: '', trim: true, index: true },
    retailerLabel: { type: String, default: '', trim: true },
    retailerStoreType: { type: String, default: null, trim: true },
    priceCurrent: { type: priceSnapshotSchema, default: () => ({}) },
    priceOriginal: { type: priceSnapshotSchema, default: () => ({}) },
    savingsPercent: { type: Number, default: null },
    savingsAmount: { type: Number, default: null },
    quantity: { type: String, default: null, trim: true },
    normalizedUnitPrice: { type: normalizedUnitPriceSnapshotSchema, default: () => ({}) },
    categoryPrimary: { type: String, default: null, trim: true, index: true },
    categorySecondary: { type: String, default: null, trim: true },
    conditionsText: { type: String, default: null, trim: true },
    conditionBadges: { type: [String], default: [] },
    visibleBadges: { type: [String], default: [] },
    customerProgramRequired: { type: Boolean, default: null },
    validityText: { type: String, default: null, trim: true },
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null, index: true },
    imagePresent: { type: Boolean, default: null },
    imageUrlPresent: { type: Boolean, default: null },
    sourceName: { type: String, default: null, trim: true },
    sourceUrl: { type: String, default: null, trim: true },
    sourceType: { type: String, default: null, trim: true },
    sourceTypes: { type: [String], default: [] },
  },
  { _id: false }
);

const pageContextSchema = new mongoose.Schema(
  {
    path: { type: String, default: null, trim: true },
    routeName: { type: String, default: null, trim: true },
    url: { type: String, default: null, trim: true },
    query: { type: String, default: null, trim: true },
    sortMode: { type: String, default: null, trim: true },
    activeRetailers: { type: [String], default: [] },
    activeCategories: { type: [String], default: [] },
    programRetailers: { type: [String], default: [] },
    onlyWithoutProgram: { type: Boolean, default: null },
    activeFilters: { type: mongoose.Schema.Types.Mixed, default: {} },
    resultPosition: { type: Number, default: null },
    viewport: { type: String, default: null, trim: true },
  },
  { _id: false }
);

const clientContextSchema = new mongoose.Schema(
  {
    userAgent: { type: String, default: null, trim: true },
    sessionIdHash: { type: String, default: null, trim: true },
    feedbackSource: { type: String, default: 'public-offer-card', trim: true },
    uiComponent: { type: String, default: null, trim: true },
    schemaVersion: { type: String, default: null, trim: true },
    appVersion: { type: String, default: null, trim: true },
    submittedAtClient: { type: Date, default: null },
  },
  { _id: false }
);

const moderationSchema = new mongoose.Schema(
  {
    containsPersonalDataLikely: { type: Boolean, default: false },
    spamScore: { type: Number, default: 0 },
  },
  { _id: false }
);

const triageSchema = new mongoose.Schema(
  {
    note: { type: String, default: '', trim: true },
    rootCause: { type: String, default: '', trim: true },
    resolution: { type: String, default: '', trim: true },
    updatedBy: { type: String, default: 'admin', trim: true },
    updatedAt: { type: Date, default: null },
  },
  { _id: false }
);

const structuredDetailsSchema = new mongoose.Schema(
  {
    category_wrong: {
      currentCategoryPrimary: { type: String, trim: true },
      currentCategorySecondary: { type: String, trim: true },
      suggestedCategoryPrimary: { type: String, trim: true },
      suggestedCategorySecondary: { type: String, trim: true },
      suggestedCategoryUnknown: { type: Boolean },
      userNote: { type: String, trim: true },
    },
    price_wrong: {
      visiblePrice: { type: String, trim: true },
      seenPrice: { type: Number },
      seenPriceText: { type: String, trim: true },
      seenAt: { type: Date },
      userNote: { type: String, trim: true },
    },
    condition_wrong: {
      visibleConditions: { type: [String], default: undefined },
      issueTypes: { type: [String], default: undefined },
      userExpectedConditionText: { type: String, trim: true },
      userSawDifferentCondition: { type: String, trim: true },
      userNote: { type: String, trim: true },
    },
    image_wrong: {
      issueTypes: { type: [String], default: undefined },
      userNote: { type: String, trim: true },
    },
    expired_or_not_found: {
      issueTypes: { type: [String], default: undefined },
      checkedWhere: { type: String, trim: true },
      userNote: { type: String, trim: true },
    },
    duplicate: {
      duplicateOfferId: { type: String, trim: true },
      duplicateVisibleTitle: { type: String, trim: true },
      duplicateReason: { type: String, trim: true },
      userNote: { type: String, trim: true },
    },
    offer_nonsense: {
      issueTypes: { type: [String], default: undefined },
      userNote: { type: String, trim: true },
    },
    search_result_wrong: {
      query: { type: String, trim: true },
      visibleTitle: { type: String, trim: true },
      currentCategoryPrimary: { type: String, trim: true },
      currentCategorySecondary: { type: String, trim: true },
      expectedProductType: { type: String, trim: true },
      expectedCategoryPrimary: { type: String, trim: true },
      expectedCategorySecondary: { type: String, trim: true },
      issueTypes: { type: [String], default: undefined },
      userNote: { type: String, trim: true },
    },
    other: {
      userNote: { type: String, trim: true },
    },
  },
  { _id: false }
);

const offerFeedbackSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['offer_feedback'],
      default: 'offer_feedback',
      index: true,
    },
    status: {
      type: String,
      enum: ['new', 'reviewing', 'resolved', 'ignored', 'duplicate'],
      default: 'new',
      index: true,
    },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'critical'],
      default: 'normal',
      index: true,
    },
    reasons: {
      type: [String],
      enum: FEEDBACK_REASONS,
      required: true,
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length >= 1 && value.length <= FEEDBACK_REASONS.length;
        },
        message: 'Mindestens ein Feedback-Grund ist erforderlich.',
      },
      index: true,
    },
    offerRef: { type: offerRefSchema, default: () => ({}) },
    offerSnapshot: { type: offerSnapshotSchema, default: () => ({}) },
    pageContext: { type: pageContextSchema, default: () => ({}) },
    structuredDetails: { type: structuredDetailsSchema, default: () => ({}) },
    freeText: { type: String, default: null, trim: true },
    clientContext: { type: clientContextSchema, default: () => ({}) },
    moderation: { type: moderationSchema, default: () => ({}) },
    triage: { type: triageSchema, default: () => ({}) },
  },
  {
    strict: true,
    timestamps: true,
  }
);

offerFeedbackSchema.index({ status: 1, priority: 1, createdAt: -1 });
offerFeedbackSchema.index({ 'offerRef.offerId': 1, createdAt: -1 });
offerFeedbackSchema.index({ 'offerSnapshot.retailerKey': 1, createdAt: -1 });

module.exports = mongoose.model('OfferFeedback', offerFeedbackSchema);
module.exports.FEEDBACK_REASONS = FEEDBACK_REASONS;
