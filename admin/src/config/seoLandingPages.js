export const SEO_LANDING_PAGE_PREFIX = 'seo-offers:'
export const PRICE_CHECK_PATH = '/preischeck/bier-literpreis-vergleich'
export const PRICE_CHECK_ROUTE_ID = 'pricecheck:bier-literpreis-vergleich'

export const SEO_TRUST_COPY = 'Preise, Verf\u00fcgbarkeit und Bedingungen bitte im Markt pr\u00fcfen.'

const baseRelatedLinks = [
  ['angebote', 'Alle Angebote'],
  ['supermarkt', 'Supermarkt Angebote'],
  ['drogerie', 'Drogerie Angebote'],
  ['kaffee', 'Kaffee Angebote'],
  ['bier', 'Bier Angebote'],
  ['softdrinks', 'Softdrinks Angebote'],
  ['waschmittel', 'Waschmittel Angebote'],
  ['schokolade', 'Schokolade Angebote'],
  ['windeln', 'Windeln Angebote'],
  ['duschgel', 'Duschgel Angebote'],
  ['nudeln', 'Nudeln Angebote'],
  ['chips', 'Chips Angebote'],
]

const retailerRelatedLinks = [
  ['billa', 'BILLA Angebote'],
  ['billa-plus', 'BILLA Plus Angebote'],
  ['lidl', 'Lidl Angebote'],
  ['dm', 'dm Angebote'],
  ['bipa', 'BIPA Angebote'],
  ['penny', 'PENNY Angebote'],
  ['mueller', 'M\u00fcller Angebote'],
  ['hofer', 'HOFER eingeschr\u00e4nkt'],
  ['interspar', 'INTERSPAR eingeschr\u00e4nkt'],
]

const retailerLandingPaths = {
  'billa-plus': '/angebote/billa/',
  interspar: '/angebote/spar/',
}

function links(keys) {
  const lookup = new Map([...baseRelatedLinks, ...retailerRelatedLinks])

  return keys
    .map((key) => ({
      key,
      label: lookup.get(key),
      path: key === 'angebote' ? '/angebote/' : `/angebote/${key}/`,
    }))
    .filter((item) => item.label)
}

export const seoLandingPages = [
  {
    key: 'angebote',
    path: '/angebote',
    title: 'Aktuelle Angebote in \u00d6sterreich finden | kaufklug',
    description:
      'Finde aktuelle Angebote von Superm\u00e4rkten und Drogerien in \u00d6sterreich. kaufklug zeigt Preise, Aktionen und Bedingungen als Orientierungshilfe.',
    h1: 'Aktuelle Angebote in \u00d6sterreich finden',
    intro:
      'Finde aktuelle Angebote von Superm\u00e4rkten und Drogerien in \u00d6sterreich. kaufklug hilft dir, Preise, Aktionen und Bedingungen schneller zu \u00fcberblicken.',
    robots: 'index,follow',
    query: {
      limit: 24,
    },
    relatedLinks: links(['supermarkt', 'drogerie', 'kaffee', 'bier', 'softdrinks', 'schokolade', 'windeln', 'duschgel', 'nudeln', 'chips', 'billa', 'hofer', 'lidl', 'waschmittel', 'butter']),
  },
  {
    key: 'supermarkt',
    path: '/angebote/supermarkt',
    title: 'Supermarkt Angebote aktuell vergleichen | kaufklug.at',
    description:
      'Aktuelle Supermarkt-Angebote vergleichen. Preise, Packungsgr\u00f6\u00dfen und Preis pro kg, Liter oder St\u00fcck transparent auf kaufklug.at.',
    h1: 'Supermarkt Angebote aktuell vergleichen',
    intro: 'Vergleiche aktuelle Angebote mehrerer Superm\u00e4rkte direkt nach Preis, Packungsgr\u00f6\u00dfe, Bedingungen und sicher vorhandenem Preis pro Einheit.',
    robots: 'index,follow',
    queries: [
      {
        retailers: 'billa,billa-plus',
        programRetailers: 'billa,billa-plus',
        limit: 12,
        offset: 0,
      },
      {
        retailers: 'lidl',
        programRetailers: 'lidl',
        limit: 8,
        offset: 0,
      },
      {
        retailers: 'penny',
        programRetailers: 'penny',
        limit: 8,
        offset: 0,
      },
    ],
    query: {
      retailers: 'billa,billa-plus',
      programRetailers: 'billa,billa-plus',
      limit: 12,
      offset: 0,
    },
    relatedLinks: links(['billa', 'lidl', 'penny', 'kaffee', 'bier', 'softdrinks', 'schokolade', 'nudeln', 'chips']),
  },
  {
    key: 'drogerie',
    path: '/angebote/drogerie',
    title: 'Drogerie Angebote aktuell vergleichen | kaufklug.at',
    description:
      'Aktuelle Drogerie-Angebote vergleichen. Packungsgr\u00f6\u00dfen, Literpreise, St\u00fcckpreise und Bedingungen von dm und BIPA transparent auf kaufklug.at.',
    h1: 'Drogerie Angebote aktuell vergleichen',
    intro:
      'Vergleiche aktuelle Drogerie-Angebote von dm und BIPA nach Preis, Packungsgr\u00f6\u00dfe, Liter- oder St\u00fcckpreis und Bedingungen, soweit sicher vorhanden.',
    robots: 'index,follow',
    query: {
      retailers: 'dm,bipa',
      limit: 24,
    },
    relatedLinks: links(['dm', 'bipa', 'waschmittel', 'windeln', 'duschgel', 'supermarkt', 'angebote']),
  },
  {
    key: 'spar',
    path: '/angebote/spar',
    title: 'SPAR Angebote aktuell finden | kaufklug',
    description:
      'Finde aktuelle Angebote von SPAR und INTERSPAR in \u00d6sterreich. kaufklug hilft, Aktionen, Preise und Bedingungen schneller zu \u00fcberblicken.',
    h1: 'SPAR Angebote aktuell finden',
    intro:
      'Finde aktuelle Angebote von SPAR und INTERSPAR in \u00d6sterreich. kaufklug hilft dir, Aktionen, Preise und Bedingungen schneller zu \u00fcberblicken.',
    note: 'Diese Seite umfasst aktuell SPAR und INTERSPAR.',
    robots: 'noindex,follow',
    query: {
      retailers: 'spar,interspar',
      programRetailers: 'spar,interspar',
      limit: 24,
      offset: 0,
    },
    relatedLinks: links(['supermarkt', 'billa', 'hofer', 'lidl', 'kaffee', 'kaese']),
  },
  {
    key: 'billa',
    path: '/angebote/billa',
    title: 'BILLA Angebote aktuell vergleichen | kaufklug.at',
    description:
      'Aktuelle BILLA-Angebote vergleichen. Preise, Packungsgr\u00f6\u00dfen, Bedingungen und Preis pro kg, Liter oder St\u00fcck transparent auf kaufklug.at.',
    h1: 'BILLA Angebote aktuell vergleichen',
    intro:
      'Vergleiche aktuelle Angebote von BILLA und BILLA Plus mit Packungsgr\u00f6\u00dfe, Bedingungen und sicher vorhandenem Preis pro Einheit.',
    robots: 'index,follow',
    query: {
      retailers: 'billa,billa-plus',
      programRetailers: 'billa,billa-plus',
      limit: 24,
      offset: 0,
    },
    relatedLinks: links(['supermarkt', 'lidl', 'penny', 'kaffee', 'bier', 'softdrinks', 'schokolade', 'nudeln', 'chips']),
  },
  {
    key: 'hofer',
    path: '/angebote/hofer',
    title: 'HOFER Angebote aktuell finden | kaufklug',
    description:
      'Finde aktuelle HOFER Angebote in \u00d6sterreich. kaufklug zeigt Preise, Aktionen und Bedingungen als Orientierungshilfe.',
    h1: 'HOFER Angebote aktuell finden',
    intro:
      'Finde aktuelle HOFER Angebote in \u00d6sterreich und pr\u00fcfe Preise, Packungsgr\u00f6\u00dfen, Aktionen und G\u00fcltigkeit an einem Ort.',
    robots: 'index,follow',
    query: {
      retailers: 'hofer',
      programRetailers: 'hofer',
      limit: 24,
      offset: 0,
    },
    relatedLinks: links(['supermarkt', 'billa', 'lidl', 'penny', 'kaffee', 'kaese']),
  },
  {
    key: 'lidl',
    path: '/angebote/lidl',
    title: 'Lidl Angebote aktuell vergleichen | kaufklug.at',
    description:
      'Aktuelle Lidl-Angebote vergleichen. Preise, Packungsgr\u00f6\u00dfen und Preis pro kg, Liter oder St\u00fcck transparent auf kaufklug.at.',
    h1: 'Lidl Angebote aktuell vergleichen',
    intro:
      'Vergleiche aktuelle Lidl-Angebote mit Packungsgr\u00f6\u00dfe, Bedingungen und sicher vorhandenem Preis pro Einheit, statt nur einzelne Aktionen zu sammeln.',
    robots: 'index,follow',
    query: {
      retailers: 'lidl',
      programRetailers: 'lidl',
      limit: 24,
      offset: 0,
    },
    relatedLinks: links(['supermarkt', 'billa', 'penny', 'kaffee', 'bier', 'softdrinks', 'schokolade', 'nudeln', 'chips']),
  },
  {
    key: 'dm',
    path: '/angebote/dm',
    title: 'dm Angebote aktuell finden | kaufklug',
    description:
      'Finde aktuelle dm Angebote in \u00d6sterreich. kaufklug zeigt Drogerie-Aktionen, Preise und Bedingungen als Orientierungshilfe.',
    h1: 'dm Angebote aktuell finden',
    intro:
      'Finde aktuelle Angebote von dm in \u00d6sterreich. kaufklug zeigt Drogerie-Aktionen, Preise und Bedingungen, soweit diese erkannt wurden.',
    robots: 'index,follow',
    query: {
      retailers: 'dm',
      programRetailers: 'dm',
      limit: 24,
      offset: 0,
    },
    relatedLinks: links(['drogerie', 'bipa', 'waschmittel', 'supermarkt']),
  },
  {
    key: 'bipa',
    path: '/angebote/bipa',
    title: 'BIPA Angebote aktuell vergleichen | kaufklug.at',
    description:
      'Aktuelle BIPA-Angebote vergleichen. Preise, Packungsgr\u00f6\u00dfen, Liter- oder St\u00fcckpreise und Bedingungen transparent auf kaufklug.at.',
    h1: 'BIPA Angebote aktuell vergleichen',
    intro:
      'Vergleiche aktuelle BIPA-Angebote mit Packungsgr\u00f6\u00dfe, Bedingungen und sicher vorhandenem Liter- oder St\u00fcckpreis.',
    robots: 'index,follow',
    query: {
      retailers: 'bipa',
      programRetailers: 'bipa',
      limit: 24,
      offset: 0,
    },
    relatedLinks: links(['drogerie', 'dm', 'waschmittel', 'windeln', 'duschgel']),
  },
  {
    key: 'mueller',
    path: '/angebote/mueller',
    title: 'M\u00fcller Angebote aktuell finden | kaufklug',
    description:
      'Finde aktuelle Online-Angebote von M\u00fcller in \u00d6sterreich. kaufklug zeigt Preise, Produkte und Bedingungen als Orientierungshilfe.',
    h1: 'M\u00fcller Angebote aktuell finden',
    intro:
      'Finde verifiziert aktuelle Online-Angebote von M\u00fcller. kaufklug zeigt Preise, Produkte und Bedingungen, soweit diese erkannt wurden.',
    note: 'Online-Angebot \u00b7 Verf\u00fcgbarkeit bei M\u00fcller pr\u00fcfen',
    robots: 'noindex,follow',
    query: {
      retailers: 'mueller',
      limit: 24,
      offset: 0,
    },
    relatedLinks: links(['drogerie', 'dm', 'bipa', 'waschmittel']),
  },
  {
    key: 'penny',
    path: '/angebote/penny',
    title: 'PENNY Angebote aktuell finden | kaufklug',
    description:
      'Finde aktuelle PENNY Angebote in \u00d6sterreich. kaufklug zeigt Preise, Aktionen und Bedingungen als Orientierungshilfe.',
    h1: 'PENNY Angebote aktuell finden',
    intro:
      'Finde aktuelle PENNY Angebote in \u00d6sterreich. kaufklug hilft dir, Preise, Aktionen und Bedingungen schneller zu \u00fcberblicken.',
    robots: 'index,follow',
    query: {
      retailers: 'penny',
      programRetailers: 'penny',
      limit: 24,
      offset: 0,
    },
    relatedLinks: links(['supermarkt', 'billa', 'hofer', 'lidl', 'kaffee', 'bier', 'softdrinks', 'kaese']),
  },
  {
    key: 'kaffee',
    path: '/angebote/kaffee',
    comparisonKey: 'kaffee',
    title: 'Kaffee Angebote aktuell vergleichen | kaufklug.at',
    description:
      'Aktuelle Kaffee-Angebote von mehreren H\u00e4ndlern vergleichen. Preise, Packungsgr\u00f6\u00dfen und Preis pro kg oder St\u00fcck transparent auf kaufklug.at.',
    h1: 'Kaffee Angebote aktuell vergleichen',
    intro:
      'Vergleiche aktuelle Kaffee-Angebote mehrerer H\u00e4ndler und beachte dabei Packungsgr\u00f6\u00dfen und Mengenbedingungen. Preis pro kg, St\u00fcck oder Kapsel wird angezeigt, soweit sicher vorhanden; ein Bestpreisversprechen gibt es nicht.',
    robots: 'index,follow',
    query: {
      q: 'kaffee',
      limit: 60,
      offset: 0,
    },
    relatedLinks: links(['angebote', 'supermarkt', 'billa', 'penny', 'bipa']),
  },
  {
    key: 'bier',
    path: '/angebote/bier',
    comparisonKey: 'bier',
    title: 'Bier Angebote aktuell vergleichen | kaufklug.at',
    description:
      'Aktuelle Bier-Angebote von mehreren H\u00e4ndlern vergleichen. Preise, Packungsgr\u00f6\u00dfen und Literpreise transparent auf kaufklug.at.',
    h1: 'Bier Angebote aktuell vergleichen',
    intro:
      'Vergleiche aktuelle Bier-Angebote mehrerer H\u00e4ndler und beachte Dosen, Flaschen, Multipacks, Kisten und Mengenbedingungen. Der Literpreis wird angezeigt, soweit sicher vorhanden; ein Bestpreisversprechen gibt es nicht.',
    robots: 'index,follow',
    query: {
      q: 'bier',
      limit: 60,
      offset: 0,
    },
    relatedLinks: links(['angebote', 'supermarkt', 'billa', 'penny', 'kaffee']).concat([{ label: 'Bier Literpreis-Preischeck', path: '/preischeck/bier-literpreis-vergleich' }]),
  },
  {
    key: 'softdrinks',
    path: '/angebote/softdrinks',
    title: 'Softdrinks Angebote aktuell vergleichen | kaufklug.at',
    description:
      'Aktuelle Softdrink-Angebote mehrerer H\u00e4ndler vergleichen. Literpreise, Flaschen, Dosen und Multipacks transparent auf kaufklug.at.',
    h1: 'Softdrinks Angebote aktuell vergleichen',
    intro:
      'Vergleiche aktuelle Softdrink-Angebote mehrerer H\u00e4ndler, darunter Cola und andere Limonaden. Beachte Dosen, Flaschen, Multipacks, Literpreise sowie Mengen- und Aktionsbedingungen.',
    robots: 'index,follow',
    query: {
      q: 'softdrinks',
      limit: 60,
      offset: 0,
    },
    relatedLinks: links(['angebote', 'supermarkt', 'billa', 'penny', 'lidl', 'bier']),
  },
  {
    key: 'schokolade',
    path: '/angebote/schokolade',
    title: 'Schokolade Angebote aktuell vergleichen | kaufklug.at',
    description:
      'Aktuelle Schokolade-Angebote verschiedener Händler vergleichen. Preise, Packungsgrößen und Preis pro kg transparent auf kaufklug.at.',
    h1: 'Schokolade Angebote aktuell vergleichen',
    intro:
      'Vergleiche aktuelle Schokolade-Angebote mehrerer Händler, von Tafeln und Packungen bis zu Multipacks. Beachte unterschiedliche Gewichte, den Preis pro kg und Mengenbedingungen.',
    robots: 'index,follow',
    query: { q: 'schokolade', limit: 60, offset: 0 },
    relatedLinks: links(['angebote', 'supermarkt', 'billa', 'penny', 'lidl', 'nudeln', 'chips']),
  },
  {
    key: 'windeln',
    path: '/angebote/windeln',
    title: 'Windeln Angebote aktuell vergleichen | kaufklug.at',
    description:
      'Aktuelle Windel-Angebote mehrerer Händler vergleichen. Packungsgrößen, Größenangaben und Preis pro Stück transparent auf kaufklug.at.',
    h1: 'Windeln Angebote aktuell vergleichen',
    intro:
      'Vergleiche Windel-Angebote verschiedener Händler nach Größe, Packungsumfang und Preis pro Stück. Auch Multipacks und Aktionsbedingungen bleiben sichtbar.',
    robots: 'index,follow',
    query: { q: 'windeln', limit: 60, offset: 0 },
    relatedLinks: links(['angebote', 'drogerie', 'dm', 'bipa', 'duschgel', 'waschmittel']),
  },
  {
    key: 'duschgel',
    path: '/angebote/duschgel',
    title: 'Duschgel Angebote aktuell vergleichen | kaufklug.at',
    description:
      'Aktuelle Duschgel-Angebote verschiedener Händler vergleichen. Preise, Größen und Literpreise transparent auf kaufklug.at.',
    h1: 'Duschgel Angebote aktuell vergleichen',
    intro:
      'Vergleiche Duschgel-Angebote mehrerer Händler und beachte unterschiedliche Flaschengrößen, Literpreise sowie Mengen- und Kundenkartenbedingungen.',
    robots: 'index,follow',
    query: { q: 'duschgel', limit: 60, offset: 0 },
    relatedLinks: links(['angebote', 'drogerie', 'dm', 'bipa', 'windeln', 'waschmittel']),
  },
  {
    key: 'nudeln',
    path: '/angebote/nudeln',
    title: 'Nudeln Angebote aktuell vergleichen | kaufklug.at',
    description:
      'Aktuelle Nudel-Angebote verschiedener Händler vergleichen. Packungsgrößen und Preis pro kg transparent auf kaufklug.at.',
    h1: 'Nudeln Angebote aktuell vergleichen',
    intro:
      'Vergleiche Pasta- und Nudel-Angebote mehrerer Händler, von Spaghetti und Penne bis zu weiteren Teigwaren. Packungsgrößen, Preis pro kg und Bedingungen bleiben im Blick.',
    robots: 'index,follow',
    query: { q: 'nudeln', limit: 60, offset: 0 },
    relatedLinks: links(['angebote', 'supermarkt', 'billa', 'penny', 'lidl', 'schokolade', 'chips']),
  },
  {
    key: 'chips',
    path: '/angebote/chips',
    title: 'Chips Angebote aktuell vergleichen | kaufklug.at',
    description:
      'Aktuelle Chips-Angebote verschiedener Händler vergleichen. Preise, Packungsgrößen und Preis pro kg transparent auf kaufklug.at.',
    h1: 'Chips Angebote aktuell vergleichen',
    intro:
      'Vergleiche Chips-Angebote mehrerer Händler nach Packungsgröße, Multipack und Preis pro kg. Aktionsbedingungen werden soweit sicher erkannt angezeigt.',
    robots: 'index,follow',
    query: { q: 'chips', limit: 60, offset: 0 },
    relatedLinks: links(['angebote', 'supermarkt', 'billa', 'penny', 'lidl', 'schokolade', 'nudeln']),
  },
  {
    key: 'waschmittel',
    path: '/angebote/waschmittel',
    comparisonKey: 'waschmittel',
    title: 'Waschmittel Angebote vergleichen: Preise & Packungsgr\u00f6\u00dfen | kaufklug.at',
    description:
      'Aktuelle Waschmittel-Angebote vergleichen. Packungsgr\u00f6\u00dfen, Mengenaktionen und Preis pro Einheit transparent auf kaufklug.at.',
    h1: 'Waschmittel Angebote vergleichen: Preise & Packungsgr\u00f6\u00dfen',
    intro:
      'Vergleiche aktuelle Waschmittel-Angebote nach Packungsgr\u00f6\u00dfe, Preis pro sicher vorhandener Einheit und Mengenaktionen. Ein Preis pro Waschladung wird nicht pauschal behauptet.',
    robots: 'index,follow',
    query: {
      q: 'waschmittel',
      limit: 24,
      offset: 0,
    },
    relatedLinks: links(['drogerie', 'dm', 'bipa', 'windeln', 'duschgel']),
  },
  {
    key: 'kaese',
    path: '/angebote/kaese',
    title: 'K\u00e4se Angebote aktuell finden | kaufklug',
    description:
      'Finde aktuelle K\u00e4se-Angebote in \u00d6sterreich. kaufklug zeigt Preise, Packungsgr\u00f6\u00dfen, Aktionen und G\u00fcltigkeit als Orientierungshilfe.',
    h1: 'K\u00e4se Angebote aktuell finden',
    intro:
      'Finde aktuelle K\u00e4se-Angebote in \u00d6sterreich. kaufklug zeigt Preise, Packungsgr\u00f6\u00dfen, Aktionen und G\u00fcltigkeit, soweit diese erkannt wurden.',
    robots: 'noindex,follow',
    query: {
      q: 'kaese',
      limit: 24,
      offset: 0,
    },
    relatedLinks: links(['supermarkt', 'billa', 'hofer', 'lidl', 'penny']),
  },
  {
    key: 'butter',
    path: '/angebote/butter',
    title: 'Butter Angebote aktuell finden | kaufklug',
    description:
      'Finde aktuelle Butter-Angebote in \u00d6sterreich. kaufklug zeigt Preise, Packungsgr\u00f6\u00dfen, Aktionen und G\u00fcltigkeit als Orientierungshilfe.',
    h1: 'Butter Angebote aktuell finden',
    intro:
      'Finde aktuelle Butter-Angebote in \u00d6sterreich. kaufklug zeigt Preise, Packungsgr\u00f6\u00dfen, Aktionen und G\u00fcltigkeit, soweit diese erkannt wurden.',
    robots: 'index,follow',
    query: {
      q: 'butter',
      limit: 24,
    },
    relatedLinks: links(['supermarkt', 'billa', 'hofer', 'lidl', 'penny']),
  },
  {
    key: 'wurst',
    path: '/angebote/wurst',
    title: 'Wurst Angebote aktuell finden | kaufklug',
    description:
      'Finde aktuelle Wurst-Angebote in \u00d6sterreich. kaufklug zeigt Preise, Packungsgr\u00f6\u00dfen, Aktionen und G\u00fcltigkeit als Orientierungshilfe.',
    h1: 'Wurst Angebote aktuell finden',
    intro:
      'Finde aktuelle Wurst-Angebote in \u00d6sterreich. kaufklug zeigt Preise, Packungsgr\u00f6\u00dfen, Aktionen und G\u00fcltigkeit, soweit diese erkannt wurden.',
    robots: 'noindex,follow',
    query: {
      q: 'wurst',
      limit: 24,
    },
    relatedLinks: links(['supermarkt', 'billa', 'hofer', 'lidl', 'spar']),
  },
]

export const seoLandingPageByKey = new Map(seoLandingPages.map((page) => [page.key, page]))
export const seoLandingPageByPath = new Map(seoLandingPages.map((page) => [page.path, page]))

export const seoFooterLinkGroups = [
  {
    title: 'Kategorien',
    links: baseRelatedLinks.map(([key, label]) => ({
      key,
      label,
      path: `/angebote/${key}/`,
    })),
  },
  {
    title: 'M\u00e4rkte',
    links: retailerRelatedLinks.map(([key, label]) => ({
      key,
      label,
      path: retailerLandingPaths[key] || `/angebote/${key}`,
    })),
  },
]

export function getSeoLandingPageRouteId(key) {
  return `${SEO_LANDING_PAGE_PREFIX}${key}`
}

export function getSeoLandingPageByRouteId(routeId) {
  const value = String(routeId || '')
  if (!value.startsWith(SEO_LANDING_PAGE_PREFIX)) return null

  return seoLandingPageByKey.get(value.slice(SEO_LANDING_PAGE_PREFIX.length)) || null
}

export function getSeoLandingPageByPath(pathname) {
  const normalizedPath = String(pathname || '').toLowerCase().replace(/\/+$/, '') || '/'
  return seoLandingPageByPath.get(normalizedPath) || null
}

export function getSeoLandingPageByKey(key) {
  return seoLandingPageByKey.get(String(key || '')) || null
}

export function getIndexableSeoLandingPages() {
  return seoLandingPages.filter((page) => page.robots === 'index,follow')
}
