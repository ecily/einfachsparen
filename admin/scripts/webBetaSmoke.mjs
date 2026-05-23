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
const TIMEOUT_MS = Number(process.env.KAUFKLUG_SMOKE_TIMEOUT_MS || 30000)
const MOBILE_WIDTH = 390
const MOBILE_HEIGHT = 900
const DESKTOP_WIDTH = 1280
const DESKTOP_HEIGHT = 900
const HERO_TEXT = 'Angebote finden. Einfach sparen.'
const TRUST_TEXT = 'Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen.'
const HERO_RETAILERS = ['BILLA', 'BILLA Plus', 'SPAR', 'EUROSPAR', 'INTERSPAR', 'HOFER', 'Lidl', 'dm', 'BIPA', 'PAGRO', 'PENNY']
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
    throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed')
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
    const heroBadges = Array.from(document.querySelectorAll('.hero-market-strip .hero-market-badge')).map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        text: normalize(element.textContent),
        visible: isVisible(element),
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      }
    })
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
      heroBadges,
      browseRetailerButtons,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: window.innerWidth,
      visibleErrorTexts: Array.from(document.querySelectorAll('.status--error, .error-box, [role="alert"]'))
        .filter(isVisible)
        .map((element) => normalize(element.innerText || element.textContent)),
      resultCardCount: document.querySelectorAll('.user-card, .offer-card, .shopping-list-item').length,
      resultsCountText: normalize(document.querySelector('.results-count-box, .keyword-search-results .panel__header p')?.innerText),
      shoppingSummaryVisible: Boolean(Array.from(document.querySelectorAll('.shopping-check, .shopping-list-hero')).find(isVisible)),
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
    `document.body.innerText.includes(${JSON.stringify(TRUST_TEXT)}) && Array.from(document.querySelectorAll('h1')).some((element) => element.innerText.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(HERO_TEXT)})`
  )

  const audit = await auditCurrentPage(cdp, 'home')
  assert(audit.h1Texts.includes(HERO_TEXT), `home: hero headline must be exactly "${HERO_TEXT}"`, { h1Texts: audit.h1Texts })
  assert(audit.bodyText.includes(TRUST_TEXT), `home: trust line must be visible: "${TRUST_TEXT}"`)

  const badgeTexts = audit.heroBadges.filter((badge) => badge.visible).map((badge) => badge.text)
  const missingRetailers = HERO_RETAILERS.filter((retailer) => !badgeTexts.includes(retailer))
  assert(missingRetailers.length === 0, 'home: not all mobile hero retailers are visible', { badgeTexts, missingRetailers })

  const horizontallyClipped = audit.heroBadges.filter(
    (badge) => badge.visible && (badge.left < -1 || badge.right > audit.viewportWidth + 1)
  )
  assert(horizontallyClipped.length === 0, 'home: hero retailer badge is horizontally clipped', { horizontallyClipped })
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
  const hasCards = audit.resultCardCount > 0
  const hasPlausibleResultCount = /\d+\s+(von\s+\d+\s+)?Angebote/.test(audit.resultsCountText)
  assert(hasCards || hasPlausibleResultCount, 'search: expected visible cards or a plausible result count', {
    resultCardCount: audit.resultCardCount,
    resultsCountText: audit.resultsCountText,
  })
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

  const firstRowTop = audit.browseRetailerButtons[0]?.top
  const firstRowButtons = audit.browseRetailerButtons.filter((button) => Math.abs(button.top - firstRowTop) <= 4)
  assert(firstRowButtons.length >= 2, 'browse: mobile market buttons appear to be a single endless column', {
    firstRowButtons,
    visibleButtonCount: audit.browseRetailerButtons.length,
  })
  assertNoHorizontalOverflow(audit, 'browse')
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
    await runSearchCheck(cdp)
    await runBrowseCheck(cdp)
    await runShoppingListCheck(cdp)

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
