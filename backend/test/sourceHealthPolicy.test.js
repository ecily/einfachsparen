const assert = require('node:assert/strict');
const test = require('node:test');

const { getScheduledHealthPolicy } = require('../src/services/sources/sourceHealthPolicy');
const { RETAILER_DEFINITIONS } = require('../src/services/sources/sourceDefinitions');

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

test('PENNY offers page remains required while the disabled flyer is excluded', () => {
  const sources = RETAILER_DEFINITIONS.filter((source) => source.retailerKey === 'penny');
  const offersPage = sources.find((source) => source.sourceUrl === 'https://www.penny.at/angebote');
  const flyer = sources.find((source) => source.sourceUrl === 'https://www.penny.at/angebote/flugblaetter');

  assert.equal(getScheduledHealthPolicy(offersPage).healthCriticality, 'required');
  assert.equal(getScheduledHealthPolicy(offersPage).requiredForScheduledHealth, true);
  assert.equal(offersPage.enabled, undefined);
  assert.equal(flyer.enabled, false);
  assert.equal(getScheduledHealthPolicy(flyer).healthCriticality, 'excluded');
  assert.equal(getScheduledHealthPolicy(flyer).requiredForScheduledHealth, false);
});

test('BILLA family site offers remain required while all four PDF flyers are excluded', () => {
  for (const retailerKey of ['billa', 'billa-plus']) {
    const sources = RETAILER_DEFINITIONS.filter((source) => source.retailerKey === retailerKey);
    const site = sources.find((source) => source.channel === 'official-site');
    const flyers = sources.filter((source) => source.channel === 'official-flyer');
    assert.equal(site?.enabled, undefined);
    assert.equal(getScheduledHealthPolicy(site).requiredForScheduledHealth, true);
    assert.equal(flyers.length, 2);
    for (const flyer of flyers) {
      assert.equal(flyer.enabled, false);
      assert.equal(flyer.latestStatus, 'inactive');
      assert.equal(flyer.crawlPolicy.disableOfferExtraction, true);
      assert.equal(getScheduledHealthPolicy(flyer).healthCriticality, 'excluded');
      assert.equal(getScheduledHealthPolicy(flyer).requiredForScheduledHealth, false);
    }
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
