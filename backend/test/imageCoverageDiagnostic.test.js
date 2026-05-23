const test = require('node:test');
const assert = require('node:assert/strict');

const {
  imageState,
  offerMatchesQuery,
  summarizeOffer,
} = require('../src/services/diagnostics/imageCoverageDiagnostic');

test('imageState distinguishes present usable imageUrl from image-like raw fields', () => {
  assert.deepEqual(
    imageState({ imageUrl: 'https://example.test/product.jpg', rawFacts: {} }),
    {
      hasImageUrl: true,
      usableImageUrl: true,
      imageLikeFieldCount: 1,
      imageLikeFields: [
        { path: 'imageUrl', valueType: 'string', usableUrl: true },
      ],
    }
  );

  const state = imageState({
    imageUrl: '',
    rawFacts: {
      thumbnail: 'https://example.test/thumb.jpg',
    },
  });

  assert.equal(state.hasImageUrl, false);
  assert.equal(state.usableImageUrl, false);
  assert.equal(state.imageLikeFieldCount, 1);
  assert.equal(state.imageLikeFields[0].path, 'rawFacts.thumbnail');
});

test('offerMatchesQuery uses search tokens and normalized offer text', () => {
  assert.equal(
    offerMatchesQuery({ searchTokens: ['duschgel'], title: 'Other' }, 'duschgel'),
    true
  );
  assert.equal(
    offerMatchesQuery({ title: 'MEN Duschgel Sport 250ml' }, 'duschgel'),
    true
  );
  assert.equal(
    offerMatchesQuery({ title: 'Puntigamer Maerzen' }, 'duschgel'),
    false
  );
});

test('summarizeOffer classifies missing PDF image and API projection mismatch', () => {
  const pdfSummary = summarizeOffer({
    _id: '6a10dff4a54618db9465da64',
    title: 'Puntigamer Maerzen',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    sourceType: 'spar-official-pdf',
    imageUrl: '',
    rawFacts: { sourceKey: 'spar-official-flyer-pdf' },
  });

  assert.equal(pdfSummary.causeGuess, 'pdf-flyer-no-product-image');

  const apiMismatch = summarizeOffer(
    {
      _id: '6a10dff4a54618db9465da65',
      title: 'Offer with image',
      retailerKey: 'spar',
      retailerName: 'SPAR',
      sourceType: 'aktionsfinder-json',
      imageUrl: 'https://example.test/product.jpg',
    },
    {},
    new Map(),
    { id: '6a10dff4a54618db9465da65', imageUrl: '' }
  );

  assert.equal(apiMismatch.causeGuess, 'api-projection-missing-image');
});
