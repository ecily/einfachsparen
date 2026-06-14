const AUSTRIAN_WEEKDAY_PATTERN = '(?:mo\\.?|montag|di\\.?|dienstag|mi\\.?|mittwoch|do\\.?|donnerstag|fr\\.?|freitag|sa\\.?|samstag|so\\.?|sonntag)';

function normalizeForValidity(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00df/g, 'ss')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function dateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function lastSunday(year, monthIndex) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.getUTCDate();
}

function viennaOffsetHours(year, month, day) {
  if (month < 3 || month > 10) return 1;
  if (month > 3 && month < 10) return 2;

  if (month === 3) {
    return day >= lastSunday(year, 2) ? 2 : 1;
  }

  return day < lastSunday(year, 9) ? 2 : 1;
}

function buildViennaDate(day, month, year, { endOfDay = false } = {}) {
  const numericDay = Number(day);
  const numericMonth = Number(month);
  const numericYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);

  if (
    !Number.isInteger(numericDay) ||
    !Number.isInteger(numericMonth) ||
    !Number.isInteger(numericYear) ||
    numericDay < 1 ||
    numericDay > 31 ||
    numericMonth < 1 ||
    numericMonth > 12 ||
    numericYear < 2000
  ) {
    return null;
  }

  const offset = viennaOffsetHours(numericYear, numericMonth, numericDay);
  const hour = endOfDay ? 23 : 0;
  const minute = endOfDay ? 59 : 0;
  const second = endOfDay ? 59 : 0;
  const millisecond = endOfDay ? 999 : 0;
  const date = new Date(Date.UTC(
    numericYear,
    numericMonth - 1,
    numericDay,
    hour - offset,
    minute,
    second,
    millisecond
  ));

  return Number.isNaN(date.getTime()) ? null : date;
}

function inferRangeYears(start, end, contextYear) {
  const endYear = end.year || start.year || contextYear || new Date().getUTCFullYear();
  let startYear = start.year || endYear;

  let validFrom = buildViennaDate(start.day, start.month, startYear);
  let validTo = buildViennaDate(end.day, end.month, endYear, { endOfDay: true });

  if (validFrom && validTo && validFrom > validTo && !start.year && end.year) {
    startYear -= 1;
    validFrom = buildViennaDate(start.day, start.month, startYear);
  } else if (validFrom && validTo && validFrom > validTo && start.year && !end.year) {
    validTo = buildViennaDate(end.day, end.month, startYear + 1, { endOfDay: true });
  } else if (validFrom && validTo && validFrom > validTo && !start.year && !end.year) {
    validTo = buildViennaDate(end.day, end.month, startYear + 1, { endOfDay: true });
  }

  if (!validFrom || !validTo || validFrom > validTo) {
    return { validFrom: null, validTo: null };
  }

  return { validFrom, validTo };
}

function isUnsafeFlyerValidityContext(text = '') {
  const normalized = normalizeForValidity(text).toLowerCase();

  return Boolean(
    /\b(?:gewinnspiel|druckschluss|impressum|feiertag|filialtermin|event|coupon|joker)\b/.test(normalized) ||
    /\b(?:zusatzlich|zusaetzlich|nur)\b.{0,40}\b(?:fr|freitag|sa|samstag)\b/.test(normalized) ||
    /\b(?:am|nur)\s+(?:mo|di|mi|do|fr|sa|so)\.?\s*,?\s*\d{1,2}\./.test(normalized)
  );
}

function buildRangePatterns() {
  const weekday = `${AUSTRIAN_WEEKDAY_PATTERN}[,\\s]*`;
  const date = `(\\d{1,2})\\.\\s*(\\d{1,2})\\.(?:\\s*(\\d{2,4}))?`;

  return [
    new RegExp(`\\bangebote?\\s+(?:gueltig|gultig)\\s+(?:von|ab)?\\s*(?:${weekday})?${date}\\s*(?:bis|-)\\s*(?:${weekday})?${date}`, 'i'),
    new RegExp(`\\b(?:gueltig|gultig)\\s+(?:von|ab)\\s*(?:${weekday})?${date}\\s*(?:bis|-)\\s*(?:${weekday})?${date}`, 'i'),
    new RegExp(`^\\s*von\\s+(?:${weekday})?${date}\\s*bis\\s*(?:${weekday})?${date}`, 'i'),
    new RegExp(`^\\s*(?:${weekday})${date}\\s*-\\s*(?:${weekday})${date}\\s*$`, 'i'),
  ];
}

function parseRangeMatch(match, contextYear) {
  const start = {
    day: Number(match[1]),
    month: Number(match[2]),
    year: match[3] ? Number(match[3]) : null,
  };
  const end = {
    day: Number(match[4]),
    month: Number(match[5]),
    year: match[6] ? Number(match[6]) : null,
  };
  const range = inferRangeYears(start, end, contextYear);

  if (!range.validFrom || !range.validTo) {
    return null;
  }

  return {
    ...range,
    validityText: compactWhitespace(match[0]),
    validitySource: 'official-pdf-page-1',
    validityConfidence: 0.92,
    detectedDates: [dateKey(range.validFrom), dateKey(range.validTo)].filter(Boolean),
  };
}

function parseUntilMatch(text, contextYear) {
  const normalized = normalizeForValidity(text);
  const weekday = `${AUSTRIAN_WEEKDAY_PATTERN}[,\\s]*`;
  const until = normalized.match(new RegExp(`\\b(?:angebote?\\s+)?(?:gueltig|gultig)\\s+bis\\s+(?:${weekday})?(\\d{1,2})\\.\\s*(\\d{1,2})\\.(?:\\s*(\\d{2,4}))?`, 'i'));

  if (!until || isUnsafeFlyerValidityContext(normalized)) {
    return null;
  }

  const year = until[3] ? Number(until[3]) : (contextYear || new Date().getUTCFullYear());
  const validTo = buildViennaDate(until[1], until[2], year, { endOfDay: true });

  if (!validTo) {
    return null;
  }

  return {
    validFrom: null,
    validTo,
    validityText: compactWhitespace(until[0]),
    validitySource: 'official-pdf-page-1',
    validityConfidence: 0.78,
    detectedDates: [dateKey(validTo)],
  };
}

function extractOfficialFlyerValidityFromText(text = '', { contextYear } = {}) {
  const rawLines = String(text || '')
    .split(/\r?\n/)
    .map((line) => normalizeForValidity(line))
    .filter(Boolean);
  const normalized = normalizeForValidity(text);
  const splitLines = normalized
    .split(/\r?\n|(?<=\.)\s+(?=angebote?\s+gueltig|angebote?\s+gultig|gueltig\s+(?:von|bis)|gultig\s+(?:von|bis)|von\s+(?:mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag))/i)
    .map(compactWhitespace)
    .filter(Boolean);
  const lines = [...new Set([...rawLines, ...splitLines])];
  const candidates = lines.length ? lines : [normalized];
  const patterns = buildRangePatterns();

  for (const line of candidates) {
    if (isUnsafeFlyerValidityContext(line)) continue;

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;

      const parsed = parseRangeMatch(match, contextYear);
      if (parsed) return parsed;
    }
  }

  for (const line of candidates) {
    const parsed = parseUntilMatch(line, contextYear);
    if (parsed) return parsed;
  }

  return {
    validFrom: null,
    validTo: null,
    validityText: '',
    validitySource: '',
    validityConfidence: 0,
    detectedDates: [],
  };
}

function extractOfficialFlyerValidityFromPages(pages = [], options = {}) {
  const firstPage = Array.isArray(pages) ? pages[0] : null;
  return extractOfficialFlyerValidityFromText(firstPage?.text || '', options);
}

module.exports = {
  buildViennaDate,
  dateKey,
  extractOfficialFlyerValidityFromPages,
  extractOfficialFlyerValidityFromText,
  normalizeForValidity,
};
