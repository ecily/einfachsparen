import { CONTACT_EMAIL, SITE_URL } from '../config/constants'

export function getPageMeta(activePage) {
  const baseTitle = 'kaufklug.at – Supermarkt-Angebote & Prospekte in Österreich einfacher finden'
  const baseDescription =
    'kaufklug.at hilft dir kostenlos, aktuelle Supermarkt-Angebote, Prospekte und Aktionen in Österreich leichter zu finden, nach Geschäften und Kategorien zu filtern und als Einkaufsliste zu speichern.'

  const pages = {
    search: {
      title: baseTitle,
      description: baseDescription,
      path: '/',
    },
    'product-search': {
      title: 'Produktsuche – kaufklug.at',
      description: 'Suche aktuelle Angebote nach Produkten, Marken oder Kategorien und merke passende Aktionen direkt auf deiner Einkaufsliste.',
      path: '/suche',
    },
    'shopping-list': {
      title: 'Einkaufsliste – kaufklug.at',
      description: 'Speichere interessante Angebote lokal auf deiner Einkaufsliste und sortiere deinen Einkauf nach Geschäft.',
      path: '/einkaufsliste',
    },
    impressum: {
      title: 'Impressum – kaufklug.at',
      description: 'Impressum und Betreiberinformationen zu kaufklug.at.',
      path: '/impressum',
    },
    privacy: {
      title: 'Datenschutz – kaufklug.at',
      description: 'Datenschutzhinweise zu kaufklug.at, lokaler Speicherung, Serverkommunikation, pseudonymer Nutzungsmessung und externem QR-Code-Dienst.',
      path: '/datenschutz',
    },
    liability: {
      title: 'Nutzungs- und Haftungshinweise – kaufklug.at',
      description: 'Hinweise zur unverbindlichen Nutzung von kaufklug.at, Angebotsinformationen, Marken, Händlern und Korrekturmeldungen.',
      path: '/nutzungshinweise',
    },
    cookies: {
      title: 'Cookie- und Speicherhinweis – kaufklug.at',
      description: 'Informationen zu Cookies, lokaler Speicherung, pseudonymer Nutzungsmessung und technischen Verbindungen bei kaufklug.at.',
      path: '/cookies',
    },
    quality: {
      title: 'Datenqualität – kaufklug.at',
      description: 'Interne Qualitätsansicht für kaufklug.at.',
      path: '/quality',
    },
    diagnostics: {
      title: 'Interne KPI – kaufklug.at',
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
  const canonicalUrl = `${SITE_URL}${meta.path}`

  document.title = meta.title

  setOrCreateMeta('name', 'description', meta.description)
  setOrCreateMeta('name', 'robots', activePage === 'quality' || activePage === 'diagnostics' ? 'noindex,nofollow' : 'index,follow')
  setOrCreateMeta('name', 'theme-color', '#f7f1e6')

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
    description:
      'Kostenlose Orientierungshilfe für Supermarkt-Angebote, Prospekte und Aktionen in Österreich.',
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
      'kaufklug.at hilft kostenlos dabei, öffentlich verfügbare Angebotsinformationen in Österreich übersichtlich darzustellen, nach Geschäften und Kategorien zu filtern und auf einer Einkaufsliste zu merken.',
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

  if (activePage === 'search') {
    setOrCreateJsonLd('kaufklug-jsonld-faq', {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Was ist kaufklug.at?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'kaufklug.at ist eine kostenlose Orientierungshilfe für aktuelle Supermarkt-Angebote, Prospekte und Aktionen in Österreich. Die Seite hilft dabei, Angebote einfacher zu finden, nach Geschäften und Kategorien zu filtern und interessante Aktionen auf eine Einkaufsliste zu setzen.',
          },
        },
        {
          '@type': 'Question',
          name: 'Ist kaufklug.at kostenlos?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'Ja. kaufklug.at ist derzeit kostenlos nutzbar, weil das Projekt unabhängig aufgebaut wird.',
          },
        },
        {
          '@type': 'Question',
          name: 'Für wen ist kaufklug.at gedacht?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'kaufklug.at ist für alle gedacht, die beim täglichen Einkauf sparen möchten oder sparen müssen: Familien, Pensionisten, Studenten, Alleinerziehende und alle preisbewussten Haushalte in Österreich.',
          },
        },
        {
          '@type': 'Question',
          name: 'Sind die angezeigten Angebote garantiert richtig?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'Nein. kaufklug.at zeigt Angebotsinformationen als unverbindliche Orientierungshilfe. Preise, Verfügbarkeit, Bedingungen und regionale Gültigkeit können abweichen. Vor dem Kauf sollten immer die aktuellen Angaben des jeweiligen Händlers geprüft werden.',
          },
        },
        {
          '@type': 'Question',
          name: 'Warum sehe ich manchmal keine genaue Ersparnis?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'Manche Prospekte nennen nur den Aktionspreis, aber keinen Normalpreis. In solchen Fällen zeigt kaufklug.at den Aktionspreis, aber keine konkrete Euro-Ersparnis.',
          },
        },
        {
          '@type': 'Question',
          name: 'Funktioniert kaufklug.at besser am Smartphone?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'Ja. Die Website bleibt nutzbar, aber kaufklug.at ist vor allem für das Smartphone gedacht. So können Angebote direkt beim Einkaufen genutzt und interessante Aktionen auf der Einkaufsliste gespeichert werden.',
          },
        },
      ],
    })
  } else {
    removeJsonLd('kaufklug-jsonld-faq')
  }
}

export function getInitialPageFromPathname(pathname) {
  if (pathname.includes('ecily_web')) return 'diagnostics'
  if (pathname.includes('impressum')) return 'impressum'
  if (pathname.includes('datenschutz') || pathname.includes('privacy')) return 'privacy'
  if (pathname.includes('nutzung') || pathname.includes('haftung') || pathname.includes('legal')) return 'liability'
  if (pathname.includes('cookies') || pathname.includes('cookie')) return 'cookies'
  if (pathname.includes('quality')) return 'quality'
  if (pathname.includes('diagnose') || pathname.includes('diagnostic')) return 'diagnostics'
  if (pathname.includes('suche')) return 'product-search'
  if (pathname.includes('einkaufsliste') || pathname.includes('shopping')) return 'shopping-list'

  return 'search'
}

export function getPathForPage(nextPage) {
  if (nextPage === 'quality') return '/quality'
  if (nextPage === 'diagnostics') return '/ecily_web'
  if (nextPage === 'product-search') return '/suche'
  if (nextPage === 'shopping-list') return '/einkaufsliste'
  if (nextPage === 'impressum') return '/impressum'
  if (nextPage === 'privacy') return '/datenschutz'
  if (nextPage === 'liability') return '/nutzungshinweise'
  if (nextPage === 'cookies') return '/cookies'

  return '/'
}
