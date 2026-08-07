const assert = require('node:assert/strict');
const test = require('node:test');

const { getScheduledHealthPolicy } = require('../src/services/sources/sourceHealthPolicy');

test('required public official sources define scheduled health', () => {
  const policy = getScheduledHealthPolicy({ retailerKey: 'billa', channel: 'official-site' });
  assert.equal(policy.healthCriticality, 'required');
  assert.equal(policy.requiredForScheduledHealth, true);
  assert.equal(policy.publicRequired, true);
});

test('supported public retailer families remain health-critical', () => {
  for (const retailerKey of ['billa', 'billa-plus', 'lidl', 'penny', 'dm', 'bipa', 'mueller']) {
    const policy = getScheduledHealthPolicy({ retailerKey, channel: 'official-site' });
    assert.equal(policy.requiredForScheduledHealth, true, retailerKey);
    assert.equal(policy.healthCriticality, 'required', retailerKey);
  }
});

test('SPAR, INTERSPAR, HOFER and EUROSPAR are non-blocking under current product policy', () => {
  for (const retailerKey of ['spar', 'interspar', 'hofer', 'eurospar']) {
    const policy = getScheduledHealthPolicy({ retailerKey, channel: 'official-flyer' });
    assert.equal(policy.healthCriticality, 'optional', retailerKey);
    assert.equal(policy.requiredForScheduledHealth, false, retailerKey);
  }
});

test('scoped historical sources are policy-bounded and PAGRO is excluded', () => {
  assert.equal(getScheduledHealthPolicy({
    retailerKey: 'billa',
    channel: 'official-flyer',
    crawlPolicy: { scopedOnly: true, currentDiscovery: false },
  }).healthCriticality, 'policy-bounded');
  assert.equal(getScheduledHealthPolicy({ retailerKey: 'pagro', channel: 'official-site' }).healthCriticality, 'excluded');
});
