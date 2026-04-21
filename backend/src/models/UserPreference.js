const mongoose = require('mongoose');

const userPreferenceSchema = new mongoose.Schema(
  {
    profileKey: { type: String, required: true, unique: true, index: true },
    selectedRetailers: {
      type: [String],
      default: [],
    },
    retailerPrograms: {
      type: Map,
      of: Boolean,
      default: {},
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('UserPreference', userPreferenceSchema);
