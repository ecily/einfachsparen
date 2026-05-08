const axios = require('axios');
const cheerio = require('cheerio');
const { sanitizeWhitespace } = require('./sourceEvidence');

function toAbsoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch (error) {
    return '';
  }
}

function pushIssuuDocument(documents, seen, username, documentName, embedUrl = '') {
  const normalizedUsername = sanitizeWhitespace(username);
  const normalizedDocumentName = sanitizeWhitespace(documentName);

  if (!normalizedUsername || !normalizedDocumentName) {
    return;
  }

  const key = `${normalizedUsername}::${normalizedDocumentName}`;

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  documents.push({
    username: normalizedUsername,
    documentName: normalizedDocumentName,
    embedUrl,
    documentUrl: `https://issuu.com/${encodeURIComponent(normalizedUsername)}/docs/${encodeURIComponent(normalizedDocumentName)}`,
  });
}

function extractIssuuDocumentFromUrl(value = '') {
  const url = sanitizeWhitespace(value);

  if (!url || !/issuu\.com/i.test(url)) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);

    if (/^e\.issuu\.com$/i.test(parsedUrl.hostname)) {
      const username = parsedUrl.searchParams.get('u');
      const documentName = parsedUrl.searchParams.get('d');

      if (username && documentName) {
        return {
          username: sanitizeWhitespace(username),
          documentName: sanitizeWhitespace(documentName),
          embedUrl: parsedUrl.toString(),
          documentUrl: `https://issuu.com/${encodeURIComponent(sanitizeWhitespace(username))}/docs/${encodeURIComponent(sanitizeWhitespace(documentName))}`,
        };
      }
    }

    const match = parsedUrl.pathname.match(/^\/([^/]+)\/docs\/([^/?#]+)/i);

    if (!match) {
      return null;
    }

    return {
      username: decodeURIComponent(match[1]),
      documentName: decodeURIComponent(match[2]),
      embedUrl: '',
      documentUrl: `https://issuu.com/${encodeURIComponent(decodeURIComponent(match[1]))}/docs/${encodeURIComponent(decodeURIComponent(match[2]))}`,
    };
  } catch (error) {
    return null;
  }
}

function extractIssuuDocumentsFromHtml(html, baseUrl = 'https://www.penny.at/') {
  const documents = [];
  const seen = new Set();

  const $ = cheerio.load(html);

  $('iframe[src], a[href]').each((index, element) => {
    const src = $(element).attr('src') || $(element).attr('href') || '';
    const absoluteUrl = toAbsoluteUrl(src, baseUrl);
    const document = extractIssuuDocumentFromUrl(absoluteUrl);

    if (document) {
      pushIssuuDocument(documents, seen, document.username, document.documentName, document.embedUrl || absoluteUrl);
    }
  });

  for (const match of String(html || '').matchAll(/https?:\/\/e\.issuu\.com\/embed\.html\?[^"'<>\\]+/gi)) {
    const document = extractIssuuDocumentFromUrl(match[0].replace(/&amp;/g, '&'));

    if (document) {
      pushIssuuDocument(documents, seen, document.username, document.documentName, document.embedUrl || match[0]);
    }
  }

  for (const match of String(html || '').matchAll(/https?:\/\/issuu\.com\/[^"'<>\\]+\/docs\/[^"'<>\\?#]+/gi)) {
    const document = extractIssuuDocumentFromUrl(match[0].replace(/&amp;/g, '&'));

    if (document) {
      pushIssuuDocument(documents, seen, document.username, document.documentName, document.embedUrl || match[0]);
    }
  }

  return documents;
}

async function fetchIssuuTrpcQuery(procedure, input) {
  const encodedInput = encodeURIComponent(JSON.stringify({ 0: { json: input } }));
  const url = `https://issuu.com/api/content-service/public.reader.${procedure}?batch=1&input=${encodedInput}`;
  const response = await axios.get(url, {
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      Accept: 'application/json',
      'x-trpc-source': 'nextjs-react',
    },
  });
  const first = Array.isArray(response.data) ? response.data[0] : null;
  const json = first?.result?.data?.json;

  if (!json) {
    throw new Error(`Issuu ${procedure} did not return a readable payload.`);
  }

  return json;
}

async function resolveIssuuOriginalPdfUrl(document) {
  const readerPayload = await fetchIssuuTrpcQuery('reader4', {
    username: document.username,
    docname: document.documentName,
  });
  const publicationId = readerPayload?.document?.publicationId;

  if (!publicationId) {
    throw new Error('Issuu reader payload did not include publicationId.');
  }

  const downloadPayload = await fetchIssuuTrpcQuery('download', { publicationId });

  if (!downloadPayload?.url) {
    throw new Error('Issuu download payload did not include a PDF URL.');
  }

  return {
    pdfUrl: downloadPayload.url,
    publicationId,
    revisionId: readerPayload?.document?.revisionId || '',
    pageCount: readerPayload?.document?.pages?.length || 0,
    title: readerPayload?.document?.title || document.documentName,
  };
}

module.exports = {
  extractIssuuDocumentFromUrl,
  extractIssuuDocumentsFromHtml,
  fetchIssuuTrpcQuery,
  resolveIssuuOriginalPdfUrl,
};
