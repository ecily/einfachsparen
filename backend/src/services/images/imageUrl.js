function sanitizeImageText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseSrcsetCandidates(value) {
  return sanitizeImageText(value)
    .split(',')
    .map((part) => sanitizeImageText(part).split(/\s+/)[0])
    .filter(Boolean);
}

function isUsableImageUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch (error) {
    return false;
  }
}

function normalizeImageUrl(rawUrl, sourceUrl = '') {
  const candidates = [
    ...parseSrcsetCandidates(rawUrl),
    sanitizeImageText(rawUrl),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = sourceUrl ? new URL(candidate, sourceUrl) : new URL(candidate);

      if (['http:', 'https:'].includes(parsed.protocol)) {
        return parsed.toString();
      }
    } catch (error) {
      // Try the next candidate.
    }
  }

  return '';
}

function buildImageRequestHeaders({ referer = '' } = {}) {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    ...(referer ? { Referer: referer } : {}),
  };
}

module.exports = {
  buildImageRequestHeaders,
  isUsableImageUrl,
  normalizeImageUrl,
  parseSrcsetCandidates,
};
