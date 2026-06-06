const { execFile: execFileCallback } = require('node:child_process');
const https = require('node:https');
const http2 = require('node:http2');
const { promisify } = require('node:util');
const zlib = require('node:zlib');

const execFile = promisify(execFileCallback);

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_DELAY_MS = 750;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_MATRIX_COMBINATIONS = 40;

const PUBLIC_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

const BASE_BROWSER_HEADERS = {
  'user-agent': PUBLIC_BROWSER_UA,
  'accept-language': 'de-AT,de;q=0.9,en-US;q=0.8,en;q=0.7',
};

const HTML_BROWSER_HEADERS = {
  ...BASE_BROWSER_HEADERS,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'sec-fetch-site': 'none',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
};

const SPAR_PRODUCTWORLD_HEADERS = {
  ...BASE_BROWSER_HEADERS,
  accept: 'application/json, text/plain, */*',
  origin: 'https://www.spar.at',
  referer: 'https://www.spar.at/produktwelt/',
  'sec-fetch-site': 'cross-site',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
  'content-type': 'application/json',
};

const SOURCE_TRANSPORT_TARGETS = [
  {
    id: 'spar-productworld-inangebot',
    retailerKey: 'spar',
    sourceFamily: 'spar-family-official-productworld',
    label: 'SPAR Productworld BFF inAngebot',
    method: 'GET',
    expectedContentKind: 'json',
    url: 'https://api-scp.spar-ics.com/ecom/pw/v1/search/v1/search?query=*&filter=inAngebot:true&hitsPerPage=3&marketId=NATIONAL&showPermutedSearchParams=false',
    headers: SPAR_PRODUCTWORLD_HEADERS,
    deployNotes: 'Official anonymous Productworld BFF. Enable only when production transport returns JSON without challenge.',
  },
  {
    id: 'spar-productworld-preisgesenkt',
    retailerKey: 'spar',
    sourceFamily: 'spar-family-official-productworld',
    label: 'SPAR Productworld BFF isPreisGesenkt',
    method: 'GET',
    expectedContentKind: 'json',
    url: 'https://api-scp.spar-ics.com/ecom/pw/v1/search/v1/search?query=*&filter=isPreisGesenkt:true&hitsPerPage=3&marketId=NATIONAL&showPermutedSearchParams=false',
    headers: SPAR_PRODUCTWORLD_HEADERS,
    deployNotes: 'Official anonymous Productworld BFF. Enable only when production transport returns JSON without challenge.',
  },
  {
    id: 'eurospar-productworld-inangebot',
    retailerKey: 'eurospar',
    sourceFamily: 'spar-family-official-productworld',
    label: 'EUROSPAR Productworld BFF inAngebot',
    method: 'GET',
    expectedContentKind: 'json',
    url: 'https://api-scp.spar-ics.com/ecom/pw/v1/search/v1/search?query=*&filter=inAngebot:true&hitsPerPage=3&marketId=EUROSPAR&showPermutedSearchParams=false',
    headers: SPAR_PRODUCTWORLD_HEADERS,
    deployNotes: 'Official anonymous Productworld BFF. Enable only when production transport returns JSON without challenge.',
  },
  {
    id: 'eurospar-productworld-preisgesenkt',
    retailerKey: 'eurospar',
    sourceFamily: 'spar-family-official-productworld',
    label: 'EUROSPAR Productworld BFF isPreisGesenkt',
    method: 'GET',
    expectedContentKind: 'json',
    url: 'https://api-scp.spar-ics.com/ecom/pw/v1/search/v1/search?query=*&filter=isPreisGesenkt:true&hitsPerPage=3&marketId=EUROSPAR&showPermutedSearchParams=false',
    headers: SPAR_PRODUCTWORLD_HEADERS,
    deployNotes: 'Official anonymous Productworld BFF. Enable only when production transport returns JSON without challenge.',
  },
  {
    id: 'interspar-productworld-inangebot',
    retailerKey: 'interspar',
    sourceFamily: 'spar-family-official-productworld',
    label: 'INTERSPAR Productworld BFF inAngebot',
    method: 'GET',
    expectedContentKind: 'json',
    url: 'https://api-scp.spar-ics.com/ecom/pw/v1/search/v1/search?query=*&filter=inAngebot:true&hitsPerPage=3&marketId=INTERSPAR&showPermutedSearchParams=false',
    headers: SPAR_PRODUCTWORLD_HEADERS,
    deployNotes: 'Official anonymous Productworld BFF. Enable only when production transport returns JSON without challenge.',
  },
  {
    id: 'interspar-productworld-preisgesenkt',
    retailerKey: 'interspar',
    sourceFamily: 'spar-family-official-productworld',
    label: 'INTERSPAR Productworld BFF isPreisGesenkt',
    method: 'GET',
    expectedContentKind: 'json',
    url: 'https://api-scp.spar-ics.com/ecom/pw/v1/search/v1/search?query=*&filter=isPreisGesenkt:true&hitsPerPage=3&marketId=INTERSPAR&showPermutedSearchParams=false',
    headers: SPAR_PRODUCTWORLD_HEADERS,
    deployNotes: 'Official anonymous Productworld BFF. Enable only when production transport returns JSON without challenge.',
  },
  {
    id: 'pagro-angebote',
    retailerKey: 'pagro',
    sourceFamily: 'pagro-official-site',
    label: 'PAGRO Angebote',
    method: 'GET',
    expectedContentKind: 'html',
    url: 'https://www.pagro.at/angebote',
    headers: HTML_BROWSER_HEADERS,
    deployNotes: 'Official public offers HTML. Enable only if production HTML is reachable without Cloudflare challenge.',
  },
  {
    id: 'pagro-angebote-page-2',
    retailerKey: 'pagro',
    sourceFamily: 'pagro-official-site',
    label: 'PAGRO Angebote page 2',
    method: 'GET',
    expectedContentKind: 'html',
    url: 'https://www.pagro.at/angebote?p=2',
    headers: HTML_BROWSER_HEADERS,
    deployNotes: 'Pagination probe for public PAGRO offers HTML.',
  },
  {
    id: 'pagro-sale',
    retailerKey: 'pagro',
    sourceFamily: 'pagro-official-site',
    label: 'PAGRO Sale',
    method: 'GET',
    expectedContentKind: 'html',
    url: 'https://www.pagro.at/angebote/sale',
    headers: HTML_BROWSER_HEADERS,
    deployNotes: 'Category seed probe for public PAGRO offers HTML.',
  },
  {
    id: 'pagro-detail-sample',
    retailerKey: 'pagro',
    sourceFamily: 'pagro-official-site',
    label: 'PAGRO detail sample',
    method: 'GET',
    expectedContentKind: 'html',
    url: 'https://www.pagro.at/novooo-professional-collegeblock-a4-80-blatt-kariert-9010729007694.html',
    headers: HTML_BROWSER_HEADERS,
    deployNotes: 'Public product detail probe with EAN in URL.',
  },
  {
    id: 'hofer-official',
    retailerKey: 'hofer',
    sourceFamily: 'hofer-official-flyer',
    label: 'HOFER official offers overview',
    method: 'GET',
    expectedContentKind: 'html',
    url: 'https://www.hofer.at/de/angebote/angebote-im-ueberblick.html?productState=In+der+Filiale+erh%C3%A4ltlich',
    headers: HTML_BROWSER_HEADERS,
  },
  {
    id: 'lidl-official',
    retailerKey: 'lidl',
    sourceFamily: 'lidl-official-flyer',
    label: 'Lidl official action page',
    method: 'GET',
    expectedContentKind: 'html',
    url: 'https://www.lidl.at/c/aktion/a10095240',
    headers: HTML_BROWSER_HEADERS,
  },
  {
    id: 'billa-official',
    retailerKey: 'billa',
    sourceFamily: 'billa-official-site',
    label: 'BILLA official actions',
    method: 'GET',
    expectedContentKind: 'html',
    url: 'https://www.billa.at/unsere-aktionen/aktionen',
    headers: HTML_BROWSER_HEADERS,
  },
  {
    id: 'penny-official',
    retailerKey: 'penny',
    sourceFamily: 'penny-official-site',
    label: 'PENNY official offers',
    method: 'GET',
    expectedContentKind: 'html',
    url: 'https://www.penny.at/angebote',
    headers: HTML_BROWSER_HEADERS,
  },
  {
    id: 'dm-official',
    retailerKey: 'dm',
    sourceFamily: 'dm-official-product-search',
    label: 'dm Ausverkauf',
    method: 'GET',
    expectedContentKind: 'html',
    url: 'https://www.dm.at/ausverkauf',
    headers: HTML_BROWSER_HEADERS,
  },
  {
    id: 'bipa-official',
    retailerKey: 'bipa',
    sourceFamily: 'bipa-official-site',
    label: 'BIPA Aktionen',
    method: 'GET',
    expectedContentKind: 'html',
    url: 'https://www.bipa.at/cp/aktionen',
    headers: HTML_BROWSER_HEADERS,
  },
  {
    id: 'bipa-onlineonly',
    retailerKey: 'bipa',
    sourceFamily: 'bipa-official-onlineonly',
    label: 'BIPA Online Only',
    method: 'GET',
    expectedContentKind: 'html',
    url: 'https://www.bipa.at/cp/onlineonly',
    headers: HTML_BROWSER_HEADERS,
    deployNotes: 'Official BIPA online-only offer page. Offers must carry explicit Online only condition.',
  },
  {
    id: 'aktionsfinder-pagro',
    retailerKey: 'pagro',
    sourceFamily: 'aktionsfinder-pagro',
    label: 'Aktionsfinder PAGRO & LIBRO',
    method: 'GET',
    expectedContentKind: 'html',
    url: 'https://www.aktionsfinder.at/pv/pagro-libro/',
    headers: HTML_BROWSER_HEADERS,
  },
];

const SOURCE_TRANSPORT_CLIENTS = [
  { id: 'global-fetch', label: 'Node global fetch', deployable: true },
  { id: 'undici', label: 'undici/fetch runtime', deployable: true },
  { id: 'native-https', label: 'Node native https HTTP/1.1', deployable: true },
  { id: 'axios', label: 'axios', deployable: true },
  { id: 'got', label: 'got', deployable: false },
  { id: 'http2', label: 'Node HTTP/2 client', deployable: true },
  { id: 'playwright-request', label: 'Playwright request context', deployable: false },
  { id: 'curl', label: 'curl subprocess', deployable: true, requiresBinary: true },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lowerHeaderMap(headers = {}) {
  const result = {};

  if (!headers) return result;

  if (typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      result[String(key).toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
    });
    return result;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (typeof key === 'symbol') continue;
    result[String(key).toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  }

  return result;
}

function sanitizeHeaders(headers = {}) {
  const blockedNames = new Set([
    'authorization',
    'cookie',
    'set-cookie',
    'x-admin-api-key',
    'x-api-key',
    'bearer',
  ]);

  return Object.fromEntries(
    Object.entries(lowerHeaderMap(headers))
      .filter(([key]) => !blockedNames.has(key))
      .map(([key, value]) => [key, String(value).slice(0, 220)])
  );
}

function summarizeRequestHeaders(headers = {}) {
  return sanitizeHeaders(headers);
}

function detectCloudflare(headers = {}, bodyText = '') {
  const lowerHeaders = lowerHeaderMap(headers);
  const body = String(bodyText || '').slice(0, 100000).toLowerCase();
  const server = String(lowerHeaders.server || '').toLowerCase();
  const signals = [];

  if (server.includes('cloudflare')) signals.push('server=cloudflare');
  if (lowerHeaders['cf-ray']) signals.push('cf-ray');
  if (lowerHeaders['cf-cache-status']) signals.push('cf-cache-status');
  if (lowerHeaders['cf-mitigated']) signals.push(`cf-mitigated=${lowerHeaders['cf-mitigated']}`);
  if (lowerHeaders['cf-chl-out']) signals.push('cf-chl-out');
  if (body.includes('just a moment')) signals.push('body:just-a-moment');
  if (body.includes('/cdn-cgi/challenge-platform') || body.includes('challenge-platform')) signals.push('body:challenge-platform');
  if (body.includes('cf_chl') || body.includes('__cf_chl')) signals.push('body:cf_chl');
  if (body.includes('enable javascript and cookies')) signals.push('body:enable-javascript-cookies');
  if (body.includes('turnstile')) signals.push('body:turnstile');
  if (body.includes('captcha')) signals.push('body:captcha');

  return {
    present: signals.length > 0,
    challengeLikely: signals.some((signal) => /challenge|just-a-moment|cf_chl|javascript|turnstile|captcha|cf-mitigated/.test(signal)),
    signals,
  };
}

function decodeBody(buffer, headers = {}) {
  const contentEncoding = String(lowerHeaderMap(headers)['content-encoding'] || '').toLowerCase();
  let decoded = buffer || Buffer.alloc(0);

  try {
    if (contentEncoding.includes('br')) {
      decoded = zlib.brotliDecompressSync(decoded);
    } else if (contentEncoding.includes('gzip')) {
      decoded = zlib.gunzipSync(decoded);
    } else if (contentEncoding.includes('deflate')) {
      decoded = zlib.inflateSync(decoded);
    }
  } catch (error) {
    return {
      text: decoded.toString('utf8'),
      decodeError: error.message,
    };
  }

  return {
    text: decoded.toString('utf8'),
    decodeError: '',
  };
}

function classifyResponse({ status, headers = {}, bodyText = '', error = null, expectedContentKind = '' } = {}) {
  const normalizedHeaders = lowerHeaderMap(headers);
  const contentType = normalizedHeaders['content-type'] || '';
  const waf = detectCloudflare(normalizedHeaders, bodyText);
  const text = String(bodyText || '').trim();
  const lowerText = text.slice(0, 1000).toLowerCase();
  let jsonParseable = false;

  if (text) {
    try {
      JSON.parse(text);
      jsonParseable = true;
    } catch (parseError) {
      jsonParseable = false;
    }
  }

  let responseKind = 'empty';

  if (error) {
    responseKind = 'error';
  } else if (waf.challengeLikely) {
    responseKind = 'html-challenge';
  } else if (jsonParseable) {
    responseKind = 'json';
  } else if (/json/i.test(contentType)) {
    responseKind = text ? 'json-invalid' : 'json-empty';
  } else if (/html/i.test(contentType) || /^<!doctype html|^<html|<body/i.test(lowerText)) {
    responseKind = 'html';
  } else if (/pdf/i.test(contentType)) {
    responseKind = 'pdf';
  } else if (text) {
    responseKind = 'text';
  }

  const statusNumber = Number(status || 0);
  const blockedLikely = waf.challengeLikely || [401, 403, 407, 429, 451].includes(statusNumber);
  const usableJson = expectedContentKind === 'json' && statusNumber >= 200 && statusNumber < 300 && responseKind === 'json';
  const usableHtml = expectedContentKind === 'html' && statusNumber >= 200 && statusNumber < 300 && responseKind === 'html';
  const usable = usableJson || usableHtml;

  return {
    status: statusNumber || null,
    contentType,
    responseKind,
    jsonParseable,
    jsonReturned: responseKind === 'json',
    blockedLikely,
    usable,
    waf,
  };
}

function collectLimitedStream(stream, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const timer = setTimeout(() => {
      stream.destroy(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    stream.on('data', (chunk) => {
      if (total >= MAX_RESPONSE_BYTES) return;
      const buffer = Buffer.from(chunk);
      const remaining = MAX_RESPONSE_BYTES - total;
      chunks.push(buffer.slice(0, remaining));
      total += Math.min(buffer.length, remaining);
    });

    stream.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });

    stream.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function buildResult({ clientId, target, startedAt, status, headers, bodyText, finalUrl, httpVersion, error, unavailableReason }) {
  const classification = classifyResponse({
    status,
    headers,
    bodyText,
    error,
    expectedContentKind: target.expectedContentKind,
  });
  const client = SOURCE_TRANSPORT_CLIENTS.find((entry) => entry.id === clientId) || {};

  let decision = 'blocked';
  if (unavailableReason) {
    decision = 'unavailable';
  } else if (error) {
    decision = /timeout/i.test(error.message || '') ? 'timeout' : 'failed';
  } else if (classification.usable) {
    decision = clientId === 'curl' ? 'usable-curl-subprocess' : 'usable-backend-client';
  } else if (classification.blockedLikely) {
    decision = classification.waf.challengeLikely ? 'blocked-waf-challenge' : 'blocked-http-status';
  } else if (classification.status && classification.status >= 200 && classification.status < 300) {
    decision = 'wrong-content-kind';
  } else if (classification.status && classification.status >= 400) {
    decision = 'blocked-http-status';
  }

  return {
    clientId,
    clientLabel: client.label || clientId,
    targetId: target.id,
    targetLabel: target.label,
    retailerKey: target.retailerKey,
    sourceFamily: target.sourceFamily,
    url: target.url,
    method: target.method || 'GET',
    expectedContentKind: target.expectedContentKind,
    status: classification.status,
    contentType: classification.contentType,
    responseKind: classification.responseKind,
    jsonReturned: classification.jsonReturned,
    blockedLikely: classification.blockedLikely,
    cloudflare: classification.waf,
    finalUrl: finalUrl || target.url,
    httpVersion: httpVersion || '',
    bodyBytesSampled: Buffer.byteLength(String(bodyText || ''), 'utf8'),
    requestHeaders: summarizeRequestHeaders(target.headers || {}),
    deployableClient: client.deployable === true,
    requiresBinary: client.requiresBinary === true,
    unavailableReason: unavailableReason || '',
    error: error ? {
      name: error.name || '',
      code: error.code || '',
      message: String(error.message || error).slice(0, 300),
    } : null,
    durationMs: Date.now() - startedAt,
    decision,
  };
}

async function runFetchLikeClient(clientId, target, timeoutMs) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(target.url, {
      method: target.method || 'GET',
      headers: target.headers || {},
      signal: controller.signal,
      redirect: 'follow',
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const bodyText = decodeBody(buffer, response.headers).text;

    return buildResult({
      clientId,
      target,
      startedAt,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      bodyText,
      finalUrl: response.url,
      httpVersion: 'fetch-runtime',
    });
  } catch (error) {
    return buildResult({ clientId, target, startedAt, error });
  } finally {
    clearTimeout(timer);
  }
}

async function runNativeHttpsClient(target, timeoutMs) {
  const startedAt = Date.now();
  const url = new URL(target.url);

  return new Promise((resolve) => {
    const request = https.request({
      method: target.method || 'GET',
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      headers: target.headers || {},
      timeout: timeoutMs,
    }, async (response) => {
      try {
        const buffer = await collectLimitedStream(response, timeoutMs);
        const decoded = decodeBody(buffer, response.headers);
        resolve(buildResult({
          clientId: 'native-https',
          target,
          startedAt,
          status: response.statusCode,
          headers: response.headers,
          bodyText: decoded.text,
          finalUrl: target.url,
          httpVersion: `HTTP/${response.httpVersion}`,
        }));
      } catch (error) {
        resolve(buildResult({ clientId: 'native-https', target, startedAt, error }));
      }
    });

    request.on('timeout', () => {
      request.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });

    request.on('error', (error) => {
      resolve(buildResult({ clientId: 'native-https', target, startedAt, error }));
    });

    request.end();
  });
}

async function runAxiosClient(target, timeoutMs) {
  const startedAt = Date.now();

  let axios;
  try {
    axios = require('axios');
  } catch (error) {
    return buildResult({
      clientId: 'axios',
      target,
      startedAt,
      unavailableReason: 'axios package is not installed',
    });
  }

  try {
    const response = await axios({
      url: target.url,
      method: target.method || 'GET',
      headers: target.headers || {},
      timeout: timeoutMs,
      maxRedirects: 5,
      responseType: 'arraybuffer',
      decompress: true,
      validateStatus: () => true,
    });
    const bodyText = Buffer.from(response.data || '').toString('utf8');

    return buildResult({
      clientId: 'axios',
      target,
      startedAt,
      status: response.status,
      headers: response.headers,
      bodyText,
      finalUrl: response.request?.res?.responseUrl || target.url,
      httpVersion: response.request?.res?.httpVersion ? `HTTP/${response.request.res.httpVersion}` : 'axios',
    });
  } catch (error) {
    return buildResult({ clientId: 'axios', target, startedAt, error });
  }
}

async function runHttp2Client(target, timeoutMs) {
  const startedAt = Date.now();
  const url = new URL(target.url);
  let client;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (client) client.close();
      resolve(buildResult({
        clientId: 'http2',
        target,
        startedAt,
        error: new Error(`timeout after ${timeoutMs}ms`),
      }));
    }, timeoutMs);

    try {
      client = http2.connect(url.origin);
      client.on('error', (error) => {
        clearTimeout(timer);
        resolve(buildResult({ clientId: 'http2', target, startedAt, error }));
      });

      const headers = {
        ':method': target.method || 'GET',
        ':scheme': url.protocol.replace(':', ''),
        ':authority': url.host,
        ':path': `${url.pathname}${url.search}`,
        ...(target.headers || {}),
      };
      delete headers.host;

      const request = client.request(headers);
      const chunks = [];
      let total = 0;
      let responseHeaders = {};
      let status = null;

      request.on('response', (incomingHeaders) => {
        responseHeaders = incomingHeaders;
        status = Number(incomingHeaders[':status'] || 0);
      });

      request.on('data', (chunk) => {
        if (total >= MAX_RESPONSE_BYTES) return;
        const buffer = Buffer.from(chunk);
        const remaining = MAX_RESPONSE_BYTES - total;
        chunks.push(buffer.slice(0, remaining));
        total += Math.min(buffer.length, remaining);
      });

      request.on('end', () => {
        clearTimeout(timer);
        client.close();
        const decoded = decodeBody(Buffer.concat(chunks), responseHeaders);
        resolve(buildResult({
          clientId: 'http2',
          target,
          startedAt,
          status,
          headers: responseHeaders,
          bodyText: decoded.text,
          finalUrl: target.url,
          httpVersion: 'HTTP/2',
        }));
      });

      request.on('error', (error) => {
        clearTimeout(timer);
        client.close();
        resolve(buildResult({ clientId: 'http2', target, startedAt, error }));
      });

      request.end();
    } catch (error) {
      clearTimeout(timer);
      if (client) client.close();
      resolve(buildResult({ clientId: 'http2', target, startedAt, error }));
    }
  });
}

function parseCurlOutput(stdout = '') {
  const marker = '\n__KKT_META__';
  const markerIndex = stdout.lastIndexOf(marker);
  const raw = markerIndex >= 0 ? stdout.slice(0, markerIndex) : stdout;
  const metaRaw = markerIndex >= 0 ? stdout.slice(markerIndex + marker.length).trim() : '';
  const [statusRaw, contentTypeRaw, finalUrlRaw, httpVersionRaw] = metaRaw.split('|');
  const sections = raw.split(/\r?\n\r?\n/);
  const headerSections = [];
  let bodyIndex = 0;

  for (let index = 0; index < sections.length; index += 1) {
    if (/^HTTP\//i.test(sections[index])) {
      headerSections.push(sections[index]);
      bodyIndex = index + 1;
    } else {
      break;
    }
  }

  const headers = {};
  const lastHeaderSection = headerSections[headerSections.length - 1] || '';
  for (const line of lastHeaderSection.split(/\r?\n/).slice(1)) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();
    if (!headers[key]) {
      headers[key] = value;
    } else {
      headers[key] = `${headers[key]}, ${value}`;
    }
  }

  const bodyText = sections.slice(bodyIndex).join('\n\n');

  return {
    status: Number(statusRaw || 0) || null,
    contentType: contentTypeRaw || headers['content-type'] || '',
    finalUrl: finalUrlRaw || '',
    httpVersion: httpVersionRaw ? `HTTP/${httpVersionRaw}` : '',
    headers: {
      ...headers,
      ...(contentTypeRaw ? { 'content-type': contentTypeRaw } : {}),
    },
    bodyText,
  };
}

async function runCurlClient(target, timeoutMs) {
  const startedAt = Date.now();
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const args = [
    '--silent',
    '--show-error',
    '--location',
    '--compressed',
    '--max-time',
    String(timeoutSeconds),
    '--dump-header',
    '-',
    '--output',
    '-',
    '--write-out',
    '\n__KKT_META__%{http_code}|%{content_type}|%{url_effective}|%{http_version}',
    '--request',
    target.method || 'GET',
  ];

  if (process.platform === 'win32') {
    args.push('--ssl-no-revoke');
  }

  for (const [key, value] of Object.entries(target.headers || {})) {
    args.push('--header', `${key}: ${value}`);
  }

  args.push(target.url);

  try {
    const result = await execFile('curl', args, {
      timeout: timeoutMs + 2000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const parsed = parseCurlOutput(result.stdout || '');

    return buildResult({
      clientId: 'curl',
      target,
      startedAt,
      status: parsed.status,
      headers: parsed.headers,
      bodyText: parsed.bodyText,
      finalUrl: parsed.finalUrl,
      httpVersion: parsed.httpVersion,
    });
  } catch (error) {
    return buildResult({ clientId: 'curl', target, startedAt, error });
  }
}

async function runUnavailablePackageClient(clientId, target, startedAt, packageName) {
  try {
    require.resolve(packageName);
  } catch (error) {
    return buildResult({
      clientId,
      target,
      startedAt,
      unavailableReason: `${packageName} package is not installed`,
    });
  }

  return buildResult({
    clientId,
    target,
    startedAt,
    unavailableReason: `${packageName} is installed but no diagnostic adapter is configured`,
  });
}

async function runClientProbe({ clientId, target, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (clientId === 'global-fetch' || clientId === 'undici') {
    return runFetchLikeClient(clientId, target, timeoutMs);
  }
  if (clientId === 'native-https') {
    return runNativeHttpsClient(target, timeoutMs);
  }
  if (clientId === 'axios') {
    return runAxiosClient(target, timeoutMs);
  }
  if (clientId === 'http2') {
    return runHttp2Client(target, timeoutMs);
  }
  if (clientId === 'curl') {
    return runCurlClient(target, timeoutMs);
  }
  if (clientId === 'got') {
    return runUnavailablePackageClient('got', target, Date.now(), 'got');
  }
  if (clientId === 'playwright-request') {
    return runUnavailablePackageClient('playwright-request', target, Date.now(), 'playwright');
  }

  return buildResult({
    clientId,
    target,
    startedAt: Date.now(),
    unavailableReason: 'unknown client id',
  });
}

function selectTargets(targetIds = []) {
  if (!targetIds.length || targetIds.includes('all')) {
    return SOURCE_TRANSPORT_TARGETS;
  }
  const requested = new Set(targetIds);
  return SOURCE_TRANSPORT_TARGETS.filter((target) => requested.has(target.id));
}

function selectClients(clientIds = []) {
  if (!clientIds.length || clientIds.includes('all')) {
    return SOURCE_TRANSPORT_CLIENTS.map((client) => client.id);
  }
  const known = new Set(SOURCE_TRANSPORT_CLIENTS.map((client) => client.id));
  return clientIds.filter((clientId) => known.has(clientId));
}

function evaluateSourceTransportReadiness({ target, results = [], allowCurlSubprocess = true } = {}) {
  const relevant = results.filter((result) => !target || result.targetId === target.id);
  const usable = relevant.filter((result) => result.decision === 'usable-backend-client' || result.decision === 'usable-curl-subprocess');
  const backendUsable = usable.filter((result) => result.decision === 'usable-backend-client');
  const curlUsable = usable.filter((result) => result.decision === 'usable-curl-subprocess');
  const blocked = relevant.filter((result) => result.blockedLikely || /^blocked/.test(result.decision));
  const challenges = relevant.filter((result) => result.cloudflare?.challengeLikely);
  const tlsErrors = relevant.filter((result) => /CERT|TLS|SSL|UNABLE_TO_VERIFY/i.test(`${result.error?.code || ''} ${result.error?.message || ''}`));

  let verdict = 'blocked';
  let deployable = false;
  let reason = 'No usable transport returned the expected content.';

  if (backendUsable.length > 0) {
    verdict = 'backend-transport-usable';
    deployable = true;
    reason = `${backendUsable.length} backend client(s) returned expected content.`;
  } else if (curlUsable.length > 0 && allowCurlSubprocess) {
    verdict = 'curl-subprocess-candidate';
    deployable = true;
    reason = 'Only curl returned expected content; deploy requires curl binary and production confirmation.';
  } else if (challenges.length > 0) {
    verdict = 'blocked-waf-challenge';
    reason = `${challenges.length} probe(s) returned Cloudflare/WAF challenge indicators.`;
  } else if (tlsErrors.length > 0) {
    verdict = 'blocked-tls-or-cert';
    reason = `${tlsErrors.length} probe(s) failed with TLS/certificate errors.`;
  } else if (blocked.length > 0) {
    verdict = 'blocked-http-status';
    reason = `${blocked.length} probe(s) returned blocked HTTP status.`;
  }

  return {
    targetId: target?.id || '',
    retailerKey: target?.retailerKey || '',
    sourceFamily: target?.sourceFamily || '',
    verdict,
    deployable,
    reason,
    usableClients: usable.map((result) => result.clientId),
    backendUsableClients: backendUsable.map((result) => result.clientId),
    curlUsable: curlUsable.length > 0,
    blockedCount: blocked.length,
    challengeCount: challenges.length,
    tlsErrorCount: tlsErrors.length,
  };
}

function buildRetailerMatrix(results = []) {
  const byRetailer = new Map();

  for (const result of results) {
    const key = result.retailerKey || 'unknown';
    if (!byRetailer.has(key)) {
      byRetailer.set(key, {
        retailerKey: key,
        targets: new Set(),
        usableTargets: new Set(),
        blockedTargets: new Set(),
        usableClients: new Set(),
        challengeCount: 0,
        decisions: new Set(),
      });
    }

    const row = byRetailer.get(key);
    row.targets.add(result.targetId);
    row.decisions.add(result.decision);
    if (result.decision === 'usable-backend-client' || result.decision === 'usable-curl-subprocess') {
      row.usableTargets.add(result.targetId);
      row.usableClients.add(result.clientId);
    }
    if (result.blockedLikely || /^blocked/.test(result.decision)) {
      row.blockedTargets.add(result.targetId);
    }
    if (result.cloudflare?.challengeLikely) {
      row.challengeCount += 1;
    }
  }

  return [...byRetailer.values()].map((row) => ({
    retailerKey: row.retailerKey,
    targetCount: row.targets.size,
    usableTargetCount: row.usableTargets.size,
    blockedTargetCount: row.blockedTargets.size,
    usableClients: [...row.usableClients].sort(),
    challengeCount: row.challengeCount,
    decisions: [...row.decisions].sort(),
    recommendation: row.usableTargets.size > 0
      ? 'transport-candidate-confirm-production-before-enabling-source'
      : 'do-not-enable-official-source',
  })).sort((left, right) => left.retailerKey.localeCompare(right.retailerKey));
}

async function runSourceTransportMatrix({
  targetIds = [],
  clientIds = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  delayMs = DEFAULT_DELAY_MS,
  maxCombinations = MAX_MATRIX_COMBINATIONS,
  allowCurlSubprocess = true,
} = {}) {
  const targets = selectTargets(targetIds);
  const clients = selectClients(clientIds);
  const combinations = targets.length * clients.length;

  if (targets.length === 0) {
    const error = new Error('No known source transport targets matched the request.');
    error.statusCode = 400;
    throw error;
  }

  if (clients.length === 0) {
    const error = new Error('No known source transport clients matched the request.');
    error.statusCode = 400;
    throw error;
  }

  if (combinations > maxCombinations) {
    const error = new Error(`Transport matrix too large: ${combinations} combinations exceed limit ${maxCombinations}.`);
    error.statusCode = 400;
    error.details = { combinations, maxCombinations };
    throw error;
  }

  const startedAt = new Date().toISOString();
  const results = [];

  for (const target of targets) {
    for (const clientId of clients) {
      results.push(await runClientProbe({ clientId, target, timeoutMs }));
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  const readiness = targets.map((target) => evaluateSourceTransportReadiness({
    target,
    results,
    allowCurlSubprocess,
  }));

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    generatedAt: new Date().toISOString(),
    startedAt,
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid,
    },
    limits: {
      timeoutMs,
      delayMs,
      maxCombinations,
    },
    targetIds: targets.map((target) => target.id),
    clientIds: clients,
    summary: {
      resultCount: results.length,
      usable: results.filter((result) => result.decision === 'usable-backend-client' || result.decision === 'usable-curl-subprocess').length,
      blocked: results.filter((result) => result.blockedLikely || /^blocked/.test(result.decision)).length,
      challenges: results.filter((result) => result.cloudflare?.challengeLikely).length,
      unavailable: results.filter((result) => result.decision === 'unavailable').length,
    },
    targets: targets.map((target) => ({
      id: target.id,
      retailerKey: target.retailerKey,
      sourceFamily: target.sourceFamily,
      label: target.label,
      url: target.url,
      expectedContentKind: target.expectedContentKind,
      requestHeaders: summarizeRequestHeaders(target.headers || {}),
      deployNotes: target.deployNotes || '',
    })),
    results,
    readiness,
    retailers: buildRetailerMatrix(results),
  };
}

module.exports = {
  BASE_BROWSER_HEADERS,
  DEFAULT_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  HTML_BROWSER_HEADERS,
  MAX_MATRIX_COMBINATIONS,
  SOURCE_TRANSPORT_CLIENTS,
  SOURCE_TRANSPORT_TARGETS,
  SPAR_PRODUCTWORLD_HEADERS,
  buildRetailerMatrix,
  classifyResponse,
  detectCloudflare,
  evaluateSourceTransportReadiness,
  parseCurlOutput,
  runClientProbe,
  runSourceTransportMatrix,
  sanitizeHeaders,
  selectClients,
  selectTargets,
};
