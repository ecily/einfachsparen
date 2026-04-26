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
        const items = value
          .map((item) => {
            if (typeof item === 'string') {
              return truncateText(item, 120);
            }

            if (item && typeof item === 'object') {
              return Object.fromEntries(
                Object.entries(item)
                  .filter(([, nestedValue]) => ['string', 'number', 'boolean'].includes(typeof nestedValue) || nestedValue === null)
                  .map(([nestedKey, nestedValue]) => [
                    nestedKey,
                    typeof nestedValue === 'string' ? truncateText(nestedValue, 120) : nestedValue,
                  ])
              );
            }

            return null;
          })
          .filter(Boolean)
          .slice(0, 5);

        return items.length > 0 ? [key, items] : null;
      }

      if (value && typeof value === 'object') {
        const nested = Object.fromEntries(
          Object.entries(value)
            .filter(([, nestedValue]) => ['string', 'number', 'boolean'].includes(typeof nestedValue) || nestedValue === null)
            .map(([nestedKey, nestedValue]) => [
              nestedKey,
              typeof nestedValue === 'string' ? truncateText(nestedValue, 120) : nestedValue,
            ])
        );

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
  clearRawDocumentsForSource,
  createCompactRawDocument,
};
