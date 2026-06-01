const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { createFeedbackRouter } = require('../src/routes/feedback.routes');
const { sendBetaFeedbackEmail } = require('../src/services/feedbackEmailService');

function requestJson(app, { body = {}, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const payload = JSON.stringify(body);
      const req = require('node:http').request({
        hostname: '127.0.0.1',
        port: address.port,
        path: '/api/feedback',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...headers,
        },
      }, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          server.close();
          resolve({
            statusCode: res.statusCode,
            body: raw ? JSON.parse(raw) : null,
          });
        });
      });

      req.on('error', (error) => {
        server.close();
        reject(error);
      });
      req.end(payload);
    });
  });
}

function createTestApp({ created = [], updates = [], emailSender = async () => ({ status: 'not_configured', error: null }) } = {}) {
  const BetaFeedbackModel = {
    async create(payload) {
      const doc = {
        _id: `beta-feedback-${created.length + 1}`,
        createdAt: new Date('2026-06-01T12:00:00.000Z'),
        ...payload,
      };
      created.push(doc);
      return doc;
    },
    async findByIdAndUpdate(id, update) {
      updates.push({ id, update });
      const doc = created.find((item) => item._id === id);
      if (doc) Object.assign(doc, update);
      return doc;
    },
  };
  const AdminFeedbackModel = {
    async create(payload) {
      return { _id: 'admin-feedback-1', ...payload };
    },
    find() {
      return {
        sort() {
          return {
            limit() {
              return { lean: async () => [] };
            },
          };
        },
      };
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/feedback', createFeedbackRouter({
    AdminFeedbackModel,
    BetaFeedbackModel,
    rateLimitMiddleware: (req, res, next) => next(),
    emailSender,
  }));
  app.use((error, req, res, next) => {
    res.status(error.statusCode || 500).json({
      ok: false,
      message: error.message,
    });
  });
  return app;
}

function validFeedback(overrides = {}) {
  return {
    name: 'Beta Tester',
    email: 'beta@example.test',
    feedbackType: 'market_request',
    featureInterests: ['new_markets', 'optimal_shopping_route'],
    requestedMarkets: 'Unimarkt, Baumarkt',
    message: 'Bitte integriert weitere Maerkte und eine Einkaufsroute fuer den Wocheneinkauf.',
    ...overrides,
  };
}

test('POST /api/feedback rejects missing beta feedback message', async () => {
  const app = createTestApp();
  const response = await requestJson(app, {
    body: validFeedback({ message: '' }),
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.ok, false);
  assert.match(response.body.message, /message ist erforderlich/i);
});

test('POST /api/feedback stores valid beta feedback', async () => {
  const created = [];
  const updates = [];
  const app = createTestApp({
    created,
    updates,
    emailSender: async () => ({ status: 'sent', error: null }),
  });
  const response = await requestJson(app, {
    body: validFeedback(),
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.emailDeliveryStatus, 'sent');
  assert.equal(created.length, 1);
  assert.equal(created[0].message, validFeedback().message);
  assert.equal(created[0].sourcePage, '/feedback');
  assert.equal(updates[0].update.emailDeliveryStatus, 'sent');
});

test('POST /api/feedback succeeds when email is not configured', async () => {
  const created = [];
  const updates = [];
  const app = createTestApp({
    created,
    updates,
    emailSender: async () => ({ status: 'not_configured', error: null }),
  });
  const response = await requestJson(app, {
    body: validFeedback(),
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.emailDeliveryStatus, 'not_configured');
  assert.equal(created.length, 1);
  assert.equal(updates[0].update.emailDeliveryStatus, 'not_configured');
});

test('POST /api/feedback succeeds and records failed email delivery', async () => {
  const updates = [];
  const app = createTestApp({
    updates,
    emailSender: async () => ({ status: 'failed', error: 'smtp unavailable' }),
  });
  const response = await requestJson(app, {
    body: validFeedback(),
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.emailDeliveryStatus, 'failed');
  assert.equal(updates[0].update.emailDeliveryStatus, 'failed');
  assert.equal(updates[0].update.emailDeliveryError, 'smtp unavailable');
});

test('POST /api/feedback neutralizes honeypot submissions without storing', async () => {
  const created = [];
  const app = createTestApp({ created });
  const response = await requestJson(app, {
    body: validFeedback({ website: 'https://spam.example.test' }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(created.length, 0);
});

test('POST /api/feedback stores no IP, user-agent or session fields', async () => {
  const created = [];
  const app = createTestApp({ created });
  await requestJson(app, {
    body: validFeedback({
      ipAddress: '192.0.2.1',
      userAgent: 'not stored',
      sessionId: 'not stored',
      clientContext: { anything: 'not stored' },
    }),
    headers: {
      'user-agent': 'not stored either',
      'x-forwarded-for': '192.0.2.55',
    },
  });

  const stored = JSON.stringify(created[0]);
  assert.equal(stored.includes('ipAddress'), false);
  assert.equal(stored.includes('userAgent'), false);
  assert.equal(stored.includes('sessionId'), false);
  assert.equal(stored.includes('clientContext'), false);
  assert.equal(stored.includes('192.0.2.'), false);
});

test('sendBetaFeedbackEmail reports not_configured without SMTP env', async () => {
  const result = await sendBetaFeedbackEmail(validFeedback(), {
    envConfig: {
      FEEDBACK_EMAIL_TO: 'andreas.franz@ecily.com',
      SMTP_HOST: '',
      SMTP_PORT: 587,
      SMTP_FROM: '',
    },
  });

  assert.equal(result.status, 'not_configured');
});
