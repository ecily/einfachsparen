import { CONTACT_EMAIL, SITE_URL } from '../config/constants'
import {
  getSeoLandingPageByPath,
  getSeoLandingPageByRouteId,
  getSeoLandingPageRouteId,
} from '../config/seoLandingPages'

const FAQ_ITEMS = [
  {
    question: 'Was ist kaufklug.at?',
    answer: 'kaufklug.at hilft dir, aktuelle Angebote zu suchen, zu merken und für deinen Einkauf zu organisieren.',
  },
  {
    question: 'Brauche ich ein Konto?',
    answer: 'Nein. Du kannst Angebote suchen, merken und deine Einkaufsliste teilen, ohne dich anzumelden.',
  },
  {
    question: 'Sind die Preise verbindlich?',
    answer: 'Nein. kaufklug ist eine Orientierungshilfe. Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen.',
  },
  {
    question: 'Funktioniert kaufklug auch ohne App?',
    answer:
      'Ja. Die Browser-Version am Handy ist aktuell praktisch gleichwertig nutzbar. Eine neue App-Version kommt wieder, sobald die Datenqualität stabil genug ist.',
  },
  {
    question: 'Kann ich meine Einkaufsliste teilen?',
    answer: 'Ja. Du kannst einen Link zu deiner Liste erstellen und ihn zum Beispiel per WhatsApp oder SMS teilen.',
  },
  {
    question: 'Warum sehe ich manchmal Bedingungen?',
    answer:
      'Manche Angebote gelten nur mit Kundenkarte, App oder ab einer bestimmten Menge. kaufklug zeigt solche Hinweise möglichst verständlich an.',
  },
]

const TAB_TITLE = 'kaufklug.at | einfach sparen'
const SEO_TITLE = 'kaufklug.at – Aktuelle Angebote finden und beim Einkauf sparen'
const BASE_DESCRIPTION =
  'kaufklug.at zeigt aktuelle Angebote aus österreichischen Märkten. Suche nach Produkten und Marken, prüfe Aktionen und merke Angebote für deine Einkaufsliste.'

export function getPageMeta(activePage) {
  const seoLandingPage = getSeoLandingPageByRouteId(activePage)

  if (seoLandingPage) {
    return {
      title: seoLandingPage.title,
      description: seoLandingPage.description,
      path: seoLandingPage.path,
      robots: seoLandingPage.robots,
    }
  }

  const pages = {
    search: {
      title: SEO_TITLE,
      description:
        'Stöbere nach Märkten und Kategorien und entdecke aktuelle Angebote für deinen Einkauf.',
      path: '/stoebern',
    },
    'product-search': {
      title: SEO_TITLE,
      description: BASE_DESCRIPTION,
      path: '/suche',
    },
    'shopping-list': {
      title: SEO_TITLE,
      description:
        'Merke Angebote für deinen Einkauf, organisiere deine Einkaufsliste und teile sie bei Bedarf per Link.',
      path: '/einkaufsliste',
    },
    feedback: {
      title: 'Feedback senden | kaufklug.at',
      description:
        'Sende Ideen, Wuensche und Hinweise fuer die kaufklug Beta und hilf mit, den Angebotsfinder gezielt zu verbessern.',
      path: '/feedback',
    },
    'shared-shopping-list': {
      title: SEO_TITLE,
      description:
        'Eine mit kaufklug geteilte Einkaufsliste. Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen.',
      path: '/liste',
    },
    impressum: {
      title: SEO_TITLE,
      description: 'Impressum und Betreiberinformationen zu kaufklug.at.',
      path: '/impressum',
    },
    privacy: {
      title: SEO_TITLE,
      description: 'Datenschutzhinweise zu kaufklug.at, lokaler Speicherung und Nutzungsmessung.',
      path: '/datenschutz',
    },
    liability: {
      title: SEO_TITLE,
      description:
        'Hinweise zur Nutzung von kaufklug.at als Orientierungshilfe für Angebotsinformationen.',
      path: '/nutzungshinweise',
    },
    cookies: {
      title: SEO_TITLE,
      description: 'Informationen zu Cookies, lokaler Speicherung und Nutzungsmessung bei kaufklug.at.',
      path: '/cookies',
    },
    diagnostics: {
      title: SEO_TITLE,
      description: 'Interner KPI- und Administrationsbereich für kaufklug.at.',
      path: '/ecily_web',
    },
  }

  return pages[activePage] || pages.search
}

export function setOrCreateMeta(attribute, key, content) {
  if (typeof document === 'undefined') return

  let element = document.head.querySelector(`meta[${attribute}="${key}"]`)

  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }

  element.setAttribute('content', content)
}

export function setOrCreateLink(rel, href) {
  if (typeof document === 'undefined') return

  let element = document.head.querySelector(`link[rel="${rel}"]`)

  if (!element) {
    element = document.createElement('link')
    element.setAttribute('rel', rel)
    document.head.appendChild(element)
  }

  element.setAttribute('href', href)
}

export function setOrCreateJsonLd(id, data) {
  if (typeof document === 'undefined') return

  let element = document.getElementById(id)

  if (!element) {
    element = document.createElement('script')
    element.id = id
    element.type = 'application/ld+json'
    document.head.appendChild(element)
  }

  element.textContent = JSON.stringify(data)
}

export function removeJsonLd(id) {
  if (typeof document === 'undefined') return

  const element = document.getElementById(id)

  if (element) {
    element.remove()
  }
}

export function updateSeoMetadata(activePage) {
  if (typeof document === 'undefined') return

  const meta = getPageMeta(activePage)
  const currentPathname = String(window.location.pathname || '').toLowerCase().replace(/\/+$/, '') || '/'
  const isHomePath = currentPathname === '/'
  const isUnknownSeoOfferPath = /^\/angebote\/[^/]+$/.test(currentPathname)
    && !getSeoLandingPageByPath(currentPathname)
  const canonicalPath = isHomePath ? '/' : meta.path
  const canonicalUrl = `${SITE_URL}${canonicalPath}`
  const isInternalPage = activePage === 'diagnostics'
  const isSharedListPage = activePage === 'shared-shopping-list'
  const robots = isUnknownSeoOfferPath
    ? 'noindex,follow'
    : meta.robots || (isSharedListPage ? 'noindex,noarchive' : isInternalPage ? 'noindex,nofollow' : 'index,follow')

  document.title = meta.title || TAB_TITLE

  setOrCreateMeta('name', 'title', meta.title)
  setOrCreateMeta('name', 'description', meta.description)
  setOrCreateMeta('name', 'robots', robots)
  setOrCreateMeta('name', 'theme-color', '#f7f9fb')

  setOrCreateMeta('property', 'og:type', 'website')
  setOrCreateMeta('property', 'og:site_name', 'kaufklug.at')
  setOrCreateMeta('property', 'og:title', meta.title)
  setOrCreateMeta('property', 'og:description', meta.description)
  setOrCreateMeta('property', 'og:url', canonicalUrl)
  setOrCreateMeta('property', 'og:locale', 'de_AT')

  setOrCreateMeta('name', 'twitter:card', 'summary')
  setOrCreateMeta('name', 'twitter:title', meta.title)
  setOrCreateMeta('name', 'twitter:description', meta.description)

  setOrCreateLink('canonical', canonicalUrl)

  setOrCreateJsonLd('kaufklug-jsonld-website', {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'kaufklug.at',
    url: SITE_URL,
    inLanguage: 'de-AT',
    description: BASE_DESCRIPTION,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/suche?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  })

  setOrCreateJsonLd('kaufklug-jsonld-webapp', {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'kaufklug.at',
    url: SITE_URL,
    applicationCategory: 'LifestyleApplication',
    operatingSystem: 'Web, Android',
    inLanguage: 'de-AT',
    isAccessibleForFree: true,
    description:
      'kaufklug.at hilft dabei, aktuelle Angebote zu suchen, zu merken, als Einkaufsliste zu organisieren und per Link zu teilen.',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
    },
    creator: {
      '@type': 'Person',
      name: 'Mag. Andreas Franz MA',
      email: CONTACT_EMAIL,
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Brunnenweg 16',
        postalCode: '8111',
        addressLocality: 'Gratwein-Straßengel',
        addressCountry: 'AT',
      },
    },
  })

  setOrCreateJsonLd('kaufklug-jsonld-person', {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'Mag. Andreas Franz MA',
    email: CONTACT_EMAIL,
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Brunnenweg 16',
      postalCode: '8111',
      addressLocality: 'Gratwein-Straßengel',
      addressCountry: 'AT',
    },
  })

  if (activePage === 'product-search' || activePage === 'search') {
    setOrCreateJsonLd('kaufklug-jsonld-faq', {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ_ITEMS.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    })
  } else {
    removeJsonLd('kaufklug-jsonld-faq')
  }
}

export function getInitialPageFromPathname(pathname) {
  const seoLandingPage = getSeoLandingPageByPath(pathname)
  if (seoLandingPage) return getSeoLandingPageRouteId(seoLandingPage.key)

  if (/^\/liste\/?$/.test(pathname)) return 'shopping-list'
  if (pathname.includes('/liste/')) return 'shared-shopping-list'
  if (pathname.includes('ecily_web')) return 'diagnostics'
  if (pathname.includes('impressum')) return 'impressum'
  if (pathname.includes('datenschutz') || pathname.includes('privacy')) return 'privacy'
  if (pathname.includes('nutzung') || pathname.includes('haftung') || pathname.includes('legal')) return 'liability'
  if (pathname.includes('cookies') || pathname.includes('cookie')) return 'cookies'
  if (pathname.includes('feedback')) return 'feedback'
  if (pathname.includes('diagnose') || pathname.includes('diagnostic')) return 'diagnostics'
  if (pathname.includes('stoebern') || pathname.includes('stobern')) return 'search'
  if (pathname.includes('suche')) return 'product-search'
  if (pathname.includes('einkaufsliste') || pathname.includes('shopping')) return 'shopping-list'

  return 'search'
}

export function getSharedListIdFromPathname(pathname) {
  const match = String(pathname || '').match(/\/liste\/([^/?#]+)/i)
  return match ? decodeURIComponent(match[1]) : ''
}

export function getPathForPage(nextPage) {
  const seoLandingPage = getSeoLandingPageByRouteId(nextPage)
  if (seoLandingPage) return seoLandingPage.path

  if (nextPage === 'diagnostics') return '/ecily_web'
  if (nextPage === 'product-search') return '/suche'
  if (nextPage === 'search') return '/stoebern'
  if (nextPage === 'shopping-list') return '/einkaufsliste'
  if (nextPage === 'impressum') return '/impressum'
  if (nextPage === 'privacy') return '/datenschutz'
  if (nextPage === 'liability') return '/nutzungshinweise'
  if (nextPage === 'cookies') return '/cookies'
  if (nextPage === 'feedback') return '/feedback'

  return '/'
}
