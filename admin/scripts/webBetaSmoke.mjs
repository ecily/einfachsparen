import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_BASE_URL = 'http://127.0.0.1:4173'
const BASE_URL = String(process.env.KAUFKLUG_SMOKE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
const SMOKE_API_BASE_URL = String(process.env.KAUFKLUG_SMOKE_API_BASE_URL || '').replace(/\/+$/, '')
const HOME_ONLY = process.env.KAUFKLUG_SMOKE_HOME_ONLY === 'true'
const TIMEOUT_MS = Number(process.env.KAUFKLUG_SMOKE_TIMEOUT_MS || 30000)
const MOBILE_WIDTH = 390
const MOBILE_HEIGHT = 900
const DESKTOP_WIDTH = 1280
const DESKTOP_HEIGHT = 900
const HERO_TEXT = 'Flugblätter raus. Die besten Angebote rein.'
const HERO_SUBLINE = 'Preise wirklich vergleichbar – pro kg, Liter oder Stück.'
const HERO_MARKETS = 'BILLA · BILLA Plus · Lidl · PENNY · dm · BIPA · Müller · HOFER eingeschränkt · INTERSPAR eingeschränkt'
const SPAR_TRUST_TITLE = 'Warum SPAR derzeit fehlt'
const FORBIDDEN_VISIBLE_COPY = [
  'bester Preis',
  'garantiert sparen',
  'immer günstigster Preis',
  'Weitere Bedingung anzeigen',
  'Android-Testversion laden',
]
const FORBIDDEN_VISIBLE_PATTERNS = [
  /QR-Code\s+zum\s+(Download|Laden)/i,
  /Android-Test(download|version)/i,
]

class SmokeError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.details = details
  }
}

class CdpConnection {
  constructor(webSocketUrl) {
    const parsedUrl = new URL(webSocketUrl)
    this.host = parsedUrl.hostname
    this.port = Number(parsedUrl.port)
    this.path = `${parsedUrl.pathname}${parsedUrl.search}`
    this.buffer = Buffer.alloc(0)
    this.nextId = 1
    this.pending = new Map()
    this.eventHandlers = new Map()
  }

  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64')
      const socket = net.createConnection({ host: this.host, port: this.port })
      this.socket = socket

      const fail = (error) => {
        socket.destroy()
        reject(error)
      }

      socket.once('error', fail)
      socket.once('connect', () => {
        socket.write(
          [
            `GET ${this.path} HTTP/1.1`,
            `Host: ${this.host}:${this.port}`,
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Key: ${key}`,
            'Sec-WebSocket-Version: 13',
            '',
            '',
          ].join('\r\n')
        )
      })

      let handshakeBuffer = Buffer.alloc(0)
      const onHandshakeData = (chunk) => {
        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk])
        const headerEnd = handshakeBuffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) return

        const headerText = handshakeBuffer.subarray(0, headerEnd).toString('utf8')
        if (!/^HTTP\/1\.1 101\b/.test(headerText)) {
          fail(new Error(`DevTools websocket handshake failed: ${headerText.split('\r\n')[0] || 'unknown status'}`))
          return
        }

        socket.off('data', onHandshakeData)
        socket.off('error', fail)
        socket.on('data', (data) => this.handleData(data))
        socket.on('error', (error) => this.rejectAll(error))
        socket.on('close', () => this.rejectAll(new Error('DevTools websocket closed')))

        const rest = handshakeBuffer.subarray(headerEnd + 4)
        if (rest.length > 0) this.handleData(rest)
        resolve()
      }

      socket.on('data', onHandshakeData)
    })
  }

  on(eventName, handler) {
    const handlers = this.eventHandlers.get(eventName) || []
    handlers.push(handler)
    this.eventHandlers.set(eventName, handlers)
  }

  command(method, params = {}) {
    const id = this.nextId++
    const message = JSON.stringify({ id, method, params })

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.write(encodeWebSocketFrame(message))
    })
  }

  close() {
    if (!this.socket?.destroyed) {
      this.socket.end()
      this.socket.destroy()
    }
  }

  handleData(data) {
    this.buffer = Buffer.concat([this.buffer, data])

    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0]
      const secondByte = this.buffer[1]
      const opcode = firstByte & 0x0f
      let offset = 2
      let payloadLength = secondByte & 0x7f

      if (payloadLength === 126) {
        if (this.buffer.length < offset + 2) return
        payloadLength = this.buffer.readUInt16BE(offset)
        offset += 2
      } else if (payloadLength === 127) {
        if (this.buffer.length < offset + 8) return
        const high = this.buffer.readUInt32BE(offset)
        const low = this.buffer.readUInt32BE(offset + 4)
        payloadLength = high * 2 ** 32 + low
        offset += 8
      }

      const masked = (secondByte & 0x80) !== 0
      const maskLength = masked ? 4 : 0
      const frameLength = offset + maskLength + payloadLength
      if (this.buffer.length < frameLength) return

      let payload = this.buffer.subarray(offset + maskLength, frameLength)
      if (masked) {
        const mask = this.buffer.subarray(offset, offset + 4)
        payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]))
      }
      this.buffer = this.buffer.subarray(frameLength)

      if (opcode === 0x8) {
        this.rejectAll(new Error('DevTools websocket closed'))
        return
      }

      if (opcode !== 0x1) continue

      const message = JSON.parse(payload.toString('utf8'))
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) {
          pending.reject(new Error(`${message.error.message || 'CDP command failed'} (${message.error.code || 'no code'})`))
        } else {
          pending.resolve(message.result || {})
        }
        continue
      }

      if (message.method) {
        const handlers = this.eventHandlers.get(message.method) || []
        for (const handler of handlers) handler(message.params || {})
      }
    }
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function encodeWebSocketFrame(text) {
  const payload = Buffer.from(text, 'utf8')
  const mask = crypto.randomBytes(4)
  const lengthBytes =
    payload.length < 126
      ? Buffer.from([0x81, 0x80 | payload.length])
      : payload.length < 65536
        ? Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff])
        : Buffer.concat([Buffer.from([0x81, 0x80 | 127]), writeUInt64BE(payload.length)])
  const maskedPayload = Buffer.alloc(payload.length)

  for (let index = 0; index < payload.length; index += 1) {
    maskedPayload[index] = payload[index] ^ mask[index % 4]
  }

  return Buffer.concat([lengthBytes, mask, maskedPayload])
}

function writeUInt64BE(value) {
  const buffer = Buffer.alloc(8)
  const high = Math.floor(value / 2 ** 32)
  const low = value >>> 0
  buffer.writeUInt32BE(high, 0)
  buffer.writeUInt32BE(low, 4)
  return buffer
}

function logStep(message) {
  console.log(`[web-beta-smoke] ${message}`)
}

function makeUrl(pathname) {
  return new URL(pathname, `${BASE_URL}/`).href
}

function assert(condition, message, details = {}) {
  if (!condition) throw new SmokeError(message, details)
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
    server.on('error', reject)
  })
}

function findBrowserExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
    process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '',
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' : '',
    process.platform === 'win32' ? path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe') : '',
    process.platform === 'win32' ? 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' : '',
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : '',
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '',
    process.platform === 'darwin' ? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' : '',
    process.platform === 'linux' ? '/usr/bin/google-chrome' : '',
    process.platform === 'linux' ? '/usr/bin/google-chrome-stable' : '',
    process.platform === 'linux' ? '/usr/bin/chromium' : '',
    process.platform === 'linux' ? '/usr/bin/chromium-browser' : '',
    process.platform === 'linux' ? '/usr/bin/microsoft-edge' : '',
  ]

  return candidates.find((candidate) => candidate && fs.existsSync(candidate))
}

async function waitForHttpJson(port, pathname, timeoutMs = TIMEOUT_MS) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const payload = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}${pathname}`, (response) => {
          let body = ''
          response.setEncoding('utf8')
          response.on('data', (chunk) => {
            body += chunk
          })
          response.on('end', () => {
            if (response.statusCode >= 200 && response.statusCode < 300) {
              resolve(JSON.parse(body))
            } else {
              reject(new Error(`HTTP ${response.statusCode}`))
            }
          })
        }).on('error', reject)
      })
      return payload
    } catch {
      await delay(150)
    }
  }

  throw new Error(`Chrome DevTools endpoint did not become ready on port ${port}`)
}

async function createDevToolsPage(port) {
  await requestDevTools(port, '/json/new?about:blank')
  const pages = await waitForHttpJson(port, '/json/list')
  const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
  assert(page, 'Could not create a Chrome DevTools page')
  return page
}

async function requestDevTools(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        method: 'PUT',
        path: pathname,
        port,
      },
      (response) => {
        response.resume()
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) resolve()
          else reject(new Error(`DevTools request failed: HTTP ${response.statusCode}`))
        })
      }
    )
    request.on('error', reject)
    request.end()
  })
}

async function assertHttpReachable(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    })
    assert(response.ok, `Route is not reachable: ${url}`, { status: response.status })
  } finally {
    clearTimeout(timer)
  }
}

async function startBrowser() {
  const executable = findBrowserExecutable()
  assert(
    executable,
    'Chrome or Edge was not found. Set CHROME_PATH to run the web beta smoke without adding npm dependencies.'
  )

  const port = await findFreePort()
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaufklug-smoke-'))
  const browser = spawn(
    executable,
    [
      '--headless=new',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--no-default-browser-check',
      '--no-first-run',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )

  browser.stderr.on('data', () => {})
  await waitForHttpJson(port, '/json/version')
  const page = await createDevToolsPage(port)
  const cdp = new CdpConnection(page.webSocketDebuggerUrl)
  await cdp.connect()

  return {
    cdp,
    cleanup: async () => {
      cdp.close()
      browser.kill()
      await delay(250)
      fs.rmSync(userDataDir, { force: true, recursive: true })
    },
  }
}

async function configurePage(cdp, viewport) {
  await cdp.command('Page.enable')
  await cdp.command('Runtime.enable')
  await cdp.command('Log.enable')
  if (SMOKE_API_BASE_URL) {
    await cdp.command('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__SM_API__ = ${JSON.stringify(SMOKE_API_BASE_URL)};`,
    })
  }
  await cdp.command('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  })
}

async function navigate(cdp, url) {
  try {
    await assertHttpReachable(url)
  } catch (error) {
    if (!/^https:\/\//i.test(url)) throw error
    logStep(`route preflight skipped for ${url}: ${error.message}`)
  }
  await cdp.command('Page.navigate', { url })
  await waitForCondition(cdp, 'document.readyState === "complete"', TIMEOUT_MS)
  await delay(500)
}

async function evaluate(cdp, expression) {
  const result = await cdp.command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: TIMEOUT_MS,
  })

  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Runtime.evaluate failed'
    )
  }

  return result.result?.value
}

async function waitForCondition(cdp, expression, timeoutMs = TIMEOUT_MS) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(cdp, expression)) return
    await delay(250)
  }

  throw new Error(`Timed out waiting for condition: ${expression}`)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pageAuditExpression() {
  return `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const isVisible = (element) => {
      if (!element || !element.isConnected) return false
      const style = window.getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    const visibleElements = Array.from(document.body.querySelectorAll('body *')).filter(isVisible)
    const visibleText = normalize(document.body.innerText)
    const visibleSignals = visibleElements.map((element) => normalize([
      element.innerText,
      element.getAttribute('aria-label'),
      element.getAttribute('alt'),
      element.getAttribute('title'),
      element.getAttribute('href'),
      element.getAttribute('src'),
    ].filter(Boolean).join(' '))).filter(Boolean)
    const heroMarketLine = document.querySelector('.search-landing-hero__markets')
    const unitPriceLabels = Array.from(document.querySelectorAll('.user-card__unit-price-label'))
      .filter(isVisible)
      .map((element) => normalize(element.textContent))
    const topDealsNav = document.querySelector('[aria-label="Top Deals heute"]')
    const searchEntryGuidance = document.querySelector('.search-entry-guidance')
    const searchTopDealsEntry = searchEntryGuidance?.querySelector('a[href="/top-deals"]')
    const sparNotice = document.querySelector('.limited-coverage-notice--spar')
    const sparDetails = sparNotice?.querySelector('.limited-coverage-notice__details')
    const mainSearchInput = document.querySelector('.search-first-page .keyword-search-form input')
    const topDealCards = Array.from(document.querySelectorAll('.top-deals-results .user-card')).filter(isVisible).map((element) => ({
      text: normalize(element.textContent),
      retailer: normalize(element.querySelector('.user-card__retailer-badge')?.textContent),
      retailerKey: normalize(element.getAttribute('data-retailer-key')),
      hasImage: Boolean(element.querySelector('.product-image img')),
      mode: normalize(element.querySelector('.user-card__top-deal')?.getAttribute('data-top-deal-mode')),
      hasPrice: Boolean(element.querySelector('.user-card__price strong')),
      hasUnitPrice: Boolean(element.querySelector('.user-card__unit-price-callout'))
        || /\\/\\s*(?:kg|l|Stk)\\b/.test(normalize(element.querySelector('.user-card__top-deal')?.textContent)),
      hasTopDeal: Boolean(element.querySelector('.user-card__top-deal')),
      hasValidity: Boolean(element.querySelector('.user-card__meta-pill--validity')),
    }))
    const topDealsDiscovery = document.querySelector('.top-deals-discovery')
    const topDealsDiscoveryLinks = Array.from(topDealsDiscovery?.querySelectorAll('a') || []).map((element) => ({
      text: normalize(element.textContent),
      href: normalize(element.getAttribute('href')),
      availableCount: Number(element.getAttribute('data-available-count') || 0),
      mode: normalize(element.getAttribute('data-filter-mode')),
      visible: isVisible(element),
    }))
    const resultCardRetailers = Array.from(document.querySelectorAll('.keyword-search-results .user-card'))
      .filter(isVisible)
      .map((element) => normalize(element.querySelector('.user-card__retailer-badge')?.textContent))
      .filter(Boolean)
    const comparisonCards = Array.from(document.querySelectorAll('.user-card__comparison')).filter(isVisible).map((element) => ({
      type: normalize(element.getAttribute('data-comparison-type')),
      text: normalize(element.textContent),
      open: Boolean(element.open),
      retailer: normalize(element.querySelector('.user-card__retailer-badge')?.textContent),
      hasLabel: Boolean(element.querySelector('.user-card__comparison-label')),
      hasReason: Boolean(element.querySelector('.user-card__comparison-reason')),
      hasPrice: Boolean(element.querySelector('.user-card__comparison-price strong')),
      hasUnitPrice: Boolean(element.querySelector('.user-card__comparison-price span')),
      hasCondition: Boolean(element.querySelector('.user-card__comparison-condition')),
      hasFacts: Boolean(element.querySelector('.user-card__comparison-facts')),
    }))
    const browseRetailerButtons = Array.from(document.querySelectorAll('.browse-page .selection-block .retailer-chip')).map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        text: normalize(element.textContent),
        visible: isVisible(element),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
      }
    }).filter((item) => item.visible)

    return {
      bodyText: visibleText,
      h1Texts: Array.from(document.querySelectorAll('h1')).map((element) => normalize(element.innerText)),
      visibleSignals,
      heroMarketLine: isVisible(heroMarketLine) ? normalize(heroMarketLine.textContent) : '',
      unitPriceLabels,
      topDealsNavVisible: isVisible(topDealsNav),
      topDealsNavClass: normalize(topDealsNav?.className),
      topDealsNavActive: Boolean(topDealsNav?.classList.contains('page-nav__button--active')),
      topDealsAnimationName: topDealsNav ? window.getComputedStyle(topDealsNav).animationName : '',
      searchEntryGuidance: isVisible(searchEntryGuidance) ? normalize(searchEntryGuidance.textContent) : '',
      searchTopDealsEntryVisible: isVisible(searchTopDealsEntry),
      searchTopDealsEntryText: normalize(searchTopDealsEntry?.textContent),
      searchTopDealsEntryHref: normalize(searchTopDealsEntry?.getAttribute('href')),
      sparNoticeVisible: isVisible(sparNotice),
      sparNoticeText: normalize(sparNotice?.textContent),
      sparDetailsOpen: Boolean(sparDetails?.open),
      sparDetailsSummary: normalize(sparDetails?.querySelector('summary')?.textContent),
      mainSearchVisible: isVisible(mainSearchInput),
      mainSearchAnimationName: mainSearchInput ? window.getComputedStyle(mainSearchInput).animationName : '',
      topDealCards,
      topDealsDiscoveryVisible: isVisible(topDealsDiscovery),
      topDealsDiscoveryText: normalize(topDealsDiscovery?.textContent),
      topDealsDiscoveryLinks,
      resultCardRetailers,
      comparisonCards,
      browseRetailerButtons,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: window.innerWidth,
      visibleErrorTexts: Array.from(document.querySelectorAll('.status--error, .error-box, [role="alert"]'))
        .filter(isVisible)
        .map((element) => normalize(element.innerText || element.textContent)),
      resultCardCount: document.querySelectorAll('.user-card, .offer-card, .shopping-list-item').length,
      resultsCountText: normalize(document.querySelector('.results-count-box, .keyword-search-results .panel__header p')?.innerText),
      shoppingSummaryVisible: Boolean(Array.from(document.querySelectorAll('.shopping-check, .shopping-list-hero')).find(isVisible)),
      homeContentText: normalize(Array.from(document.querySelectorAll('.home-steps-section, .home-discovery-section, .seo-footer-links')).map((element) => element.textContent).join(' ')),
    }
  })()`
}

function assertNoForbiddenVisibleCopy(audit, context) {
  const lowerBodyText = audit.bodyText.toLocaleLowerCase('de-AT')
  const lowerSignals = audit.visibleSignals.map((signal) => signal.toLocaleLowerCase('de-AT'))

  for (const copy of FORBIDDEN_VISIBLE_COPY) {
    const lowerCopy = copy.toLocaleLowerCase('de-AT')
    assert(!lowerBodyText.includes(lowerCopy), `${context}: forbidden visible copy found: ${copy}`)
    assert(
      !lowerSignals.some((signal) => signal.includes(lowerCopy)),
      `${context}: forbidden visible signal found: ${copy}`
    )
  }

  for (const pattern of FORBIDDEN_VISIBLE_PATTERNS) {
    assert(!pattern.test(audit.bodyText), `${context}: forbidden visible pattern found: ${pattern}`)
    assert(
      !audit.visibleSignals.some((signal) => pattern.test(signal)),
      `${context}: forbidden visible signal pattern found: ${pattern}`
    )
  }
}

function assertNoVisibleErrors(audit, context) {
  const explicitErrors = audit.visibleErrorTexts.filter(Boolean)
  assert(explicitErrors.length === 0, `${context}: visible error state found`, { explicitErrors })

  const errorPatterns = [
    /Die Suche konnte nicht geladen werden/i,
    /Die Angebote konnten gerade nicht geladen werden/i,
    /Request failed/i,
    /Unhandled/i,
  ]

  for (const pattern of errorPatterns) {
    assert(!pattern.test(audit.bodyText), `${context}: visible error copy found: ${pattern}`)
  }
}

function assertNoHorizontalOverflow(audit, context) {
  assert(
    audit.scrollWidth <= audit.viewportWidth + 2,
    `${context}: horizontal overflow detected`,
    { scrollWidth: audit.scrollWidth, viewportWidth: audit.viewportWidth }
  )
}

async function auditCurrentPage(cdp, context) {
  const audit = await evaluate(cdp, pageAuditExpression())
  assertNoForbiddenVisibleCopy(audit, context)
  assertNoVisibleErrors(audit, context)
  return audit
}

async function runHomeCheck(cdp) {
  logStep('checking / on mobile viewport')
  await configurePage(cdp, { width: MOBILE_WIDTH, height: MOBILE_HEIGHT, mobile: true })
  await navigate(cdp, makeUrl('/'))
  await waitForCondition(
    cdp,
    `document.body.innerText.includes(${JSON.stringify(SPAR_TRUST_TITLE)}) && Array.from(document.querySelectorAll('h1')).some((element) => element.innerText.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(HERO_TEXT)})`
  )

  const audit = await auditCurrentPage(cdp, 'home')
  assert(audit.h1Texts.includes(HERO_TEXT), `home: hero headline must be exactly "${HERO_TEXT}"`, { h1Texts: audit.h1Texts })
  assert(audit.bodyText.includes(HERO_SUBLINE), 'home: final hero subline must be visible')
  assert(audit.heroMarketLine === HERO_MARKETS, 'home: final market line must be visible', {
    actual: audit.heroMarketLine,
    expected: HERO_MARKETS,
  })
  assert(audit.sparNoticeVisible && audit.sparNoticeText.includes(SPAR_TRUST_TITLE), 'home: compact SPAR trust notice must remain visible')
  assert(!audit.sparDetailsOpen && audit.sparDetailsSummary === 'Mehr erfahren', 'home: SPAR details must start compact and remain accessible')
  assert(!audit.bodyText.includes('Aktuelle Angebote finden.'), 'home: old hero headline must be absent')
  assert(audit.topDealsNavVisible, 'home: Top Deals header button must be visible')
  assert(audit.topDealsNavClass.includes('page-nav__top-deals'), 'home: Top Deals must be a distinct secondary CTA')
  assert(audit.mainSearchVisible, 'home: primary product search must be visible early')
  assert(audit.searchEntryGuidance === 'Suche ein Produkt – oder starte mit den Top Deals. Top Deals heute ansehen', 'home: search guidance must be visible', {
    actual: audit.searchEntryGuidance,
  })
  assert(audit.searchTopDealsEntryVisible && audit.searchTopDealsEntryText === 'Top Deals heute ansehen' && audit.searchTopDealsEntryHref === '/top-deals', 'home: secondary Top Deals entry must be usable beside the main search')
  assert(audit.homeContentText.includes('Direkt zu beliebten Angeboten'), 'home: popular-offer navigation heading must be visible')
  assert(!audit.bodyText.includes('Angebote schneller finden'), 'home: old technical offer-navigation heading must be absent')
  assert(/Preis pro Einheit, Bedingungen und passende Alternativen/.test(audit.homeContentText), 'home: comparison step must explain safe alternatives')
  assertNoHorizontalOverflow(audit, 'home')
}

async function runSearchCheck(cdp) {
  logStep('checking /suche?q=kaffee on desktop viewport')
  await configurePage(cdp, { width: DESKTOP_WIDTH, height: DESKTOP_HEIGHT, mobile: false })
  await navigate(cdp, makeUrl('/suche?q=kaffee'))
  await waitForCondition(
    cdp,
    `document.body.innerText.includes('Angebote für') || document.body.innerText.includes('Angebote fÃ¼r') || document.body.innerText.includes('Die Angebote konnten gerade nicht geladen werden') || document.querySelectorAll('.user-card, .offer-card').length > 0`,
    TIMEOUT_MS
  )

  const audit = await auditCurrentPage(cdp, 'search')
  assert(audit.h1Texts.includes(HERO_TEXT), 'search: final hero headline must remain visible')
  assert(!audit.unitPriceLabels.some((label) => /vergleichspreis/i.test(label)), 'search: old unit-price label found')
  assert(
    audit.unitPriceLabels.every((label) => ['PREIS PRO LITER', 'PREIS PRO KG', 'PREIS PRO STÜCK', 'PREIS PRO EINHEIT'].includes(label)),
    'search: unexpected public unit-price label found',
    { unitPriceLabels: audit.unitPriceLabels }
  )
  const hasCards = audit.resultCardCount > 0
  const hasPlausibleResultCount = /\d+\s+(von\s+\d+\s+)?Angebote/.test(audit.resultsCountText)
  assert(hasCards || hasPlausibleResultCount, 'search: expected visible cards or a plausible result count', {
    resultCardCount: audit.resultCardCount,
    resultsCountText: audit.resultsCountText,
  })
  const resultCountNumbers = (audit.resultsCountText.match(/\d+/g) || []).map(Number)
  assert(
    audit.resultCardCount > 10 || resultCountNumbers.some((count) => count > 10),
    'search: normal result list appears constrained to the Top Deals limit',
    { resultCardCount: audit.resultCardCount, resultsCountText: audit.resultsCountText }
  )
  assert(audit.resultCardRetailers.some((retailer) => !/^Billa(?: Plus)?$/i.test(retailer)), 'search: unfiltered coffee results must not render as BILLA-family only', {
    resultCardRetailers: audit.resultCardRetailers,
  })
}

async function runMultiRetailerCoverageCheck(cdp) {
  logStep('checking unfiltered retailer coverage for detergent search')
  await configurePage(cdp, { width: DESKTOP_WIDTH, height: DESKTOP_HEIGHT, mobile: false })
  await navigate(cdp, makeUrl('/suche?q=waschmittel'))
  await waitForCondition(cdp, `document.querySelectorAll('.keyword-search-results .user-card').length > 0`, TIMEOUT_MS)

  const audit = await auditCurrentPage(cdp, 'search-retailer-coverage')
  const retailerNames = new Set(audit.resultCardRetailers.map((retailer) => retailer.toLocaleLowerCase('de-AT')))
  assert(retailerNames.has('bipa'), 'search-retailer-coverage: BIPA must be visible without an explicit retailer filter', { resultCardRetailers: audit.resultCardRetailers })
  assert(retailerNames.has('dm'), 'search-retailer-coverage: dm must be visible without an explicit retailer filter', { resultCardRetailers: audit.resultCardRetailers })
  assert(retailerNames.has('müller'), 'search-retailer-coverage: Müller must be visible without an explicit retailer filter', { resultCardRetailers: audit.resultCardRetailers })
  assert(retailerNames.size >= 4, 'search-retailer-coverage: expected multiple public retailers', { resultCardRetailers: audit.resultCardRetailers })
  assertNoHorizontalOverflow(audit, 'search-retailer-coverage')

  await evaluate(cdp, `document.querySelector('.keyword-search-toggle input')?.click()`)
  await waitForCondition(cdp, `Boolean(document.querySelector('.keyword-search-market-filter'))`, TIMEOUT_MS)
  await evaluate(cdp, `(() => {
    const button = Array.from(document.querySelectorAll('.keyword-search-market-chip'))
      .find((element) => element.getAttribute('aria-label')?.startsWith('Müller '))
    button?.click()
    return Boolean(button)
  })()`)
  await waitForCondition(cdp, `(() => {
    const cards = Array.from(document.querySelectorAll('.keyword-search-results .user-card'))
    return cards.length > 0 && cards.every((card) => card.querySelector('.user-card__retailer-badge')?.textContent.trim() === 'Müller')
  })()`, TIMEOUT_MS)

  const filteredAudit = await auditCurrentPage(cdp, 'search-retailer-filter')
  assert(filteredAudit.resultCardRetailers.length > 0 && filteredAudit.resultCardRetailers.every((retailer) => retailer === 'Müller'), 'search-retailer-filter: explicit Müller filter must show Müller only', {
    resultCardRetailers: filteredAudit.resultCardRetailers,
  })

  await evaluate(cdp, `(() => {
    const button = Array.from(document.querySelectorAll('.keyword-search-market-filter button'))
      .find((element) => element.textContent.includes('Märkte zurücksetzen'))
    button?.click()
    return Boolean(button)
  })()`)
  await waitForCondition(cdp, `(() => {
    const retailers = new Set(Array.from(document.querySelectorAll('.keyword-search-results .user-card .user-card__retailer-badge')).map((element) => element.textContent.trim()))
    return retailers.has('BIPA') && retailers.has('dm') && retailers.has('Müller')
  })()`, TIMEOUT_MS)

  const resetAudit = await auditCurrentPage(cdp, 'search-retailer-reset')
  assert(!resetAudit.bodyText.includes('Märkte zurücksetzen'), 'search-retailer-reset: reset must disable the explicit market scope')
  assertNoHorizontalOverflow(resetAudit, 'search-retailer-reset')
}

async function runBrowseCheck(cdp) {
  logStep('checking /stoebern on mobile viewport')
  await configurePage(cdp, { width: MOBILE_WIDTH, height: MOBILE_HEIGHT, mobile: true })
  await navigate(cdp, makeUrl('/stoebern'))
  await waitForCondition(
    cdp,
    `document.body.innerText.includes('Märkte auswählen') || document.body.innerText.includes('MÃ¤rkte auswÃ¤hlen') || document.querySelectorAll('.browse-page .selection-block .retailer-chip').length > 0`,
    TIMEOUT_MS
  )

  const audit = await auditCurrentPage(cdp, 'browse')
  assert(/Stöbern|StÃ¶bern/.test(audit.bodyText), 'browse: intro must be visible')
  assert(/Märkte auswählen|MÃ¤rkte auswÃ¤hlen/.test(audit.bodyText), 'browse: market selector must be visible')
  assert(audit.browseRetailerButtons.length >= 2, 'browse: expected visible market buttons')
  const browseRetailerText = audit.browseRetailerButtons.map((button) => button.text).join(' | ')
  for (const retailer of ['Billa', 'Billa Plus', 'Lidl', 'PENNY', 'dm', 'BIPA', 'Müller', 'INTERSPAR']) {
    assert(audit.browseRetailerButtons.some((button) => new RegExp(`^${retailer}(?:\\d|\\s|$)`, 'i').test(button.text)), `browse: ${retailer} market button must be visible`, { browseRetailerText })
  }
  assert(!audit.browseRetailerButtons.some((button) => /^(?:SPAR|EUROSPAR|PAGRO|HOFER)(?:\d|\s|$)/i.test(button.text)), 'browse: unavailable public market button found', { browseRetailerText })
  assert(audit.bodyText.includes(SPAR_TRUST_TITLE), 'browse: SPAR trust notice must remain visible')
  assert(!audit.sparDetailsOpen && audit.sparDetailsSummary === 'Mehr erfahren', 'browse: SPAR details must start compact')
  assert(!audit.unitPriceLabels.some((label) => /vergleichspreis/i.test(label)), 'browse: old unit-price label found')

  await evaluate(cdp, `(() => {
    const button = Array.from(document.querySelectorAll('.browse-page .ghost-button'))
      .find((element) => element.textContent.includes('Alle auswählen'))
    button?.click()
    return Boolean(button)
  })()`)
  await waitForCondition(cdp, `(() => {
    const buttons = Array.from(document.querySelectorAll('.browse-page .selection-block .retailer-chip'))
    return buttons.length >= 8 && buttons.every((button) => button.getAttribute('aria-pressed') === 'true')
  })()`, TIMEOUT_MS)
  await evaluate(cdp, `(() => {
    const button = Array.from(document.querySelectorAll('.browse-page .ghost-button'))
      .find((element) => element.textContent.includes('Geschäfte zurücksetzen'))
    button?.click()
    return Boolean(button)
  })()`)
  await waitForCondition(cdp, `Array.from(document.querySelectorAll('.browse-page .selection-block .retailer-chip')).every((button) => button.getAttribute('aria-pressed') === 'false')`, TIMEOUT_MS)

  const firstRowTop = audit.browseRetailerButtons[0]?.top
  const firstRowButtons = audit.browseRetailerButtons.filter((button) => Math.abs(button.top - firstRowTop) <= 4)
  assert(firstRowButtons.length >= 2, 'browse: mobile market buttons appear to be a single endless column', {
    firstRowButtons,
    visibleButtonCount: audit.browseRetailerButtons.length,
  })
  assertNoHorizontalOverflow(audit, 'browse')
}

async function runComparisonMobileCheck(cdp) {
  logStep('checking comparison accordion on mobile viewport')
  await configurePage(cdp, { width: MOBILE_WIDTH, height: MOBILE_HEIGHT, mobile: true })
  await navigate(cdp, makeUrl('/suche?q=bier'))
  await waitForCondition(cdp, `document.querySelectorAll('.user-card__comparison').length > 0`, TIMEOUT_MS)
  await evaluate(cdp, `(() => {
    const comparison = document.querySelector('.user-card__comparison')
    if (!comparison) return false
    comparison.open = true
    comparison.scrollIntoView({ block: 'center' })
    return true
  })()`)
  await delay(250)

  const audit = await auditCurrentPage(cdp, 'comparison-mobile')
  const comparison = audit.comparisonCards.find((item) => item.open)
  assert(comparison, 'comparison-mobile: expected an open comparison accordion')
  assert(['cheaper_alternative', 'similar_alternative'].includes(comparison.type), 'comparison-mobile: unknown comparison type', { comparison })
  assert(!/^(SPAR|EUROSPAR|INTERSPAR|HOFER|PAGRO)$/i.test(comparison.retailer), 'comparison-mobile: excluded retailer found', { comparison })
  assert(comparison.hasLabel && comparison.hasReason, 'comparison-mobile: label or reason is missing', { comparison })
  assert(comparison.hasPrice && comparison.hasUnitPrice, 'comparison-mobile: price or unit price is missing', { comparison })
  assert(comparison.hasCondition && comparison.hasFacts, 'comparison-mobile: condition or offer facts are missing', { comparison })
  assert(/Gleiche Kategorie/.test(comparison.text), 'comparison-mobile: similarity reason is missing', { comparison })
  assert(audit.resultCardRetailers.some((retailer) => /^PENNY$/i.test(retailer)), 'comparison-mobile: unfiltered beer results must include PENNY', {
    resultCardRetailers: audit.resultCardRetailers,
  })
  assertNoHorizontalOverflow(audit, 'comparison-mobile')
}

async function runTopDealsCheck(cdp) {
  logStep('checking /top-deals on mobile viewport')
  await configurePage(cdp, { width: MOBILE_WIDTH, height: MOBILE_HEIGHT, mobile: true })
  await navigate(cdp, makeUrl('/top-deals'))
  await waitForCondition(
    cdp,
    `Array.from(document.querySelectorAll('h1')).some((element) => element.innerText.trim() === 'Top Deals heute') && (document.querySelectorAll('.top-deals-results .user-card').length > 0 || document.body.innerText.includes('Heute sind noch nicht genug verifizierte Vergleichswerte verfügbar') || document.body.innerText.includes('Die Top Deals konnten gerade nicht geladen werden'))`,
    TIMEOUT_MS
  )

  const audit = await auditCurrentPage(cdp, 'top-deals')
  assert(audit.topDealsNavVisible, 'top-deals: sticky header button must be visible')
  assert(audit.topDealsNavActive, 'top-deals: sticky header CTA must expose its active state')
  assert(audit.h1Texts.includes('Top Deals heute'), 'top-deals: title must be visible')
  assert(audit.topDealCards.length <= 20, 'top-deals: at most twenty cards are allowed')
  assert(audit.topDealsDiscoveryVisible, 'top-deals: category and retailer discovery must be visible')
  assert(
    audit.topDealsDiscoveryText.includes('Top Deals nach Kategorie und Markt')
      && audit.topDealsDiscoveryText.includes('Finde die stärksten verifizierten Ersparnisse gezielt nach Bereich oder Händler.'),
    'top-deals: discovery title or explanation is missing'
  )
  const visibleDiscoveryLinks = audit.topDealsDiscoveryLinks.filter((link) => link.visible)
  const discoveryHrefs = visibleDiscoveryLinks.map((link) => link.href)
  assert(visibleDiscoveryLinks.some((link) => /[?&]category=/.test(link.href)), 'top-deals: no available category link is visible', {
    visibleDiscoveryLinks,
  })
  assert(visibleDiscoveryLinks.some((link) => /[?&]retailer=/.test(link.href)), 'top-deals: no available retailer link is visible', {
    visibleDiscoveryLinks,
  })
  assert(
    visibleDiscoveryLinks.every((link) => link.availableCount > 0),
    'top-deals: visible discovery link has no safe available deal',
    { visibleDiscoveryLinks }
  )
  assert(
    visibleDiscoveryLinks
      .filter((link) => /[?&]retailer=/.test(link.href))
      .every((link) => ['strict', 'retailer_discount_fallback'].includes(link.mode)),
    'top-deals: retailer discovery link has no supported mode',
    { visibleDiscoveryLinks }
  )
  assert(
    discoveryHrefs.every((href) => !/[?&]retailer=(?:spar|eurospar|hofer|pagro)(?:&|$)/.test(href)),
    'top-deals: excluded retailer must not be discoverable',
    { discoveryHrefs }
  )

  for (const card of audit.topDealCards) {
    assert(!/^(SPAR|EUROSPAR|INTERSPAR|HOFER|PAGRO)$/i.test(card.retailer), 'top-deals: excluded retailer found', { card })
    assert(card.mode === 'strict', 'top-deals: global list must remain strict', { card })
    assert(card.hasUnitPrice, 'top-deals: safe unit price is missing', { card })
    assert(card.hasTopDeal && /statt/.test(card.text), 'top-deals: reference unit price is missing', { card })
    assert(card.hasValidity, 'top-deals: validity is missing', { card })
    assert(card.hasPrice, 'top-deals: current price is missing', { card })
  }
  assertNoHorizontalOverflow(audit, 'top-deals')

  await navigate(cdp, makeUrl('/top-deals?retailer=spar'))
  await waitForCondition(
    cdp,
    `document.body.innerText.includes('Noch keine sicheren Top Deals') || document.body.innerText.includes('Die Top Deals konnten gerade nicht geladen werden')`,
    TIMEOUT_MS
  )
  const excludedFilterAudit = await auditCurrentPage(cdp, 'top-deals-excluded-filter')
  assert(excludedFilterAudit.topDealCards.length === 0, 'top-deals: excluded direct filter must not fall back to global deals', {
    topDealCards: excludedFilterAudit.topDealCards,
  })
  assert(
    excludedFilterAudit.bodyText.includes('Noch keine sicheren Top Deals'),
    'top-deals: excluded direct filter must show the honest empty state'
  )
  assertNoHorizontalOverflow(excludedFilterAudit, 'top-deals-excluded-filter')
}

async function runReducedMotionCheck(cdp) {
  logStep('checking reduced-motion entry treatment')
  await configurePage(cdp, { width: DESKTOP_WIDTH, height: DESKTOP_HEIGHT, mobile: false })
  await cdp.command('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await navigate(cdp, makeUrl('/'))
  await waitForCondition(cdp, `Boolean(document.querySelector('.search-entry-guidance'))`, TIMEOUT_MS)

  const audit = await auditCurrentPage(cdp, 'reduced-motion')
  assert(audit.topDealsAnimationName === 'none', 'reduced-motion: Top Deals animation must be disabled', {
    animationName: audit.topDealsAnimationName,
  })
  assert(audit.mainSearchAnimationName === 'none', 'reduced-motion: search animation must be disabled', {
    animationName: audit.mainSearchAnimationName,
  })
  await cdp.command('Emulation.setEmulatedMedia', { features: [] })
}

async function runShoppingListCheck(cdp) {
  logStep('checking /einkaufsliste on desktop viewport')
  await configurePage(cdp, { width: DESKTOP_WIDTH, height: DESKTOP_HEIGHT, mobile: false })
  await navigate(cdp, makeUrl('/einkaufsliste'))
  await waitForCondition(cdp, `document.body.innerText.includes('Einkaufsliste')`, TIMEOUT_MS)

  const audit = await auditCurrentPage(cdp, 'shopping-list')
  assert(audit.shoppingSummaryVisible, 'shopping-list: expected empty or populated summary area')
  assert(!/garantiert|garantiert sparen|immer günstigster Preis|bester Preis/i.test(audit.bodyText), 'shopping-list: guarantee claim copy found')

  logStep('checking /liste route reachability')
  await navigate(cdp, makeUrl('/liste'))
  await waitForCondition(cdp, `document.body.innerText.includes('Einkaufsliste')`, TIMEOUT_MS)
  await auditCurrentPage(cdp, 'liste')
}

async function main() {
  logStep(`base url: ${BASE_URL}`)
  const { cdp, cleanup } = await startBrowser()
  const runtimeErrors = []

  cdp.on('Runtime.exceptionThrown', (params) => {
    runtimeErrors.push(params.exceptionDetails?.text || params.exceptionDetails?.exception?.description || 'Runtime exception')
  })
  cdp.on('Log.entryAdded', (params) => {
    if (params.entry?.level === 'error') runtimeErrors.push(params.entry.text)
  })

  try {
    await runHomeCheck(cdp)
    await runReducedMotionCheck(cdp)
    if (!HOME_ONLY) {
      await runSearchCheck(cdp)
      await runMultiRetailerCoverageCheck(cdp)
      await runComparisonMobileCheck(cdp)
      await runBrowseCheck(cdp)
      await runTopDealsCheck(cdp)
      await runShoppingListCheck(cdp)
    }

    const relevantRuntimeErrors = runtimeErrors.filter((message) => {
      return !/favicon|manifest/i.test(String(message || ''))
    })
    assert(relevantRuntimeErrors.length === 0, 'JavaScript/browser errors were reported', { relevantRuntimeErrors })

    logStep('passed')
  } finally {
    await cleanup()
  }
}

main().catch((error) => {
  const details = error instanceof SmokeError && error.details ? `\n${JSON.stringify(error.details, null, 2)}` : ''
  console.error(`[web-beta-smoke] failed: ${error.message}${details}`)
  process.exitCode = 1
})
