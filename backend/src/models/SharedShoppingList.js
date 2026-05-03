const mongoose = require('mongoose');

const sharedShoppingListItemSchema = new mongoose.Schema(
  {
    offerId: { type: String, default: '' },
    retailerKey: { type: String, default: '' },
    retailerName: { type: String, default: 'Unbekannter Markt' },
    title: { type: String, required: true },
    categoryLabel: { type: String, default: '' },
    priceCurrent: {
      amount: { type: Number, default: null },
      currency: { type: String, default: 'EUR' },
    },
    unit: { type: String, default: '' },
    quantityText: { type: String, default: '' },
    validUntil: { type: Date, default: null },
    imageUrl: { type: String, default: '' },
  },
  { _id: false }
);

const sharedShoppingListSchema = new mongoose.Schema(
  {
    shareId: { type: String, required: true, unique: true, index: true },
    items: { type: [sharedShoppingListItemSchema], default: [] },
    source: { type: String, enum: ['shopping-list'], default: 'shopping-list' },
    version: { type: Number, default: 1 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

sharedShoppingListSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('SharedShoppingList', sharedShoppingListSchema);
