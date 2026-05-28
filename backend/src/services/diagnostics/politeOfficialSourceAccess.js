const POLITE_USER_AGENT = 'kaufklug.at-official-source-feasibility/1.0 (+https://www.kaufklug.at)';
const DEFAULT_TIMEOUT_MS = 8000;
const BLOCKING_STATUSES = new Set([401, 403, 407, 429, 451]);

function asHeaderValue(headers = {}, name = '') {
  if (!headers || !name) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '');
  const lowerName = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => String(key).toLowerCase() === lowerName);
  return entry ? String(entry[1] || '') : '';
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function pathAndQuery(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname || '/'}${parsed.search || ''}`;
  } catch (error) {
    return '/';
  }
}

function normalizeRulePath(value = '') {
  return String(value || '').trim().split(/\s+#/)[0].trim();
}

function ruleMatches(rulePath = '', urlPath = '') {
  const rule = normalizeRulePath(rulePath);
  if (!rule) return false;
  const regex = new RegExp(`^${escapeRegex(rule).replace(/\\\*/g, '.*')}`);
  return regex.test(urlPath);
}

function parseRobotsTxt(text = '') {
  const groups = [];
  let current = null;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) continue;
    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();

    if (key === 'user-agent') {
      current = { agents: [value.toLowerCase()], rules: [] };
      groups.push(current);
      continue;
    }

    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      current.rules.push({ type: key, path: normalizeRulePath(value) });
    }
  }

  return groups;
}

function robotsAllowsUrl({ robotsTxt = '', url = '', userAgent = POLITE_USER_AGENT } = {}) {
  const groups = parseRobotsTxt(robotsTxt);
  if (groups.length === 0) return { allowed: true, reason: 'robots-empty-or-unavailable', matchedRule: null };

  const normalizedAgent = String(userAgent || '').toLowerCase();
  const matchingGroups = groups.filter((group) =>
    group.agents.some((agent) => agent === '*' || normalizedAgent.includes(agent))
  );
  const rules = matchingGroups.flatMap((group) => group.rules);
  const urlPath = pathAndQuery(url);
  const matched = rules
    .filter((rule) => rule.path && ruleMatches(rule.path, urlPath))
    .sort((left, right) => right.path.length - left.path.length)[0] || null;

  if (!matched) return { allowed: true, reason: 'no-matching-disallow', matchedRule: null };
  return {
    allowed: matched.type !== 'disallow',
    reason: matched.type === 'disallow' ? 'robots-disallowed' : 'robots-allowed',
    matchedRule: matched,
  };
}

function isChallengeDetected({ status = null, headers = {}, bodySample = '' } = {}) {
  const cfMitigated = asHeaderValue(headers, 'cf-mitigated');
  const titleOrBody = `${bodySample || ''}`;

  return /challenge/i.test(cfMitigated)
    || /just a moment|cloudflare|cf-browser-verification|cf-chl|challenges\.cloudflare\.com/i.test(titleOrBody)
    || (Number(status) === 403 && /challenge-platform/i.test(titleOrBody));
}

function classifySourceAccess({ status = null, headers = {}, bodySample = '', robots = null } = {}) {
  if (robots && robots.allowed === false) return 'robots-disallowed';
  const numericStatus = Number(status);

  if (isChallengeDetected({ status: numericStatus, headers, bodySample })) return 'challenge-detected';
  if (numericStatus === 429) return 'rate-limited';
  if ([401, 403, 407, 451].includes(numericStatus)) return 'forbidden';
  if (numericStatus === 304) return 'reachable';
  if (numericStatus >= 200 && numericStatus < 300) return 'reachable';
  if (numericStatus >= 300 && numericStatus < 400) return 'reachable';
  if (numericStatus === 404 || numericStatus === 405 || numericStatus === 415) return 'unsupported';

  return 'unsupported';
}

function hasUsefulOfferSignals(bodySample = '') {
  const text = compactWhitespace(bodySample);
  return {
    productNameLikely: /\b(produkt|artikel|name|title)\b/i.test(text),
    priceLikely: /\b(preis|price|€|eur)\b/i.test(text),
    quantityLikely: /\b(menge|quantity|kg|g|liter|l|ml|stk|stück)\b/i.test(text),
    conditionsLikely: /\b(aktion|angebot|rabatt|gratis|kundenkarte|app|gültig|gueltig)\b/i.test(text),
    validityLikely: /\b(valid|validFrom|validTo|gültig|gueltig|bis|von|\d{1,2}\.\d{1,2}\.)\b/i.test(text),
    imageLikely: /\b(image|img|bild|\.jpg|\.png|\.webp|Image\.ashx)\b/i.test(text),
  };
}

async function politeFetchStatus(url, {
  fetchImpl = globalThis.fetch,
  robotsTxt = '',
  userAgent = POLITE_USER_AGENT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const robots = robotsAllowsUrl({ robotsTxt, url, userAgent });
  if (robots.allowed === false) {
    return {
      url,
      status: null,
      sourceStatus: 'robots-disallowed',
      robots,
      bodySample: '',
      headers: {},
      offerSignals: hasUsefulOfferSignals(''),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/json,application/xml,application/pdf,*/*;q=0.8',
        'User-Agent': userAgent,
      },
    });
    const contentType = response.headers?.get?.('content-type') || '';
    const textLike = /html|json|xml|text/i.test(contentType);
    const bodySample = textLike && typeof response.text === 'function'
      ? (await response.text()).slice(0, 8192)
      : '';
    const headers = {
      'content-type': contentType,
      etag: response.headers?.get?.('etag') || '',
      'last-modified': response.headers?.get?.('last-modified') || '',
      'cf-mitigated': response.headers?.get?.('cf-mitigated') || '',
      'retry-after': response.headers?.get?.('retry-after') || '',
    };
    const sourceStatus = classifySourceAccess({ status: response.status, headers, bodySample, robots });

    return {
      url,
      finalUrl: response.url || url,
      status: response.status,
      sourceStatus,
      robots,
      headers,
      bodySample: compactWhitespace(bodySample).slice(0, 500),
      offerSignals: hasUsefulOfferSignals(bodySample),
    };
  } catch (error) {
    return {
      url,
      status: null,
      sourceStatus: 'unsupported',
      robots,
      headers: {},
      bodySample: '',
      error: compactWhitespace(error.message).slice(0, 200),
      offerSignals: hasUsefulOfferSignals(''),
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  BLOCKING_STATUSES,
  DEFAULT_TIMEOUT_MS,
  POLITE_USER_AGENT,
  classifySourceAccess,
  hasUsefulOfferSignals,
  isChallengeDetected,
  parseRobotsTxt,
  politeFetchStatus,
  robotsAllowsUrl,
};
