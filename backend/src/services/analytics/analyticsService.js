const crypto = require('node:crypto');
const AnalyticsDailyAggregate = require('../../models/AnalyticsDailyAggregate');
const AnalyticsEvent = require('../../models/AnalyticsEvent');
const env = require('../../config/env');

const ALLOWED_EVENTS = new Set([
  'landing_page_view',
  'shopping_list_opened',
  'offer_search_started',
  'offer_search_result',
  'offer_added_to_list',
  'apk_download_click',
  'legal_page_opened',
  'app_open',
]);

const EVENT_NAMES = Array.from(ALLOWED_EVENTS);
const TRAFFIC_EVENT_NAMES = [
  'landing_page_view',
  'shopping_list_opened',
  'offer_search_started',
  'offer_added_to_list',
  'apk_download_click',
  'legal_page_opened',
  'app_open',
];
const TRAFFIC_EXCLUDED_EVENT_NAMES = ['offer_search_result'];
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_WINDOW_DAYS = 7;
const EVENT_RETENTION_DAYS = 180;
const MAX_PATH_LENGTH = 180;
const MAX_METADATA_STRING_LENGTH = 80;
const MAX_SESSION_ID_LENGTH = 160;

const metadataAllowlist = {
  landing_page_view: {
    source: 'string',
  },
  shopping_list_opened: {},
  offer_search_started: {
    selectedRetailerCount: 'integer',
    selectedCategoryCount: 'integer',
  },
  offer_search_result: {
    resultCount: 'integer',
    safeOfferCount: 'integer',
    actionOfferCount: 'integer',
    selectedRetailerCount: 'integer',
    selectedCategoryCount: 'integer',
  },
  offer_added_to_list: {
    retailerKey: 'string',
    categoryLabel: 'string',
    hasKnownSavings: 'boolean',
  },
  apk_download_click: {
    source: ['hero', 'footer', 'direct', 'unknown'],
  },
  legal_page_opened: {
    legalPage: ['impressum', 'privacy', 'liability', 'cookies'],
  },
  app_open: {
    appPlatform: 'string',
    appVersion: 'string',
  },
};

function isAllowedEvent(eventName) {
  return ALLOWED_EVENTS.has(eventName);
}

function sanitizePath(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return `${parsed.pathname}${parsed.search}`.slice(0, MAX_PATH_LENGTH);
    } catch (error) {
      return '';
    }
  }

  if (!trimmed.startsWith('/')) {
    return '';
  }

  return trimmed.replace(/[\r\n\t]/g, '').slice(0, MAX_PATH_LENGTH);
}

function extractReferrerHost(req, body = {}) {
  const candidates = [
    req.get('referer'),
    req.get('referrer'),
    body.referrer,
    body.referrerHost,
  ];

  for (const candidate of candidates) {
    const host = sanitizeHost(candidate);

    if (host) {
      return host;
    }
  }

  return '';
}

function sanitizeHost(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim().toLowerCase();

  if (!trimmed || trimmed.length > 240) {
    return '';
  }

  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return parsed.hostname.replace(/^www\./, '').slice(0, 120);
  } catch (error) {
    return '';
  }
}

function detectDeviceType(userAgent = '') {
  const ua = String(userAgent).toLowerCase();

  if (!ua) {
    return 'unknown';
  }

  if (/ipad|tablet|kindle|silk/.test(ua)) {
    return 'tablet';
  }

  if (/mobile|iphone|android/.test(ua)) {
    return 'mobile';
  }

  if (/windows|macintosh|linux|x11/.test(ua)) {
    return 'desktop';
  }

  return 'unknown';
}

function detectBrowserFamily(userAgent = '') {
  const ua = String(userAgent).toLowerCase();

  if (!ua) {
    return 'unknown';
  }

  if (/edg\//.test(ua)) {
    return 'edge';
  }

  if (/firefox\//.test(ua)) {
    return 'firefox';
  }

  if (/chrome\//.test(ua) || /crios\//.test(ua)) {
    return 'chrome';
  }

  if (/safari\//.test(ua)) {
    return 'safari';
  }

  return 'other';
}

function sanitizeMetadata(eventName, metadata = {}) {
  const allowedFields = metadataAllowlist[eventName] || {};
  const sanitized = {};

  for (const [key, rule] of Object.entries(allowedFields)) {
    const value = metadata?.[key];

    if (Array.isArray(rule)) {
      sanitized[key] = rule.includes(value) ? value : rule.includes('unknown') ? 'unknown' : undefined;
      continue;
    }

    if (rule === 'integer') {
      const number = Number(value);
      sanitized[key] = Number.isSafeInteger(number) && number >= 0 ? Math.min(number, 1000000) : 0;
      continue;
    }

    if (rule === 'boolean') {
      sanitized[key] = value === true;
      continue;
    }

    if (rule === 'string' && typeof value === 'string') {
      sanitized[key] = value.trim().replace(/[\r\n\t]/g, ' ').slice(0, MAX_METADATA_STRING_LENGTH);
    }
  }

  return Object.fromEntries(Object.entries(sanitized).filter(([, value]) => value !== undefined && value !== ''));
}

function buildSessionIdHash(req, body = {}) {
  const clientSessionId = typeof body.sessionId === 'string'
    ? body.sessionId.trim().slice(0, MAX_SESSION_ID_LENGTH)
    : '';
  const basis = clientSessionId || buildFallbackSessionBasis(req);

  return crypto
    .createHmac('sha256', env.ANALYTICS_SESSION_SECRET)
    .update(`${basis}|window:${getSessionWindow(new Date())}`)
    .digest('hex');
}

function buildFallbackSessionBasis(req) {
  const maskedIp = maskIp(req.ip || req.socket?.remoteAddress || '');
  const userAgent = req.get('user-agent') || '';
  const acceptLanguage = req.get('accept-language') || '';
  const dayBucket = getDayString(new Date());

  return ['fallback', maskedIp, userAgent.slice(0, 160), acceptLanguage.slice(0, 80), dayBucket].join('|');
}

function maskIp(value) {
  const ip = String(value).replace(/^::ffff:/, '').trim();

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return ip.split('.').slice(0, 3).join('.');
  }

  if (ip.includes(':')) {
    return ip.split(':').filter(Boolean).slice(0, 4).join(':');
  }

  return '';
}

function getDayString(date) {
  return date.toISOString().slice(0, 10);
}

function getSessionWindow(date) {
  return Math.floor(date.getTime() / (SESSION_WINDOW_DAYS * DAY_MS));
}

function buildMetadataCounters(metadata) {
  const counters = {};

  for (const [key, value] of Object.entries(metadata || {})) {
    const safeKey = sanitizeCounterKey(key);

    if (typeof value === 'number' && Number.isFinite(value)) {
      counters[`sum_${safeKey}`] = value;
    }

    if (typeof value === 'boolean') {
      counters[`${safeKey}_${value}`] = 1;
    }

    if (typeof value === 'string' && value) {
      counters[`${safeKey}_${sanitizeCounterKey(value)}`] = 1;
    }
  }

  return counters;
}

function sanitizeCounterKey(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'unknown';
}

async function trackAnalyticsEvent({ req, eventName, path, metadata = {}, referrerHost }) {
  if (!isAllowedEvent(eventName)) {
    const error = new Error('Invalid analytics event.');
    error.statusCode = 400;
    throw error;
  }

  const now = new Date();
  const sanitizedMetadata = sanitizeMetadata(eventName, metadata);
  const event = {
    eventName,
    createdAt: now,
    expireAt: new Date(now.getTime() + EVENT_RETENTION_DAYS * DAY_MS),
    path: sanitizePath(path),
    referrerHost: referrerHost || extractReferrerHost(req, req.body),
    deviceType: detectDeviceType(req.get('user-agent')),
    browserFamily: detectBrowserFamily(req.get('user-agent')),
    sessionIdHash: buildSessionIdHash(req, req.body),
    metadata: sanitizedMetadata,
  };

  await AnalyticsEvent.create(event);
  await incrementDailyAggregate(eventName, now, sanitizedMetadata);

  return event;
}

async function incrementDailyAggregate(eventName, date, metadata) {
  const day = getDayString(date);
  const $inc = { count: 1 };
  const metadataCounters = buildMetadataCounters(metadata);

  for (const [key, value] of Object.entries(metadataCounters)) {
    $inc[`metadataCounters.${key}`] = value;
  }

  await AnalyticsDailyAggregate.updateOne(
    { day, eventName },
    {
      $setOnInsert: { day, eventName },
      $set: { updatedAt: new Date() },
      $inc,
    },
    { upsert: true }
  );
}

async function buildAnalyticsSummary() {
  const now = new Date();
  const [totals1d, totals7d, totals30d, topReferrerHosts, deviceTypes, traffic] = await Promise.all([
    buildTotals(1, now),
    buildTotals(7, now),
    buildTotals(30, now),
    buildTopReferrerHosts(now),
    buildDeviceTypes(now),
    buildTrafficSummary({ now }),
  ]);

  return {
    ok: true,
    generatedAt: now.toISOString(),
    trafficLast24h: traffic.last24h.total,
    trafficDailyHistory: traffic.dailyHistory,
    traffic,
    totals: {
      last1Day: totals1d,
      last7Days: totals7d,
      last30Days: totals30d,
    },
    funnel: EVENT_NAMES.filter((eventName) => [
      'landing_page_view',
      'offer_search_started',
      'offer_search_result',
      'offer_added_to_list',
      'apk_download_click',
      'app_open',
    ].includes(eventName)).map((eventName) => ({
      eventName,
      count: totals30d.byEventName[eventName] || 0,
    })),
    topReferrerHosts,
    deviceTypes,
  };
}

async function buildTrafficSummary({
  now = new Date(),
  days = 7,
  AnalyticsEventModel = AnalyticsEvent,
  AnalyticsDailyAggregateModel = AnalyticsDailyAggregate,
} = {}) {
  const [last24h, dailyHistory] = await Promise.all([
    buildRollingTrafficLast24h({ now, AnalyticsEventModel }),
    buildDailyTrafficHistory({ now, days, AnalyticsDailyAggregateModel }),
  ]);

  return {
    last24h,
    dailyHistory,
    countedEvents: TRAFFIC_EVENT_NAMES,
    excludedEvents: TRAFFIC_EXCLUDED_EVENT_NAMES,
    note: 'Aggregierte Nutzungsereignisse, keine personenbezogene Auswertung.',
  };
}

async function buildRollingTrafficLast24h({ now = new Date(), AnalyticsEventModel = AnalyticsEvent } = {}) {
  const until = new Date(now);
  const since = new Date(until.getTime() - DAY_MS);
  const rows = await AnalyticsEventModel.aggregate([
    {
      $match: {
        createdAt: { $gte: since, $lte: until },
        eventName: { $in: TRAFFIC_EVENT_NAMES },
      },
    },
    { $group: { _id: '$eventName', count: { $sum: 1 } } },
    { $project: { _id: 0, eventName: '$_id', count: 1 } },
  ]);
  const byEventName = buildEmptyTrafficEventCounts();

  for (const row of rows) {
    byEventName[row.eventName] = Number(row.count || 0);
  }

  return {
    total: sumCounts(byEventName),
    byEventName,
    since: since.toISOString(),
    until: until.toISOString(),
  };
}

async function buildDailyTrafficHistory({
  now = new Date(),
  days = 7,
  AnalyticsDailyAggregateModel = AnalyticsDailyAggregate,
} = {}) {
  const safeDays = Math.max(1, Math.min(14, Number(days) || 7));
  const startDate = new Date(now.getTime() - (safeDays - 1) * DAY_MS);
  const start = getDayString(startDate);
  const rows = await AnalyticsDailyAggregateModel.find({
    day: { $gte: start },
    eventName: { $in: TRAFFIC_EVENT_NAMES },
  }).lean();
  const daily = new Map();

  for (let index = 0; index < safeDays; index += 1) {
    const day = getDayString(new Date(startDate.getTime() + index * DAY_MS));
    daily.set(day, {
      date: day,
      total: 0,
      byEventName: buildEmptyTrafficEventCounts(),
    });
  }

  for (const row of rows) {
    const day = daily.get(row.day);
    if (!day || !TRAFFIC_EVENT_NAMES.includes(row.eventName)) {
      continue;
    }

    day.byEventName[row.eventName] = Number(row.count || 0);
  }

  return [...daily.values()].map((day) => ({
    ...day,
    total: sumCounts(day.byEventName),
  }));
}

function buildEmptyTrafficEventCounts() {
  return Object.fromEntries(TRAFFIC_EVENT_NAMES.map((eventName) => [eventName, 0]));
}

function sumCounts(counts) {
  return Object.values(counts || {}).reduce((sum, count) => sum + Number(count || 0), 0);
}

async function buildTotals(days, now) {
  const start = getDayString(new Date(now.getTime() - (days - 1) * DAY_MS));
  const rows = await AnalyticsDailyAggregate.find({ day: { $gte: start } }).lean();
  const byEventName = Object.fromEntries(EVENT_NAMES.map((eventName) => [eventName, 0]));

  for (const row of rows) {
    byEventName[row.eventName] = (byEventName[row.eventName] || 0) + row.count;
  }

  return {
    total: Object.values(byEventName).reduce((sum, count) => sum + count, 0),
    byEventName,
  };
}

async function buildTopReferrerHosts(now) {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const rows = await AnalyticsEvent.aggregate([
    { $match: { createdAt: { $gte: since }, referrerHost: { $nin: ['', null] } } },
    { $group: { _id: '$referrerHost', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
    { $project: { _id: 0, referrerHost: '$_id', count: 1 } },
  ]);

  return rows;
}

async function buildDeviceTypes(now) {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const rows = await AnalyticsEvent.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: '$deviceType', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $project: { _id: 0, deviceType: '$_id', count: 1 } },
  ]);

  return rows;
}

module.exports = {
  ALLOWED_EVENTS,
  EVENT_NAMES,
  TRAFFIC_EVENT_NAMES,
  TRAFFIC_EXCLUDED_EVENT_NAMES,
  buildDailyTrafficHistory,
  buildAnalyticsSummary,
  buildRollingTrafficLast24h,
  buildTrafficSummary,
  sanitizeMetadata,
  trackAnalyticsEvent,
};
