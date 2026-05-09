const axios = require('axios');
const cheerio = require('cheerio');
const { PDFParse } = require('pdf-parse');
const { sanitizeWhitespace, normalizeTitleForMatch } = require('../crawl/sourceEvidence');

const DEFAULT_TIMEOUT_MS = 45000;
const MAX_DOWNLOAD_BYTES = 40 * 1024 * 1024;

const DEFAULT_CANDIDATE_SOURCES = [
  {
    key: 'spar-official-actions-html',
    url: 'https://www.spar.at/aktionen',
    expectedMode: 'html',
  },
  {
    key: 'spar-official-steiermark-actions-html',
    url: 'https://www.spar.at/aktionen/steiermark',
    expectedMode: 'html',
  },
  {
    key: 'spar-steiermark-kw19-pdf',
    url: 'https://flugblatt.spar.at/steiermark/spar/260507-1-flugblatt-kw-19/getPdf.ashx',
    expectedMode: 'pdf',
  },
  {
    key: 'interspar-steiermark-kw19-pdf',
    url: 'https://flugblatt.interspar.at/steiermark/steiermark_kw19/getPdf.ashx',
    expectedMode: 'pdf',
  },
  {
    key: 'interspar-gutscheinheft-kw19-pdf',
    url: 'https://flugblatt.interspar.at/sonderfolder/gutscheinheft_kw19/getPdf.ashx',
    expectedMode: 'pdf',
  },
  {
    key: 'aktionsfinder-spar-html',
    url: 'https://www.aktionsfinder.at/pv/spar/',
    expectedMode: 'html',
  },
  {
    key: 'marketguru-spar-html',
    url: 'https://www.marktguru.at/r/spar',
    expectedMode: 'html',
  },
];

const EVIDENCE_TERMS = [
  'REGIO',
  'Regio Gold',
  'Tassimo',
  'Nescafe',
  'Nescafé',
  'Cafe Royal',
  'Café Royal',
  'Meinl',
  'Präsident',
  'Praesident',
  'Dallmayr',
  'Prodomo',
  'Kaffee',
  'Kapseln',
  'Löskaffee',
  'Loeskaffee',
  '500 g',
  '200 g',
  '-25 %',
  '25%',
];

function normalizeEvidenceText(value) {
  return normalizeTitleForMatch(value)
    .replace(/\bprozent\b/g, 'percent')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEvidenceTerm(term) {
  const normalized = normalizeEvidenceText(term);

  if (normalized === '25') {
    return '25';
  }

  return normalized;
}

function countOccurrences(haystack, needle) {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let index = haystack.indexOf(needle);

  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }

  return count;
}

function findEvidenceHits(text, terms = EVIDENCE_TERMS) {
  const normalizedText = normalizeEvidenceText(text);
  const compactText = normalizedText.replace(/\s+/g, '');
  const seen = new Set();
  const hits = [];

  for (const term of terms) {
    const normalizedTerm = normalizeEvidenceTerm(term);
    const compactTerm = normalizedTerm.replace(/\s+/g, '');
    const count = countOccurrences(normalizedText, normalizedTerm)
      || countOccurrences(compactText, compactTerm);

    if (count <= 0 || seen.has(normalizedTerm)) {
      continue;
    }

    seen.add(normalizedTerm);
    hits.push({
      term,
      normalized: normalizedTerm,
      count,
    });
  }

  return hits;
}

function extractHtmlText(html) {
  const $ = cheerio.load(String(html || ''));
  $('script, style, noscript, svg').remove();
  return sanitizeWhitespace($('body').text() || $.root().text());
}

async function extractPdfTextFromBuffer(buffer) {
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy();
  }
}

function isPdfCandidate(candidate, contentType = '') {
  return candidate.expectedMode === 'pdf'
    || /\bpdf\b/i.test(contentType)
    || /\.(pdf)(\?|$)/i.test(candidate.url)
    || /\/(?:get|view)?pdf\.ashx/i.test(candidate.url);
}

function isBlockedStatus(status) {
  return [401, 403, 407, 429].includes(Number(status));
}

function buildBaseResult(candidate, fetched = {}) {
  return {
    key: candidate.key,
    url: candidate.url,
    status: fetched.status || null,
    contentType: fetched.contentType || '',
    finalUrl: fetched.finalUrl || candidate.url,
    size: fetched.size || 0,
    accessible: false,
    extractionMode: 'unavailable',
    evidenceHits: [],
  };
}

async function evaluateCandidateSource({
  candidate,
  fetched,
  extractPdfText = extractPdfTextFromBuffer,
} = {}) {
  const result = buildBaseResult(candidate, fetched);
  const status = Number(fetched?.status || 0);

  if (!candidate?.url) {
    return {
      ...result,
      extractionMode: 'failed',
      reasonIfRejected: 'candidate-url-missing',
    };
  }

  if (fetched?.error) {
    return {
      ...result,
      extractionMode: 'failed',
      reasonIfRejected: fetched.error,
    };
  }

  if (isBlockedStatus(status)) {
    return {
      ...result,
      extractionMode: 'blocked',
      reasonIfRejected: `HTTP ${status}`,
    };
  }

  if (status < 200 || status >= 300) {
    return {
      ...result,
      extractionMode: 'failed',
      reasonIfRejected: status ? `HTTP ${status}` : 'http-status-missing',
    };
  }

  result.accessible = true;

  const contentType = String(fetched.contentType || '');

  if (isPdfCandidate(candidate, contentType)) {
    if (!extractPdfText) {
      return {
        ...result,
        extractionMode: 'unavailable',
        reasonIfRejected: 'PDF text extraction unavailable',
      };
    }

    try {
      const text = fetched.text !== undefined
        ? String(fetched.text || '')
        : await extractPdfText(fetched.buffer);

      result.extractionMode = 'pdf-text';
      result.evidenceHits = findEvidenceHits(text);
      result.textSample = sanitizeWhitespace(text).slice(0, 500);

      if (result.evidenceHits.length === 0) {
        result.reasonIfRejected = 'no-coffee-evidence-found-in-pdf-text';
      }

      return result;
    } catch (error) {
      return {
        ...result,
        extractionMode: 'failed',
        reasonIfRejected: `PDF text extraction failed: ${error.message}`,
      };
    }
  }

  if (/html|xml|json|text/i.test(contentType) || candidate.expectedMode === 'html') {
    const body = Buffer.isBuffer(fetched.buffer)
      ? fetched.buffer.toString('utf8')
      : String(fetched.text || '');
    const text = /html|xml/i.test(contentType) || /<html[\s>]/i.test(body)
      ? extractHtmlText(body)
      : sanitizeWhitespace(body);

    result.extractionMode = 'html-text';
    result.evidenceHits = findEvidenceHits(text);
    result.textSample = text.slice(0, 500);

    if (result.evidenceHits.length === 0) {
      result.reasonIfRejected = 'no-coffee-evidence-found-in-html-text';
    }

    return result;
  }

  return {
    ...result,
    extractionMode: 'unavailable',
    reasonIfRejected: `unsupported-content-type: ${contentType || 'unknown'}`,
  };
}

async function fetchCandidateSource(candidate, httpClient = axios) {
  try {
    const response = await httpClient.get(candidate.url, {
      timeout: DEFAULT_TIMEOUT_MS,
      responseType: 'arraybuffer',
      maxContentLength: MAX_DOWNLOAD_BYTES,
      maxBodyLength: MAX_DOWNLOAD_BYTES,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        Accept: candidate.expectedMode === 'pdf'
          ? 'application/pdf,text/html,*/*'
          : 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
      },
    });
    const buffer = Buffer.from(response.data || '');

    return {
      status: response.status,
      contentType: response.headers?.['content-type'] || '',
      finalUrl: response.request?.res?.responseUrl || candidate.url,
      size: buffer.length,
      buffer,
    };
  } catch (error) {
    return {
      status: error.response?.status || null,
      contentType: error.response?.headers?.['content-type'] || '',
      finalUrl: error.request?.res?.responseUrl || candidate.url,
      size: error.response?.data?.length || 0,
      error: error.message,
      buffer: Buffer.from(error.response?.data || ''),
    };
  }
}

function buildSummary(candidateSources) {
  const usableCandidates = candidateSources.filter((candidate) =>
    candidate.accessible && ['html-text', 'pdf-text'].includes(candidate.extractionMode)
  );
  const candidatesWithCoffeeEvidence = candidateSources.filter((candidate) => candidate.evidenceHits.length > 0);
  const strongPdfEvidence = candidatesWithCoffeeEvidence.find((candidate) => candidate.extractionMode === 'pdf-text');

  let likelyNextStep = 'No publicly accessible SPAR flyer source with coffee evidence was found; keep SPAR official source disabled and do not add a productive crawler from this diagnostic.';

  if (strongPdfEvidence) {
    likelyNextStep = `Small safe next step: prototype a separate read-only PDF text-layer parser for ${strongPdfEvidence.key}, then compare raw evidence against DB/cache/API before any productive ingestion.`;
  } else if (candidatesWithCoffeeEvidence.length > 0) {
    likelyNextStep = `Small safe next step: inspect ${candidatesWithCoffeeEvidence[0].key} as evidence-only input before considering any productive ingestion.`;
  } else if (usableCandidates.length > 0) {
    likelyNextStep = 'Sources are reachable, but no requested SPAR coffee evidence was found; do not build ingestion from these candidates yet.';
  }

  return {
    usableCandidatesCount: usableCandidates.length,
    candidatesWithCoffeeEvidence: candidatesWithCoffeeEvidence.map((candidate) => candidate.key),
    likelyNextStep,
  };
}

async function buildSparFlyerSourceDiagnostic({
  candidates = DEFAULT_CANDIDATE_SOURCES,
  now = new Date(),
  fetchSource = fetchCandidateSource,
  extractPdfText = extractPdfTextFromBuffer,
} = {}) {
  const candidateSources = [];

  for (const candidate of candidates) {
    const fetched = await fetchSource(candidate);
    const evaluated = await evaluateCandidateSource({
      candidate,
      fetched,
      extractPdfText,
    });

    candidateSources.push(evaluated);
  }

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    checkedAt: now instanceof Date ? now.toISOString() : now,
    evidenceTerms: EVIDENCE_TERMS,
    candidateSources,
    summary: buildSummary(candidateSources),
    caveat: 'This diagnostic does not create offers, mutate MongoDB, run a productive crawl, rebuild cache/filter metadata, or prove productive data-quality improvement.',
  };
}

module.exports = {
  DEFAULT_CANDIDATE_SOURCES,
  EVIDENCE_TERMS,
  normalizeEvidenceText,
  findEvidenceHits,
  extractHtmlText,
  extractPdfTextFromBuffer,
  evaluateCandidateSource,
  fetchCandidateSource,
  buildSummary,
  buildSparFlyerSourceDiagnostic,
};
