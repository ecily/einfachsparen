const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifySourceAccess,
  hasUsefulOfferSignals,
  isChallengeDetected,
  parseRobotsTxt,
  politeFetchStatus,
  robotsAllowsUrl,
} = require('../src/services/diagnostics/politeOfficialSourceAccess');

const SPAR_ROBOTS = `
User-agent: *
Disallow:

Disallow: /cdn-cgi/

User-agent: BadBot
Disallow: /
`;

const FLYER_ROBOTS = `
User-agent: *
Disallow: /*.ashx
Disallow: /*.xml
Disallow: /*.js
`;

test('robots parser keeps user-agent groups and rules', () => {
  const groups = parseRobotsTxt(FLYER_ROBOTS);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].agents[0], '*');
  assert.deepEqual(groups[0].rules.map((rule) => rule.path), ['/*.ashx', '/*.xml', '/*.js']);
});

test('robots check allows SPAR action pages but blocks Cloudflare helper paths', () => {
  assert.equal(robotsAllowsUrl({
    robotsTxt: SPAR_ROBOTS,
    url: 'https://www.spar.at/aktionen/steiermark/spar',
  }).allowed, true);

  const blocked = robotsAllowsUrl({
    robotsTxt: SPAR_ROBOTS,
    url: 'https://www.spar.at/cdn-cgi/challenge-platform/test',
  });

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'robots-disallowed');
});

test('robots check blocks official flyer ashx endpoints', () => {
  const sparPdf = robotsAllowsUrl({
    robotsTxt: FLYER_ROBOTS,
    url: 'https://flugblatt.spar.at/steiermark/spar/260528-1-flugblatt-kw-22/getPdf.ashx',
  });
  const intersparPdf = robotsAllowsUrl({
    robotsTxt: FLYER_ROBOTS,
    url: 'https://flugblatt.interspar.at/steiermark/steiermark_kw22/getPdf.ashx',
  });

  assert.equal(sparPdf.allowed, false);
  assert.equal(sparPdf.matchedRule.path, '/*.ashx');
  assert.equal(intersparPdf.allowed, false);
});

test('source access classification detects challenge forbidden and rate limit states', () => {
  assert.equal(isChallengeDetected({
    status: 403,
    headers: { 'cf-mitigated': 'challenge' },
    bodySample: '<title>Just a moment...</title>',
  }), true);
  assert.equal(classifySourceAccess({
    status: 403,
    headers: { 'cf-mitigated': 'challenge' },
    bodySample: '<title>Just a moment...</title>',
  }), 'challenge-detected');
  assert.equal(classifySourceAccess({ status: 403, bodySample: 'Forbidden' }), 'forbidden');
  assert.equal(classifySourceAccess({ status: 429, bodySample: 'Too many requests' }), 'rate-limited');
  assert.equal(classifySourceAccess({ status: 200, bodySample: '<html>Aktionen</html>' }), 'reachable');
});

test('source access classification gives robots precedence over reachable HTTP', () => {
  assert.equal(classifySourceAccess({
    status: 200,
    bodySample: '%PDF',
    robots: { allowed: false, reason: 'robots-disallowed' },
  }), 'robots-disallowed');
});

test('offer signal detector remains conservative for sampled HTML', () => {
  const signals = hasUsefulOfferSignals(`
    {"name":"INTERSPAR Flugblatt","price":"1,99 EUR","quantity":"500 g",
    "validTo":"2026-06-02","image":"https://example.test/image.webp","description":"1+1 gratis Aktion"}
  `);

  assert.equal(signals.productNameLikely, true);
  assert.equal(signals.priceLikely, true);
  assert.equal(signals.quantityLikely, true);
  assert.equal(signals.conditionsLikely, true);
  assert.equal(signals.validityLikely, true);
  assert.equal(signals.imageLikely, true);
});

test('polite fetch status stops before fetching robots-disallowed URLs', async () => {
  let called = false;
  const result = await politeFetchStatus('https://flugblatt.spar.at/test/getPdf.ashx', {
    robotsTxt: FLYER_ROBOTS,
    fetchImpl: async () => {
      called = true;
      throw new Error('must not fetch');
    },
  });

  assert.equal(called, false);
  assert.equal(result.sourceStatus, 'robots-disallowed');
});

test('polite fetch status classifies challenge responses without bypass', async () => {
  const result = await politeFetchStatus('https://www.spar.at/aktionen', {
    robotsTxt: SPAR_ROBOTS,
    fetchImpl: async () => ({
      status: 403,
      url: 'https://www.spar.at/aktionen',
      headers: {
        get(name) {
          if (name.toLowerCase() === 'content-type') return 'text/html';
          if (name.toLowerCase() === 'cf-mitigated') return 'challenge';
          return '';
        },
      },
      async text() {
        return '<html><title>Just a moment...</title><script src="https://challenges.cloudflare.com/test.js"></script></html>';
      },
    }),
  });

  assert.equal(result.sourceStatus, 'challenge-detected');
  assert.equal(result.robots.allowed, true);
});

test('polite fetch status preserves cache validators for reachable public resources', async () => {
  const result = await politeFetchStatus('https://www.interspar.at/aktionen', {
    robotsTxt: SPAR_ROBOTS,
    fetchImpl: async () => ({
      status: 200,
      url: 'https://www.interspar.at/aktionen',
      headers: {
        get(name) {
          const headers = {
            'content-type': 'text/html;charset=utf-8',
            etag: 'W/"abc"',
            'last-modified': 'Thu, 28 May 2026 10:00:00 GMT',
          };
          return headers[name.toLowerCase()] || '';
        },
      },
      async text() {
        return '<html><title>Flugblatter</title><a href="/aktionen/steiermark/steiermark_kw22">Angebote</a></html>';
      },
    }),
  });

  assert.equal(result.sourceStatus, 'reachable');
  assert.equal(result.headers.etag, 'W/"abc"');
  assert.equal(result.headers['last-modified'], 'Thu, 28 May 2026 10:00:00 GMT');
});
