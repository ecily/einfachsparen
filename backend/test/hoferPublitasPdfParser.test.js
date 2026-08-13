const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SOURCE_TYPE,
  SOURCE_KEY,
  parseDate,
  parseQuantity,
} = require('../src/services/crawl/hoferPublitasPdfParser');

test('HOFER Publitas parser uses the official source identity', () => {
  assert.equal(SOURCE_TYPE, 'hofer-official-publitas-pdf');
  assert.equal(SOURCE_KEY, 'hofer-official-publitas-pdf');
});

test('HOFER Publitas parser derives validity from the flyer range', () => {
  const validity = parseDate('Flugblatt gültig ab MI. 12.8. bis DO. 20.8.');
  assert.equal(validity.validFrom.getUTCMonth(), 7);
  assert.equal(validity.validFrom.getUTCDate(), 12);
  assert.equal(validity.validTo.getUTCDate(), 20);
  assert.match(validity.validityText, /12\.8\./);
});

test('HOFER Publitas parser keeps only safe mass/volume comparison units', () => {
  assert.deepEqual(parseQuantity('500 g Packung'), {
    unitValue: 500,
    unitType: 'g',
    totalComparableAmount: 0.5,
    comparableUnit: 'kg',
  });
  assert.deepEqual(parseQuantity('3 Stück'), {
    unitValue: null,
    unitType: '',
    totalComparableAmount: null,
    comparableUnit: '',
  });
});
