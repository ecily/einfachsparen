const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildOfferStatus,
  isOfferFreshForActiveUse,
} = require('../src/services/offers/offerFreshness');

test('global validity rules keep short-window offers active only inside their own window', () => {
  const validFrom = new Date('2026-06-10T22:00:00.000Z');
  const validTo = new Date('2026-06-13T21:59:59.999Z');

  assert.deepEqual(
    buildOfferStatus(validFrom, validTo, false, false, new Date('2026-06-13T10:00:00+02:00')),
    { status: 'active', isActiveNow: true, isActiveToday: true }
  );

  assert.deepEqual(
    buildOfferStatus(validFrom, validTo, false, false, new Date('2026-06-14T10:00:00+02:00')),
    { status: 'expired', isActiveNow: false, isActiveToday: false }
  );
});

test('global public-active filter rejects expired offer-level validity even when flyer fallback would continue', () => {
  const offer = {
    title: 'Kirschen',
    retailerKey: 'penny',
    retailerName: 'PENNY',
    sourceKey: 'penny-official-site',
    status: 'expired',
    isActiveNow: false,
    validFrom: new Date('2026-06-10T22:00:00.000Z'),
    validTo: new Date('2026-06-13T21:59:59.999Z'),
    rawFacts: {
      flyerValidFrom: '2026-06-11',
      flyerValidTo: '2026-06-17',
    },
  };

  assert.equal(isOfferFreshForActiveUse(offer, new Date('2026-06-14T10:00:00+02:00')), false);
});

test('global public-active filter hides retained expired BILLA Publitas flyer offers', () => {
  const offer = {
    title: 'BILLA Ja Natuerlich Bio Joghurt',
    retailerKey: 'billa',
    retailerName: 'BILLA',
    sourceKey: 'billa-official-flyer-steiermark',
    sourceType: 'billa-official-flyer-pdf',
    status: 'active',
    isActiveNow: true,
    validFrom: new Date('2026-06-10T22:00:00.000Z'),
    validTo: new Date('2026-06-17T21:59:59.999Z'),
    publishStatus: 'crawl-run-partial',
    sourceRunStatus: 'success',
    priceCurrent: { amount: 1.49, currency: 'EUR' },
    quantityText: '500 g',
    rawFacts: {
      sourceRunStatus: 'success',
      sourceKey: 'billa-official-flyer-steiermark',
    },
  };

  assert.equal(isOfferFreshForActiveUse(offer, new Date('2026-06-22T10:00:00+02:00')), false);
});

test('global validity rules keep flyer-level validity as fallback for normal weekly offers', () => {
  const status = buildOfferStatus(
    new Date('2026-06-10T22:00:00.000Z'),
    new Date('2026-06-17T21:59:59.999Z'),
    false,
    false,
    new Date('2026-06-14T10:00:00+02:00')
  );

  assert.equal(status.status, 'active');
  assert.equal(status.isActiveNow, true);
  assert.equal(status.isActiveToday, true);
});

test('global public-active filter requires visible conditions for coupon or app prices', () => {
  const baseOffer = {
    title: 'Kaffee nur mit App',
    retailerKey: 'spar',
    retailerName: 'SPAR',
    sourceKey: 'spar-official-flyer-current',
    status: 'active',
    isActiveNow: true,
    validFrom: new Date('2026-06-10T22:00:00.000Z'),
    validTo: new Date('2026-06-17T21:59:59.999Z'),
    customerProgramRequired: true,
    rawFacts: {},
  };

  assert.equal(isOfferFreshForActiveUse(baseOffer, new Date('2026-06-14T10:00:00+02:00')), false);
  assert.equal(isOfferFreshForActiveUse({
    ...baseOffer,
    conditionsText: 'Nur mit SPAR-App-Gutschein laut Flugblatt',
  }, new Date('2026-06-14T10:00:00+02:00')), true);
});
