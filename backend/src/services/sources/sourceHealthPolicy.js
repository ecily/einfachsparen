const NON_PUBLIC_RETAILERS = new Set(['eurospar', 'hofer', 'interspar', 'spar']);

function normalizeHealthPolicy(policy = {}) {
  const criticality = String(policy.healthCriticality || '').trim().toLowerCase();
  const bounded = criticality === 'policy-bounded' || policy.policyBounded === true;
  const excluded = criticality === 'excluded' || policy.healthExcluded === true;
  const required = !bounded && !excluded && policy.requiredForScheduledHealth === true;

  return {
    requiredForScheduledHealth: required,
    healthCriticality: excluded ? 'excluded' : bounded ? 'policy-bounded' : required ? 'required' : 'optional',
    publicRequired: policy.publicRequired === true,
    policyBounded: bounded,
    healthExcluded: excluded,
    nonBlockingReason: String(policy.nonBlockingReason || ''),
  };
}

function getScheduledHealthPolicy(source = {}) {
  const configured = source.crawlPolicy?.scheduledHealthPolicy;
  if (configured && typeof configured === 'object') return normalizeHealthPolicy(configured);

  const retailerKey = String(source.retailerKey || '').trim().toLowerCase();
  const channel = String(source.channel || '').trim().toLowerCase();
  const scopedOnly = source.crawlPolicy?.scopedOnly === true;
  const currentDiscovery = source.crawlPolicy?.currentDiscovery === true;

  if (retailerKey === 'pagro') {
    return normalizeHealthPolicy({ healthCriticality: 'excluded', healthExcluded: true, nonBlockingReason: 'PAGRO is product-excluded and not part of public Daily Crawl health.' });
  }
  if (scopedOnly && !currentDiscovery) {
    return normalizeHealthPolicy({ healthCriticality: 'policy-bounded', policyBounded: true, nonBlockingReason: 'Scoped or historical source is outside the scheduled public source contract.' });
  }
  if (NON_PUBLIC_RETAILERS.has(retailerKey)) {
    return normalizeHealthPolicy({ healthCriticality: 'optional', nonBlockingReason: `${retailerKey} is currently non-public or limited-scope for the normal public product.` });
  }
  if (channel === 'aggregator') {
    return normalizeHealthPolicy({ healthCriticality: 'optional', nonBlockingReason: 'Aggregator source is supplementary and does not define mandatory public coverage.' });
  }
  return normalizeHealthPolicy({ healthCriticality: 'required', requiredForScheduledHealth: true, publicRequired: true });
}

module.exports = { getScheduledHealthPolicy, normalizeHealthPolicy };
