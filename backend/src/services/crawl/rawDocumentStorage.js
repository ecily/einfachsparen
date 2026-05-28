const RawDocument = require('../../models/RawDocument');

function truncateText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function compactPreview(values, limit = 5, maxLength = 80) {
  return (Array.isArray(values) ? values : [])
    .map((value) => truncateText(value, maxLength))
    .filter(Boolean)
    .slice(0, limit);
}

function compactNestedObject(value, maxStringLength = 120) {
  return Object.fromEntries(
    Object.entries(value)
      .map(([nestedKey, nestedValue]) => {
        if (typeof nestedValue === 'string') {
          return [nestedKey, truncateText(nestedValue, maxStringLength)];
        }

        if (typeof nestedValue === 'number' || typeof nestedValue === 'boolean' || nestedValue === null) {
          return [nestedKey, nestedValue];
        }

        if (Array.isArray(nestedValue)) {
          const items = nestedValue
            .map((item) => (typeof item === 'string' ? truncateText(item, 60) : null))
            .filter(Boolean)
            .slice(0, 8);

          return items.length > 0 ? [nestedKey, items] : null;
        }

        return null;
      })
      .filter(Boolean)
  );
}

function compactPayload(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }

  const compactEntries = Object.entries(payload)
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return [key, truncateText(value, 240)];
      }

      if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
        return [key, value];
      }

      if (value instanceof Date) {
        return [key, value];
      }

      if (Array.isArray(value)) {
        const itemLimit = key === 'rejectedCandidateSamples' ? 18 : 5;
        const nestedStringLimit = key === 'rejectedCandidateSamples' ? 220 : 120;
        const items = value
          .map((item) => {
            if (typeof item === 'string') {
              return truncateText(item, 120);
            }

            if (item && typeof item === 'object') {
              return compactNestedObject(item, nestedStringLimit);
            }

            return null;
          })
          .filter(Boolean)
          .slice(0, itemLimit);

        return items.length > 0 ? [key, items] : null;
      }

      if (value && typeof value === 'object') {
        const nested = compactNestedObject(value);

        return Object.keys(nested).length > 0 ? [key, nested] : null;
      }

      return null;
    })
    .filter(Boolean);

  return Object.fromEntries(compactEntries);
}

async function clearRawDocumentsForSource(sourceId) {
  await RawDocument.deleteMany({ sourceId });
}

async function createCompactRawDocument({
  sourceId,
  crawlJobId,
  retailerKey,
  region,
  documentType,
  sourceType = '',
  url,
  canonicalUrl,
  finalUrl = '',
  title,
  httpStatus = null,
  contentType = '',
  downloadBytes = 0,
  contentHash,
  contentSnippet = '',
  extractedPreview = [],
  foundRawItems = 0,
  parsedOffers = 0,
  rejectedOffers = 0,
  parserVersion = '',
  extractionConfidence = 0,
  rejectionReasons = [],
  payload = {},
}) {
  return RawDocument.create({
    sourceId,
    crawlJobId,
    retailerKey,
    region,
    documentType,
    sourceType,
    url,
    canonicalUrl,
    finalUrl,
    title: truncateText(title, 180),
    httpStatus,
    contentType,
    downloadBytes,
    contentHash,
    contentSnippet: truncateText(contentSnippet, 220),
    extractedPreview: compactPreview(extractedPreview),
    foundRawItems,
    parsedOffers,
    rejectedOffers,
    parserVersion,
    extractionConfidence,
    rejectionReasons: (Array.isArray(rejectionReasons) ? rejectionReasons : [])
      .filter((item) => item?.reason && Number(item?.count || 0) > 0)
      .map((item) => ({
        reason: truncateText(item.reason, 80),
        count: Number(item.count || 0),
      })),
    payload: compactPayload(payload),
  });
}

module.exports = {
  _private: {
    compactPayload,
  },
  clearRawDocumentsForSource,
  createCompactRawDocument,
};
