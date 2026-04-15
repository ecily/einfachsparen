function sanitizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTitleForMatch(value) {
  return sanitizeWhitespace(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildSourceEvidence({
  source,
  observedUrl,
  matchType = 'primary',
  observedAt = new Date(),
}) {
  return {
    sourceId: source?._id || null,
    channel: source?.channel || '',
    sourceUrl: source?.sourceUrl || '',
    label: source?.label || '',
    observedUrl: observedUrl || source?.sourceUrl || '',
    matchType,
    observedAt,
  };
}

function dedupeSourceEvidence(items = []) {
  const seen = new Set();
  const unique = [];

  for (const item of items) {
    const key = [
      String(item?.sourceId || ''),
      String(item?.channel || ''),
      String(item?.sourceUrl || ''),
      String(item?.observedUrl || ''),
      String(item?.matchType || ''),
    ].join('::');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(item);
  }

  return unique;
}

module.exports = {
  sanitizeWhitespace,
  normalizeTitleForMatch,
  buildSourceEvidence,
  dedupeSourceEvidence,
};
