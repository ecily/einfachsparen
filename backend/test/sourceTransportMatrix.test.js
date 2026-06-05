const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyResponse,
  detectCloudflare,
  evaluateSourceTransportReadiness,
  parseCurlOutput,
  selectClients,
  selectTargets,
} = require('../src/services/diagnostics/sourceTransportMatrix');

test('classifyResponse accepts JSON success for expected JSON targets', () => {
  const classification = classifyResponse({
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    bodyText: '{"hits":[{"name":"Milch"}]}',
    expectedContentKind: 'json',
  });

  assert.equal(classification.responseKind, 'json');
  assert.equal(classification.jsonReturned, true);
  assert.equal(classification.usable, true);
  assert.equal(classification.blockedLikely, false);
});

test('classifyResponse rejects Cloudflare challenge HTML despite HTTP 200', () => {
  const classification = classifyResponse({
    status: 200,
    headers: {
      server: 'cloudflare',
      'cf-ray': 'abc-VIE',
      'content-type': 'text/html',
    },
    bodyText: '<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script></html>',
    expectedContentKind: 'html',
  });

  assert.equal(classification.responseKind, 'html-challenge');
  assert.equal(classification.usable, false);
  assert.equal(classification.blockedLikely, true);
  assert.equal(classification.waf.challengeLikely, true);
});

test('classifyResponse marks 403 Cloudflare as blocked', () => {
  const classification = classifyResponse({
    status: 403,
    headers: {
      server: 'cloudflare',
      'cf-cache-status': 'DYNAMIC',
      'content-type': 'text/html',
    },
    bodyText: '<html><body>Enable JavaScript and cookies to continue</body></html>',
    expectedContentKind: 'json',
  });

  assert.equal(classification.blockedLikely, true);
  assert.equal(classification.waf.present, true);
  assert.equal(classification.waf.challengeLikely, true);
  assert.equal(classification.usable, false);
});

test('classifyResponse marks 429 as blocked without requiring Cloudflare', () => {
  const classification = classifyResponse({
    status: 429,
    headers: { 'content-type': 'text/plain' },
    bodyText: 'Too many requests',
    expectedContentKind: 'html',
  });

  assert.equal(classification.blockedLikely, true);
  assert.equal(classification.waf.present, false);
  assert.equal(classification.usable, false);
});

test('detectCloudflare recognizes Turnstile/challenge body markers', () => {
  const waf = detectCloudflare(
    { server: 'nginx' },
    '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>'
  );

  assert.equal(waf.present, true);
  assert.equal(waf.challengeLikely, true);
  assert.ok(waf.signals.includes('body:turnstile'));
});

test('evaluateSourceTransportReadiness prefers backend clients over curl', () => {
  const target = { id: 'spar-productworld-inangebot', retailerKey: 'spar', sourceFamily: 'spar-family-official-productworld' };
  const readiness = evaluateSourceTransportReadiness({
    target,
    results: [
      {
        targetId: target.id,
        clientId: 'global-fetch',
        decision: 'usable-backend-client',
        blockedLikely: false,
        cloudflare: { challengeLikely: false },
      },
      {
        targetId: target.id,
        clientId: 'curl',
        decision: 'usable-curl-subprocess',
        blockedLikely: false,
        cloudflare: { challengeLikely: false },
      },
    ],
  });

  assert.equal(readiness.verdict, 'backend-transport-usable');
  assert.equal(readiness.deployable, true);
  assert.deepEqual(readiness.backendUsableClients, ['global-fetch']);
});

test('evaluateSourceTransportReadiness treats curl-only success as candidate, not automatic source activation', () => {
  const target = { id: 'pagro-angebote', retailerKey: 'pagro', sourceFamily: 'pagro-official-site' };
  const readiness = evaluateSourceTransportReadiness({
    target,
    results: [
      {
        targetId: target.id,
        clientId: 'curl',
        decision: 'usable-curl-subprocess',
        blockedLikely: false,
        cloudflare: { challengeLikely: false },
      },
      {
        targetId: target.id,
        clientId: 'native-https',
        decision: 'blocked-waf-challenge',
        blockedLikely: true,
        cloudflare: { challengeLikely: true },
      },
    ],
  });

  assert.equal(readiness.verdict, 'curl-subprocess-candidate');
  assert.equal(readiness.deployable, true);
  assert.equal(readiness.curlUsable, true);
  assert.equal(readiness.challengeCount, 1);
});

test('evaluateSourceTransportReadiness blocks challenge-only results', () => {
  const target = { id: 'spar-productworld-inangebot', retailerKey: 'spar', sourceFamily: 'spar-family-official-productworld' };
  const readiness = evaluateSourceTransportReadiness({
    target,
    results: [
      {
        targetId: target.id,
        clientId: 'http2',
        decision: 'blocked-waf-challenge',
        blockedLikely: true,
        cloudflare: { challengeLikely: true },
      },
    ],
  });

  assert.equal(readiness.verdict, 'blocked-waf-challenge');
  assert.equal(readiness.deployable, false);
});

test('parseCurlOutput extracts status, headers, body and meta line', () => {
  const parsed = parseCurlOutput([
    'HTTP/2 200',
    'content-type: application/json',
    'cf-ray: abc',
    '',
    '{"ok":true}',
    '__KKT_META__200|application/json|https://example.test/|2',
  ].join('\n'));

  assert.equal(parsed.status, 200);
  assert.equal(parsed.headers['content-type'], 'application/json');
  assert.equal(parsed.headers['cf-ray'], 'abc');
  assert.equal(parsed.bodyText, '{"ok":true}');
  assert.equal(parsed.finalUrl, 'https://example.test/');
  assert.equal(parsed.httpVersion, 'HTTP/2');
});

test('target and client selectors are allowlist based', () => {
  assert.deepEqual(selectClients(['global-fetch', 'missing-client']), ['global-fetch']);
  assert.deepEqual(selectTargets(['spar-productworld-inangebot']).map((target) => target.id), ['spar-productworld-inangebot']);
  assert.equal(selectTargets(['not-a-target']).length, 0);
});
