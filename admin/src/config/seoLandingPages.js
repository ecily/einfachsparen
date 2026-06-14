export const SEO_LANDING_PAGE_PREFIX = 'seo-offers:'

export const SEO_TRUST_COPY = 'Preise, Verf\u00fcgbarkeit und Bedingungen bitte im Markt pr\u00fcfen.'

const baseRelatedLinks = [
  ['supermarkt', 'Supermarkt Angebote'],
  ['drogerie', 'Drogerie Angebote'],
  ['kaffee', 'Kaffee Angebote'],
  ['bier', 'Bier Angebote'],
  ['waschmittel', 'Waschmittel Angebote'],
  ['kaese', 'K\u00e4se Angebote'],
]

const retailerRelatedLinks = [
  ['spar', 'SPAR Angebote'],
  ['billa', 'BILLA Angebote'],
  ['hofer', 'HOFER Angebote'],
  ['lidl', 'Lidl Angebote'],
  ['dm', 'dm Angebote'],
  ['bipa', 'BIPA Angebote'],
  ['penny', 'PENNY Angebote'],
]

function links(keys) {
  const lookup = new Map([...baseRelatedLinks, ...retailerRelatedLinks])

  return keys
    .map((key) => ({
      key,
      label: lookup.get(key),
      path: `/angebote/${key}`,
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
    relatedLinks: links(['supermarkt', 'drogerie', 'billa', 'hofer', 'lidl', 'waschmittel', 'butter']),
  },
  {
    key: 'supermarkt',
    path: '/angebote/supermarkt',
    title: 'Supermarkt Angebote \u00d6sterreich aktuell finden | kaufklug',
    description:
      'Suche aktuelle Supermarkt-Angebote in \u00d6sterreich und finde schneller, was sich gerade lohnt. Preise und Bedingungen bitte im Markt pr\u00fcfen.',
    h1: 'Supermarkt Angebote in \u00d6sterreich finden',
    intro: 'Suche aktuelle Angebote von Superm\u00e4rkten in \u00d6sterreich und finde schneller, was sich gerade lohnt.',
    robots: 'index,follow',
    queries: [
      {
        retailers: 'billa,billa-plus',
        programRetailers: 'billa,billa-plus',
        limit: 12,
        offset: 0,
      },
      {
        retailers: 'hofer',
        programRetailers: 'hofer',
        limit: 8,
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
      {
        retailers: 'spar,interspar',
        programRetailers: 'spar,interspar',
        limit: 12,
        offset: 0,
      },
    ],
    query: {
      retailers: 'billa,billa-plus',
      programRetailers: 'billa,billa-plus',
      limit: 12,
      offset: 0,
    },
    relatedLinks: links(['billa', 'hofer', 'lidl', 'spar', 'penny', 'kaese']),
  },
  {
    key: 'drogerie',
    path: '/angebote/drogerie',
    title: 'Drogerie Angebote aktuell finden | kaufklug',
    description:
      'Finde aktuelle Drogerie-Angebote in \u00d6sterreich, etwa von dm und BIPA. kaufklug zeigt Aktionen und Bedingungen als Orientierungshilfe.',
    h1: 'Drogerie Angebote aktuell finden',
    intro:
      'Finde aktuelle Angebote aus Drogerie und Hygiene in \u00d6sterreich. kaufklug zeigt Aktionen, Preise und Bedingungen, soweit diese erkannt wurden.',
    robots: 'index,follow',
    query: {
      retailers: 'dm,bipa',
      limit: 24,
    },
    relatedLinks: links(['dm', 'bipa', 'waschmittel', 'supermarkt', 'angebote']),
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
    title: 'BILLA Angebote aktuell finden | kaufklug',
    description:
      'Finde aktuelle BILLA Angebote in \u00d6sterreich. kaufklug zeigt Preise, Aktionen und Bedingungen, soweit diese erkannt wurden.',
    h1: 'BILLA Angebote aktuell finden',
    intro:
      'Finde aktuelle Angebote von BILLA und BILLA Plus in \u00d6sterreich. kaufklug zeigt Preise, Aktionen und Bedingungen, soweit diese erkannt wurden.',
    robots: 'index,follow',
    query: {
      retailers: 'billa,billa-plus',
      programRetailers: 'billa,billa-plus',
      limit: 24,
      offset: 0,
    },
    relatedLinks: links(['supermarkt', 'hofer', 'lidl', 'penny', 'kaese']),
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
    title: 'Lidl Angebote aktuell finden | kaufklug',
    description:
      'Finde aktuelle Lidl Angebote in \u00d6sterreich. kaufklug zeigt Aktionen, Preise und Bedingungen, soweit diese erkannt wurden.',
    h1: 'Lidl Angebote aktuell finden',
    intro:
      'Finde aktuelle Lidl Angebote in \u00d6sterreich. kaufklug hilft dir, Aktionen, Preise und Bedingungen schneller zu \u00fcberblicken.',
    robots: 'index,follow',
    query: {
      retailers: 'lidl',
      programRetailers: 'lidl',
      limit: 24,
      offset: 0,
    },
    relatedLinks: links(['supermarkt', 'hofer', 'billa', 'penny', 'waschmittel', 'kaffee']),
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
    title: 'BIPA Angebote aktuell finden | kaufklug',
    description:
      'Finde aktuelle BIPA Angebote in \u00d6sterreich. kaufklug zeigt Drogerie-Aktionen, Preise und Bedingungen als Orientierungshilfe.',
    h1: 'BIPA Angebote aktuell finden',
    intro:
      'Finde aktuelle Angebote von BIPA in \u00d6sterreich. kaufklug zeigt Drogerie-Aktionen, Preise und Bedingungen, soweit diese erkannt wurden.',
    robots: 'index,follow',
    query: {
      retailers: 'bipa',
      programRetailers: 'bipa',
      limit: 24,
      offset: 0,
    },
    relatedLinks: links(['drogerie', 'dm', 'waschmittel', 'supermarkt']),
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
    relatedLinks: links(['supermarkt', 'billa', 'hofer', 'lidl', 'kaese']),
  },
  {
    key: 'kaffee',
    path: '/angebote/kaffee',
    title: 'Kaffee Angebote aktuell finden | kaufklug',
    description:
      'Finde aktuelle Kaffee-Angebote von Superm\u00e4rkten in \u00d6sterreich. kaufklug zeigt Preise, Packungsgr\u00f6\u00dfen, Aktionen und G\u00fcltigkeit.',
    h1: 'Kaffee Angebote aktuell finden',
    intro:
      'Finde aktuelle Kaffee-Angebote von Superm\u00e4rkten in \u00d6sterreich. kaufklug zeigt Preise, Packungsgr\u00f6\u00dfen, Aktionen und G\u00fcltigkeit, soweit diese erkannt wurden.',
    robots: 'noindex,follow',
    query: {
      q: 'kaffee',
      limit: 24,
      offset: 0,
    },
    relatedLinks: links(['supermarkt', 'billa', 'hofer', 'lidl', 'spar', 'kaese']),
  },
  {
    key: 'bier',
    path: '/angebote/bier',
    title: 'Bier Angebote aktuell finden | kaufklug',
    description:
      'Finde aktuelle Bier-Angebote in \u00d6sterreich. kaufklug zeigt Preise, Packungsgr\u00f6\u00dfen, Aktionen und G\u00fcltigkeit als Orientierungshilfe.',
    h1: 'Bier Angebote aktuell finden',
    intro:
      'Finde aktuelle Bier-Angebote in \u00d6sterreich. kaufklug zeigt Preise, Packungsgr\u00f6\u00dfen, Aktionen und G\u00fcltigkeit, soweit diese erkannt wurden.',
    robots: 'noindex,follow',
    query: {
      q: 'bier',
      limit: 24,
      offset: 0,
    },
    relatedLinks: links(['supermarkt', 'billa', 'hofer', 'lidl', 'spar']),
  },
  {
    key: 'waschmittel',
    path: '/angebote/waschmittel',
    title: 'Waschmittel Angebote aktuell finden | kaufklug',
    description:
      'Finde aktuelle Waschmittel-Angebote in \u00d6sterreich. kaufklug zeigt Preise, Aktionen, Bedingungen und G\u00fcltigkeit als Orientierungshilfe.',
    h1: 'Waschmittel Angebote aktuell finden',
    intro:
      'Finde aktuelle Waschmittel-Angebote in \u00d6sterreich. kaufklug zeigt Preise, Aktionen, Bedingungen und G\u00fcltigkeit, soweit diese erkannt wurden.',
    robots: 'index,follow',
    query: {
      q: 'waschmittel',
      limit: 24,
      offset: 0,
    },
    relatedLinks: links(['drogerie', 'dm', 'bipa', 'supermarkt']),
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
      path: `/angebote/${key}`,
    })),
  },
  {
    title: 'M\u00e4rkte',
    links: retailerRelatedLinks.map(([key, label]) => ({
      key,
      label,
      path: `/angebote/${key}`,
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
