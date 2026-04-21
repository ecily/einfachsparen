const { normalizeTitleForMatch, sanitizeWhitespace } = require('./sourceEvidence');

function buildHaystack({ title = '', contextText = '', sourceCategory = '', productGroups = [] }) {
  return normalizeTitleForMatch(
    [
      title,
      contextText,
      sourceCategory,
      ...(Array.isArray(productGroups) ? productGroups.map((group) => group?.title || '') : []),
    ].join(' ')
  );
}

function determineOfferCategory({ title = '', contextText = '', sourceCategory = '', productGroups = [] }) {
  const haystack = buildHaystack({ title, contextText, sourceCategory, productGroups });

  if (/(bier|wein|wasser|saft|cola|getrank|getraenk|schaumwein|spirituose|whisky|limonade|kaffee|tee|sirup|eistee|smoothie|energydrink|rose|rotwein|weisswein|aperitif|digestif|schnaps|gin|vodka|likor|sekt|prosecco|milchgetrank|joghurtgetrank)/.test(haystack)) {
    return 'Getraenke';
  }

  if (/(shampoo|dusch|zahnpasta|zahnburste|zahnbuerste|aufsteckburste|aufsteckbuerste|deo|deodorant|hygiene|drogerie|kosmetik|seife|windel|toilettenpapier|hygienepapier|einlagen|binden|gesichtspflege|hautpflege|make up|makeup|parfum)/.test(haystack)) {
    return 'Drogerie / Hygiene';
  }

  if (/(haushalt|reiniger|muellbeutel|geschirr|waschmittel|papier|kueche|kuche|haushalts|schwamm|folie|beutel|tabs|pads|spulmittel|spuelmittel|reinigungsgerate|reinigungsgeraete|tucher|tuecher|deko|aufbewahrung|wohnen|buero|buro)/.test(haystack)) {
    return 'Haushalt';
  }

  if (/(katzenfutter|hundefutter|tiernahrung|haustier|tierbedarf|katzenstreu|katzenpflege|hund|katze|nassfutter|trockenfutter)/.test(haystack)) {
    return 'Tierbedarf';
  }

  if (/(pflanze|blume|orchidee|blumenerde|hochbeeterde|erde|kompost|gartenpflanze|gartnern|gaertnern|topfpflanze|garten|samen)/.test(haystack)) {
    return 'Garten / Pflanzen';
  }

  if (/(damenbekleidung|herrenbekleidung|kinderbekleidung|bekleidung|mode|shirt|hose|jacke|socke|schuh|sandale|pyjama|pullover|kleid|leggings|unterwasche|unterwaesche|unterhemd|cardigan|mantel)/.test(haystack)) {
    return 'Kleidung / Mode';
  }

  if (/(werkzeug|akkuschrauber|bohrer|maschine|drucker|monitor|tablet|smartphone|kopfhorer|kopfhoerer|fernseher|tv|notebook|laptop|kamera|elektronik|technik|lampe|akku)/.test(haystack)) {
    return 'Technik / Elektronik';
  }

  if (/(spielzeug|fahrrad|autozubehor|autozubehoer|motoroel|reifen|sportartikel|camping|freizeit|party|schule|schreibwaren|basteln)/.test(haystack)) {
    return 'Freizeit / Sonstiges';
  }

  if (/(baby|kind|windeln|lernspiel|schulbedarf)/.test(haystack)) {
    return 'Baby / Kinder';
  }

  return 'Lebensmittel';
}

function determineOfferSubcategory({ primaryCategory = '', sourceCategory = '', fallbackLabel = '' }) {
  const sourceLabel = sanitizeWhitespace(sourceCategory);
  const fallback = sanitizeWhitespace(fallbackLabel);
  const primary = sanitizeWhitespace(primaryCategory);

  if (sourceLabel && sourceLabel.toLowerCase() !== primary.toLowerCase()) {
    return sourceLabel;
  }

  if (fallback && fallback.toLowerCase() !== primary.toLowerCase()) {
    return fallback;
  }

  return primary;
}

function buildInclusiveScopeDecision() {
  return {
    included: true,
    reason: '',
  };
}

module.exports = {
  determineOfferCategory,
  determineOfferSubcategory,
  buildInclusiveScopeDecision,
};
