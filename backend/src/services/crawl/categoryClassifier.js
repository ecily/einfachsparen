const { normalizeTitleForMatch, sanitizeWhitespace } = require('./sourceEvidence');

const CATEGORY_TAXONOMY = [
  {
    main: 'Lebensmittel',
    patterns: [/(lebensmittel|essen|nahrung|bio|genuss)/],
    subcategories: [
      { label: 'Obst & Gemuese', patterns: [/(obst|gemuse|gemuese|salat|kartoffel|zwiebel|tomate|apfel|banane|zitrone|beere)/] },
      { label: 'Brot & Gebaeck', patterns: [/(brot|gebaeck|geback|backwaren|semmel|weckerl|croissant|toast)/] },
      { label: 'Fleisch, Wurst & Fisch', patterns: [/(fleisch|wurst|schinken|salami|speck|fisch|lachs|thunfisch|geflugel|gefluegel|huhn|rind|schwein)/] },
      { label: 'Milchprodukte', patterns: [/(milch|butter|joghurt|topfen|sahne|rahm|quark)/] },
      { label: 'Kaese', patterns: [/(kase|kaese|mozzarella|emmentaler|gouda|camembert|parmesan)/] },
      { label: 'Tiefkuehl- & Fertigprodukte', patterns: [/(tiefkuhl|tiefkuehl|pizza|fertig|mikrowelle|tk|frost|lasagne|pommes)/] },
      { label: 'Suesswaren & Knabbereien', patterns: [/(schokolade|susswaren|suesswaren|knabberei|chips|kekse|bonbon|praline|snack|nusse|nuesse)/] },
      { label: 'Pasta, Reis & Konserven', patterns: [/(nudel|pasta|reis|konserve|dose|dosen|bohnen|linsen|kichererbse|passata)/] },
      { label: 'Saucen, Oele & Gewuerze', patterns: [/(sauce|oel|ol|gewurz|gewuerz|essig|ketchup|mayonnaise|senf)/] },
      { label: 'Fruehstueck & Aufstriche', patterns: [/(marmelade|honig|musli|muesli|cornflakes|aufstrich|nougatcreme|brotaufstrich)/] },
    ],
  },
  {
    main: 'Getraenke',
    patterns: [/(getrank|getraenk|trinken|durst)/],
    subcategories: [
      { label: 'Wasser', patterns: [/(wasser|mineralwasser|sprudel)/] },
      { label: 'Softdrinks & Energy', patterns: [/(cola|limonade|softdrink|energy|energydrink|eistee|iso|getrank|getraenk)/] },
      { label: 'Saefte & Sirupe', patterns: [/(saft|nektar|sirup|smoothie)/] },
      { label: 'Bier', patterns: [/(bier|pils|weizen|radler)/] },
      { label: 'Wein & Sekt', patterns: [/(wein|rotwein|weisswein|rose|sekt|prosecco|champagner)/] },
      { label: 'Spirituosen', patterns: [/(whisky|rum|gin|vodka|likor|likoer|spirituose|schnaps)/] },
      { label: 'Kaffee & Tee', patterns: [/(kaffee|espresso|cappuccino|tee|matcha)/] },
      { label: 'Milchgetraenke', patterns: [/(kakao|milchdrink|milchgetrank|joghurtdrink|proteindrink)/] },
    ],
  },
  {
    main: 'Drogerie / Hygiene',
    patterns: [/(drogerie|hygiene|pflege|kosmetik|beauty)/],
    subcategories: [
      { label: 'Haarpflege', patterns: [/(shampoo|spulung|spuelung|haar|haarkur|styling)/] },
      { label: 'Koerperpflege', patterns: [/(dusch|deo|deodorant|bodylotion|seife|creme|pflege|lotion|balsam)/] },
      { label: 'Mund- & Zahnpflege', patterns: [/(zahnpasta|zahnburste|zahnbuerste|mundspulung|mundspuelung|zahn)/] },
      { label: 'Rasur', patterns: [/(rasierer|rasur|klinge|aftershave)/] },
      { label: 'Kosmetik & Make-up', patterns: [/(kosmetik|make up|makeup|mascara|lippenstift|foundation|parfum)/] },
      { label: 'Damenhygiene', patterns: [/(binden|tampon|slipeinlage|einlagen|damenhygiene)/] },
      { label: 'Babyhygiene', patterns: [/(windel|feuchttucher|feuchttuecher|babycreme|babyshampoo)/] },
      { label: 'Haushaltspapier', patterns: [/(toilettenpapier|kuchenrolle|kuechenrolle|taschentucher|taschentuecher|haushaltspapier)/] },
      { label: 'Gesundheit & Nahrungsergaenzung', patterns: [/(vitamin|magnesium|omega|zink|nahrungserganzung|nahrungsergaenzung|kapsel|kapseln|tablette|tabletten|pastille|pastillen|supplement)/] },
    ],
  },
  {
    main: 'Haushalt',
    patterns: [/(haushalt|wohnen|reinigen|putzen)/],
    subcategories: [
      { label: 'Waschmittel & Reiniger', patterns: [/(waschmittel|weichspuler|weichspueler|reiniger|putzmittel|spulmittel|spuelmittel|entkalker|geschirrspul|spueltabs|spultabs|spuelmaschinentabs|spulmaschinentabs|waschcaps|tabs)/] },
      { label: 'Kuechenhelfer', patterns: [/(geschirr|pfanne|topf|besteck|messer|kochen|kueche|kuche)/] },
      { label: 'Aufbewahrung & Folien', patterns: [/(folie|frischhalte|alu|beutel|aufbewahrung|dose|box)/] },
      { label: 'Deko & Wohnen', patterns: [/(deko|kerze|vase|kissen|wohnen)/] },
      { label: 'Papier & Buero', patterns: [/(papier|buero|buro|ordner|heft|stift|druckerpapier)/] },
    ],
  },
  {
    main: 'Buero / Schule',
    patterns: [/(buero|buro|schule|schreibwaren|ordnen|etikett|drucker|scanner|papierwaren|kreativ|basteln)/],
    subcategories: [
      { label: 'Schreibwaren', patterns: [/(schreibwaren|stift|kugelschreiber|filzstift|marker|textmarker|bleistift|fineliner|heft|collegeblock|notizbuch|radierer|spitzer)/] },
      { label: 'Papier & Ordnen', patterns: [/(papier|briefkorb|stehsammler|ordner|register|mappe|formular|geschaftsbuch|geschaeftsbuch|etikett|fotopapier|kuvert)/] },
      { label: 'Drucker & Scanner', patterns: [/(drucker|scanner|toner|tinte|patrone|speichermedien|speicherkarte|festplatte|usb|pc zubehor|pc zubehoer|computerzubehor|computerzubehoer)/] },
      { label: 'Schule & Lernen', patterns: [/(schule|schultasche|rucksack|federschachtel|lineal|zirkel|geodreieck|lernen)/] },
      { label: 'Basteln & Kreativ', patterns: [/(basteln|kreativ|farben|pinsel|kleber|schere|buntpapier|malblock|knete|glitzer|sticker|party)/] },
    ],
  },
  {
    main: 'Tierbedarf',
    patterns: [/(tier|haustier|hund|katze|tierbedarf)/],
    subcategories: [
      { label: 'Hundefutter', patterns: [/(hund|hundefutter|hundesnack)/] },
      { label: 'Katzenfutter', patterns: [/(katze|katzenfutter|katzensnack)/] },
      { label: 'Katzenstreu & Pflege', patterns: [/(katzenstreu|katzenpflege)/] },
      { label: 'Tierzubehoer', patterns: [/(napf|leine|spielzeug|tierzubehor|tierzubehoer)/] },
    ],
  },
  {
    main: 'Garten / Pflanzen',
    patterns: [/(garten|pflanze|blume)/],
    subcategories: [
      { label: 'Pflanzen & Blumen', patterns: [/(pflanze|blume|orchidee|rose|topfpflanze)/] },
      { label: 'Erde & Duenger', patterns: [/(erde|kompost|dunger|duenger|hochbeeterde|blumenerde)/] },
      { label: 'Gartenzubehoer', patterns: [/(gartenzubehor|gartenzubehoer|schlauch|topf|saatsamen|samen|hochbeet|beet|gartenhaus)/] },
    ],
  },
  {
    main: 'Kleidung / Mode',
    patterns: [/(bekleidung|mode|kleidung)/],
    subcategories: [
      { label: 'Damenbekleidung', patterns: [/(damen|leggings|kleid|bluse|bh)/] },
      { label: 'Herrenbekleidung', patterns: [/(herren|hemd|boxershorts|unterhemd)/] },
      { label: 'Kinderbekleidung', patterns: [/(kinder|babykleidung|strampler)/] },
      { label: 'Schuhe & Accessoires', patterns: [/(schuh|socke|guertel|gurtel|mütze|muetze|tasche)/] },
    ],
  },
  {
    main: 'Technik / Elektronik',
    patterns: [/(technik|elektronik|geraet|gerat)/],
    subcategories: [
      { label: 'Kuechengeraete', patterns: [/(mikrowelle|toaster|wasserkocher|kaffeemaschine|fritteuse|grill|kontaktgrill|standgrill|heissluftfritteuse|heisluftfritteuse)/] },
      { label: 'Unterhaltungselektronik', patterns: [/(tv|fernseher|lautsprecher|kopfhorer|kopfhoerer)/] },
      { label: 'Computer & Mobile', patterns: [/(notebook|laptop|tablet|smartphone|monitor|drucker|scanner|speichermedien|festplatte|usb|computerzubehor|computerzubehoer|pc zubehor|pc zubehoer)/] },
      { label: 'Werkzeug & Akkus', patterns: [/(werkzeug|bohrer|akkuschrauber|akku|maschine)/] },
    ],
  },
  {
    main: 'Freizeit / Sonstiges',
    patterns: [/(freizeit|hobby|camping|schule|spiel)/],
    subcategories: [
      { label: 'Spielzeug', patterns: [/(spielzeug|lego|puppe|pluesch|plueschtier|hot wheels|barbie|spiel)/] },
      { label: 'Games & Konsolen', patterns: [/(games|spielkonsole|nintendo switch|playstation|xbox|videospiel)/] },
      { label: 'Schreibwaren & Schule', patterns: [/(schule|schreibwaren|heft|stift|malblock)/] },
      { label: 'Sport & Camping', patterns: [/(sport|camping|fahrrad|helm|outdoor|grill|freizeit)/] },
      { label: 'Autozubehoer', patterns: [/(autozubehor|autozubehoer|motoroel|reifen)/] },
    ],
  },
  {
    main: 'Baby / Kinder',
    patterns: [/(baby|kinder|kind)/],
    subcategories: [
      { label: 'Babybedarf', patterns: [/(baby|schnuller|strampler|babyflasche)/] },
      { label: 'Kinderpflege', patterns: [/(kinderpflege|babyshampoo|babycreme|windel)/] },
    ],
  },
];

const HARD_CATEGORY_OVERRIDES = [
  {
    patterns: [/\b(gefrierschrank|kuehlschrank|kühlschrank|kuhlschrank|kuehltruhe|kühltruhe|no frost)\b/],
    main: 'Technik / Elektronik',
    sub: 'Kuechengeraete',
  },
  {
    patterns: [/\b(hochbeet|hochbeeterde|blumenerde|pflanzerde|komposterde|erde|duenger|dunger)\b/],
    main: 'Garten / Pflanzen',
    sub: 'Erde & Duenger',
  },
  {
    patterns: [/\b(gartenhaus|rasenmaeher|rasenmäher|heckenschere|schlauchwagen|bewaesserung|bewässerung|pavillon)\b/],
    main: 'Garten / Pflanzen',
    sub: 'Gartenzubehoer',
  },
  {
    patterns: [/\b(akku schrauber|akkuschrauber|bohrer|bit set|bit-set|werkzeugkoffer|schraubendreher|stichsaege|stichsäge)\b/],
    main: 'Technik / Elektronik',
    sub: 'Werkzeug & Akkus',
  },
  {
    patterns: [/\b(tv|smart tv|fernseher|oled|q led|qled|monitor|lautsprecher|soundbar)\b/],
    main: 'Technik / Elektronik',
    sub: 'Unterhaltungselektronik',
  },
  {
    patterns: [/\b(vitamin|magnesium|omega|zink|nahrungserganzung|nahrungsergaenzung|kapsel|kapseln|tablette|tabletten|pastille|pastillen)\b/],
    main: 'Drogerie / Hygiene',
    sub: 'Gesundheit & Nahrungsergaenzung',
  },
  {
    patterns: [/\b(spueltabs|spultabs|spuelmaschinentabs|spulmaschinentabs|geschirrspueltabs|geschirrspultabs|waschcaps|reiniger tabs)\b/],
    main: 'Haushalt',
    sub: 'Waschmittel & Reiniger',
  },
  {
    patterns: [/\b(formular|geschaftsbuch|geschaeftsbuch|briefkorb|stehsammler|etiketten|fotopapier|ordner|register|kuvert)\b/],
    main: 'Buero / Schule',
    sub: 'Papier & Ordnen',
  },
  {
    patterns: [/\b(schreibwaren|kugelschreiber|filzstift|textmarker|bleistift|notizbuch|collegeblock|heft|fineliner)\b/],
    main: 'Buero / Schule',
    sub: 'Schreibwaren',
  },
  {
    patterns: [/\b(drucker|scanner|toner|tinte|patrone|speichermedien|speicherkarte|festplatte|usb stick|usb-stick|computerzubehor|computerzubehoer|pc-zubehor|pc-zubehoer)\b/],
    main: 'Buero / Schule',
    sub: 'Drucker & Scanner',
  },
  {
    patterns: [/\b(hot wheels|pluesch|plueschtier)\b/],
    main: 'Freizeit / Sonstiges',
    sub: 'Spielzeug',
  },
  {
    patterns: [/\b(nintendo switch|videospiel|konsole|games)\b/],
    main: 'Freizeit / Sonstiges',
    sub: 'Games & Konsolen',
  },
  {
    patterns: [/\b(kontaktgrill|standgrill|heissluftfritteuse|heisluftfritteuse)\b/],
    main: 'Technik / Elektronik',
    sub: 'Kuechengeraete',
  },
];

function getNormalizedLabel(value) {
  return normalizeTitleForMatch(sanitizeWhitespace(value));
}

function isBroadCategoryLabel(value) {
  return /^(lebensmittel|getraenke|drogerie hygiene|haushalt|tierbedarf|garten pflanzen|kleidung mode|technik elektronik|freizeit sonstiges|baby kinder)$/.test(
    getNormalizedLabel(value)
  );
}

function getTexts({ title = '', contextText = '', sourceCategory = '', productGroups = [] }) {
  return [
    sanitizeWhitespace(title),
    sanitizeWhitespace(contextText),
    sanitizeWhitespace(sourceCategory),
    ...(Array.isArray(productGroups) ? productGroups.map((group) => sanitizeWhitespace(group?.title || '')) : []),
  ].filter(Boolean);
}

function scoreRule(texts, rule) {
  let score = 0;

  for (const text of texts) {
    const haystack = normalizeTitleForMatch(text);

    for (const pattern of rule.patterns || []) {
      if (pattern.test(haystack)) {
        score += text === texts[0] ? 4 : 2;
      }
    }
  }

  return score;
}

function findTaxonomyCategory(mainCategory) {
  const normalizedMain = getNormalizedLabel(mainCategory);
  return CATEGORY_TAXONOMY.find((category) => getNormalizedLabel(category.main) === normalizedMain) || null;
}

function findBestSubcategoryMatch({ texts = [], mainCategory = '' }) {
  const candidateCategories = mainCategory ? [findTaxonomyCategory(mainCategory)].filter(Boolean) : CATEGORY_TAXONOMY;
  let bestMatch = null;
  let bestScore = 0;

  for (const category of candidateCategories) {
    for (const subcategory of category.subcategories || []) {
      const score = scoreRule(texts, subcategory);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          main: category.main,
          label: subcategory.label,
        };
      }
    }
  }

  if (!bestMatch || bestScore < 2) {
    return null;
  }

  return bestMatch;
}

function detectHardCategoryOverride({ title = '', contextText = '', sourceCategory = '', productGroups = [] }) {
  const haystack = normalizeTitleForMatch(getTexts({ title, contextText, sourceCategory, productGroups }).join(' '));

  for (const rule of HARD_CATEGORY_OVERRIDES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      return {
        primaryCategory: rule.main,
        secondaryCategory: rule.sub,
        confidence: 0.98,
      };
    }
  }

  return null;
}

function classifyOfferCategory({ title = '', contextText = '', sourceCategory = '', productGroups = [] }) {
  const hardOverride = detectHardCategoryOverride({ title, contextText, sourceCategory, productGroups });

  if (hardOverride) {
    return hardOverride;
  }

  const texts = getTexts({ title, contextText, sourceCategory, productGroups });
  let bestMain = null;
  let bestMainScore = 0;
  const bestSub = findBestSubcategoryMatch({ texts });

  for (const category of CATEGORY_TAXONOMY) {
    const mainScore = scoreRule(texts, category);

    if (mainScore > bestMainScore) {
      bestMain = category;
      bestMainScore = mainScore;
    }
  }

  if (bestSub) {
    return {
      primaryCategory: bestSub.main,
      secondaryCategory: bestSub.label,
      confidence: 0.88,
    };
  }

  if (bestMain && bestMainScore >= 2) {
    return {
      primaryCategory: bestMain.main,
      secondaryCategory: sanitizeWhitespace(sourceCategory) || bestMain.main,
      confidence: Math.min(1, 0.52 + bestMainScore * 0.06),
    };
  }

  return {
    primaryCategory: 'Lebensmittel',
    secondaryCategory: sanitizeWhitespace(sourceCategory) || 'Lebensmittel',
    confidence: 0.35,
  };
}

function determineOfferCategory({ title = '', contextText = '', sourceCategory = '', productGroups = [] }) {
  return classifyOfferCategory({ title, contextText, sourceCategory, productGroups }).primaryCategory;
}

function determineOfferSubcategory({ primaryCategory = '', sourceCategory = '', fallbackLabel = '', title = '', contextText = '', productGroups = [] }) {
  const classified = classifyOfferCategory({ title, contextText, sourceCategory, productGroups });
  const primary = sanitizeWhitespace(primaryCategory || classified.primaryCategory);
  const candidateTexts = [
    sanitizeWhitespace(sourceCategory),
    sanitizeWhitespace(fallbackLabel),
  ].filter(Boolean);
  const inferredMatch = findBestSubcategoryMatch({
    texts: getTexts({ title, contextText, sourceCategory, productGroups }),
    mainCategory: primary,
  });

  if (inferredMatch && getNormalizedLabel(inferredMatch.label) !== getNormalizedLabel(primary)) {
    return inferredMatch.label;
  }

  for (const text of candidateTexts) {
    if (!text || isBroadCategoryLabel(text) || getNormalizedLabel(text) === getNormalizedLabel(primary)) {
      continue;
    }

    const matched = findBestSubcategoryMatch({
      texts: [text],
      mainCategory: primary,
    });

    if (matched && getNormalizedLabel(matched.label) !== getNormalizedLabel(primary)) {
      return matched.label;
    }
  }

  return '';
}

function buildInclusiveScopeDecision() {
  return {
    included: true,
    reason: '',
  };
}

module.exports = {
  CATEGORY_TAXONOMY,
  classifyOfferCategory,
  determineOfferCategory,
  determineOfferSubcategory,
  buildInclusiveScopeDecision,
};
