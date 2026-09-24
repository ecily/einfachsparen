// Shared by PDF ingestion and the public boundary, including legacy documents.
const PENNY_PDF_VALIDITY_SOURCE = 'penny-pdf-explicit-period-v2';
const WEEKDAY = '(?:mo|di|mi|do|fr|sa|so)';
const RANGE = `${WEEKDAY}?\\s*(\\d{1,2})\\.(\\d{1,2})\\.(20\\d{2})?\\s*(?:bis|und|[-–])\\s*${WEEKDAY}?\\s*(\\d{1,2})\\.(\\d{1,2})\\.(20\\d{2})?`;

function calendarDate(day, month, year) {
  if (![day, month, year].every(Number.isInteger) || year < 2000 || year > 2099) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date : null;
}

function dateOnly(value) {
  if (!value) return null;
  const text = value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : String(value);
  const match = text.match(/^(20\d{2})-(\d{2})-(\d{2})(?:T|$)/);
  return match ? calendarDate(Number(match[3]), Number(match[2]), Number(match[1])) : null;
}

function validPeriod(period) {
  const validFrom = dateOnly(period?.validFrom);
  const validTo = dateOnly(period?.validTo);
  return validFrom && validTo && validFrom <= validTo ? { validFrom, validTo } : null;
}

function containsPeriod(campaign, offer) {
  const outer = validPeriod(campaign);
  const inner = validPeriod(offer);
  return Boolean(outer && inner && inner.validFrom >= outer.validFrom && inner.validTo <= outer.validTo);
}

function parseRange(match, contextYear) {
  const [, fromDay, fromMonth, fromYear, toDay, toMonth, toYear] = match;
  if (!fromYear && !toYear && !contextYear) return null;
  let startYear = Number(fromYear || toYear || contextYear);
  let endYear = Number(toYear || fromYear || contextYear);
  if (Number(fromMonth) > Number(toMonth)) {
    if (!fromYear && toYear) startYear -= 1;
    else if (fromYear && !toYear) endYear += 1;
  }
  return validPeriod({
    validFrom: calendarDate(Number(fromDay), Number(fromMonth), startYear),
    validTo: calendarDate(Number(toDay), Number(toMonth), endYear),
  });
}

function explicitPeriods(text, contextYear, allowWeekdayRange = false) {
  const label = '(?:g[üu]ltig|gueltig)\\s+(?:von|vom)\\s+';
  const prefix = allowWeekdayRange ? `(?:${label}|(?=\\b${WEEKDAY}\\s+\\d))` : label;
  const pattern = new RegExp(`${prefix}(${RANGE})(?!\\d)`, 'gi');
  return [...String(text || '').matchAll(pattern)].map((match) => ({
    ...parseRange([match[1], ...match.slice(2)], contextYear),
    evidenceText: match[0],
  }));
}

function periodFromOfficialUrl(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    if (!((url.hostname === 'issuu.com' && url.pathname.startsWith('/pennyat/docs/'))
      || /^(?:www\.)?penny\.at$/.test(url.hostname))) return null;
    const text = decodeURIComponent(url.pathname).replace(/_/g, ' ');
    const matches = [...text.matchAll(new RegExp(`(?<![\\d.])${RANGE}(?!\\d)`, 'gi'))];
    return matches.length === 1 ? parseRange(matches[0]) : null;
  } catch {
    return null;
  }
}

function derivePennyLeafletValidity(pages, sourceUrl = '') {
  const urlPeriod = periodFromOfficialUrl(sourceUrl);
  const coverPeriods = explicitPeriods(pages[0]?.text);
  const periods = coverPeriods.length ? coverPeriods : explicitPeriods(pages.map((page) => page.text).join('\n'));
  if (periods.some((period) => !validPeriod(period))) return null;
  if (urlPeriod && periods.some((period) => !containsPeriod(urlPeriod, period))) return null;
  const unique = new Map(periods.map((period) => [`${period.validFrom.toISOString()}/${period.validTo.toISOString()}`, period]));
  // A URL can corroborate a printed window, never widen it. Multiple printed
  // windows without a unique leaflet period are ambiguous rather than an envelope.
  const period = unique.size === 1 ? [...unique.values()][0] : (periods.length === 0 ? urlPeriod : null);
  if (!period) return null;
  return {
    ...period,
    evidenceType: PENNY_PDF_VALIDITY_SOURCE,
    detectedDates: [period.validFrom, period.validTo].map((date) => date.toISOString().slice(0, 10)),
  };
}

function pennyPdfPeriodIsConsistent(offer) {
  const sourceType = offer.sourceType || offer.rawFacts?.sourceType;
  if (sourceType !== 'penny-official-pdf') return true;
  const urlPeriod = periodFromOfficialUrl(offer.sourceUrl);
  const recordedPeriod = offer.rawFacts?.validitySource === PENNY_PDF_VALIDITY_SOURCE
    ? validPeriod({ validFrom: offer.rawFacts.validFrom, validTo: offer.rawFacts.validTo }) : null;
  if (urlPeriod && recordedPeriod && !containsPeriod(urlPeriod, recordedPeriod)) return false;
  const campaign = urlPeriod || recordedPeriod;
  return Boolean(campaign && containsPeriod(campaign, offer)
    && (!recordedPeriod || containsPeriod(recordedPeriod, offer)));
}

module.exports = {
  PENNY_PDF_VALIDITY_SOURCE,
  calendarDate,
  validPeriod,
  containsPeriod,
  explicitPeriods,
  periodFromOfficialUrl,
  derivePennyLeafletValidity,
  pennyPdfPeriodIsConsistent,
};
