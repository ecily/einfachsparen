const assert = require('node:assert/strict');
const net = require('node:net');
const test = require('node:test');
const express = require('express');
const { createFeedbackRouter } = require('../src/routes/feedback.routes');
const {
  DEFAULT_FEEDBACK_EMAIL_TO,
  getSmtpAuthMechanisms,
  selectSmtpAuthMechanism,
  sendBetaFeedbackEmail,
  sendSmtpMail,
} = require('../src/services/feedbackEmailService');

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

function createTestApp({
  created = [],
  updates = [],
  emailSender = async () => ({ status: 'skipped', error: null }),
  emailTimeoutMs = 7000,
} = {}) {
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
    emailTimeoutMs,
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
  assert.equal(response.body.emailDeliveryConfigured, true);
  assert.equal(response.body.emailDeliveryDiagnostic, null);
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
    emailSender: async () => ({ status: 'skipped', error: 'missing SMTP_HOST, SMTP_FROM', configured: false }),
  });
  const response = await requestJson(app, {
    body: validFeedback(),
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.emailDeliveryStatus, 'skipped');
  assert.equal(response.body.emailDeliveryConfigured, false);
  assert.match(response.body.emailDeliveryDiagnostic, /SMTP_HOST/);
  assert.equal(created.length, 1);
  assert.equal(updates[0].update.emailDeliveryStatus, 'skipped');
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
  assert.equal(response.body.emailDeliveryDiagnostic, 'smtp unavailable');
  assert.equal(updates[0].update.emailDeliveryStatus, 'failed');
  assert.equal(updates[0].update.emailDeliveryError, 'smtp unavailable');
});

test('POST /api/feedback stores feedback even when email sender throws', async () => {
  const created = [];
  const updates = [];
  const app = createTestApp({
    created,
    updates,
    emailSender: async () => {
      throw new Error('smtp crashed');
    },
  });
  const response = await requestJson(app, {
    body: validFeedback(),
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.emailDeliveryStatus, 'failed');
  assert.equal(created.length, 1);
  assert.equal(updates[0].update.emailDeliveryStatus, 'failed');
  assert.equal(updates[0].update.emailDeliveryError, 'smtp crashed');
});

test('POST /api/feedback times out hanging email sender and still stores feedback', async () => {
  const created = [];
  const updates = [];
  const app = createTestApp({
    created,
    updates,
    emailTimeoutMs: 30,
    emailSender: async () => new Promise(() => {}),
  });
  const startedAt = Date.now();
  const response = await requestJson(app, {
    body: validFeedback(),
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.emailDeliveryStatus, 'timeout');
  assert.equal(response.body.emailDeliveryConfigured, true);
  assert.match(response.body.emailDeliveryDiagnostic, /timed out/i);
  assert.equal(created.length, 1);
  assert.equal(updates[0].update.emailDeliveryStatus, 'timeout');
  assert.match(updates[0].update.emailDeliveryError, /timed out/i);
  assert.ok(elapsedMs < 1000, `expected timeout response under 1000ms, got ${elapsedMs}ms`);
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

test('sendBetaFeedbackEmail reports skipped without SMTP env', async () => {
  const result = await sendBetaFeedbackEmail(validFeedback(), {
    envConfig: {
      FEEDBACK_EMAIL_TO: 'andreas.franz@ecily.com',
      SMTP_HOST: '',
      SMTP_PORT: 587,
      SMTP_FROM: '',
    },
  });

  assert.equal(result.status, 'skipped');
  assert.deepEqual(result.to, [DEFAULT_FEEDBACK_EMAIL_TO]);
  assert.equal(result.configured, false);
  assert.match(result.error, /SMTP_HOST/);
});

test('getSmtpAuthMechanisms parses advertised EHLO auth capabilities', () => {
  const mechanisms = getSmtpAuthMechanisms([
    '250-example.test Hello',
    '250-STARTTLS',
    '250-AUTH LOGIN XOAUTH2',
    '250 SIZE 157286400',
  ].join('\r\n'));

  assert.deepEqual(mechanisms, ['LOGIN', 'XOAUTH2']);
});

test('selectSmtpAuthMechanism uses AUTH LOGIN for Microsoft 365', () => {
  const mechanism = selectSmtpAuthMechanism({
    SMTP_HOST: 'smtp.office365.com',
  }, [
    '250-smtp.office365.com Hello',
    '250-AUTH LOGIN XOAUTH2',
    '250 SIZE 157286400',
  ].join('\r\n'));

  assert.equal(mechanism, 'LOGIN');
});

test('selectSmtpAuthMechanism uses AUTH LOGIN for Brevo SMTP relay', () => {
  const mechanism = selectSmtpAuthMechanism({
    SMTP_HOST: 'smtp-relay.brevo.com',
  }, [
    '250-smtp-relay.brevo.com Hello',
    '250-AUTH PLAIN LOGIN CRAM-MD5',
    '250 SIZE 20971520',
  ].join('\r\n'));

  assert.equal(mechanism, 'LOGIN');
});

test('selectSmtpAuthMechanism keeps AUTH PLAIN preference for other SMTP servers', () => {
  const mechanism = selectSmtpAuthMechanism({
    SMTP_HOST: 'smtp.example.test',
  }, [
    '250-smtp.example.test Hello',
    '250-AUTH PLAIN LOGIN',
    '250 SIZE 157286400',
  ].join('\r\n'));

  assert.equal(mechanism, 'PLAIN');
});

test('sendSmtpMail uses AUTH LOGIN when the SMTP server advertises LOGIN only', async () => {
  const commands = [];
  let dataMode = false;
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write('220 smtp.office365.com Microsoft ESMTP MAIL Service ready\r\n');
    socket.on('data', (chunk) => {
      const lines = chunk.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        if (dataMode) {
          if (line === '.') {
            dataMode = false;
            socket.write('250 2.0.0 OK queued\r\n');
          }
          continue;
        }

        commands.push(line);

        if (line.startsWith('EHLO ')) {
          socket.write('250-smtp.office365.com Hello\r\n250-AUTH LOGIN XOAUTH2\r\n250 SIZE 157286400\r\n');
        } else if (line === 'AUTH LOGIN') {
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (line === Buffer.from('andreas.franz@ecily.com', 'utf8').toString('base64')) {
          socket.write('334 UGFzc3dvcmQ6\r\n');
        } else if (line === Buffer.from('secret-password', 'utf8').toString('base64')) {
          socket.write('235 2.7.0 Authentication successful\r\n');
        } else if (line.startsWith('MAIL FROM:')) {
          socket.write('250 2.1.0 Sender OK\r\n');
        } else if (line.startsWith('RCPT TO:')) {
          socket.write('250 2.1.5 Recipient OK\r\n');
        } else if (line === 'DATA') {
          dataMode = true;
          socket.write('354 Start mail input; end with <CRLF>.<CRLF>\r\n');
        } else if (line === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('500 unexpected command\r\n');
        }
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    await sendSmtpMail({
      envConfig: {
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: address.port,
        SMTP_SECURE: false,
        SMTP_REQUIRE_TLS: false,
        SMTP_FROM: 'andreas.franz@ecily.com',
        SMTP_USER: 'andreas.franz@ecily.com',
        SMTP_PASS: 'secret-password',
        FEEDBACK_EMAIL_TO: 'andreas.franz@ecily.com',
        FEEDBACK_EMAIL_TIMEOUT_MS: 1000,
      },
      to: ['andreas.franz@ecily.com'],
      subject: 'SMTP test',
      text: 'Test',
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.equal(commands.includes('AUTH LOGIN'), true);
  assert.equal(commands.includes(`AUTH PLAIN ${Buffer.from('\u0000andreas.franz@ecily.com\u0000secret-password', 'utf8').toString('base64')}`), false);
});

test('sendBetaFeedbackEmail uses andreas feedback recipient fallback when SMTP is configured', async () => {
  let sentMail = null;
  const result = await sendBetaFeedbackEmail(validFeedback(), {
    envConfig: {
      FEEDBACK_EMAIL_TO: '',
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: 587,
      SMTP_FROM: 'noreply@kaufklug.at',
    },
    smtpSender: async (mail) => {
      sentMail = mail;
    },
  });

  assert.equal(result.status, 'sent');
  assert.deepEqual(result.to, [DEFAULT_FEEDBACK_EMAIL_TO]);
  assert.deepEqual(sentMail.to, [DEFAULT_FEEDBACK_EMAIL_TO]);
});

test('sendBetaFeedbackEmail keeps andreas recipient when FEEDBACK_EMAIL_TO override is configured', async () => {
  let sentMail = null;
  const result = await sendBetaFeedbackEmail(validFeedback(), {
    envConfig: {
      FEEDBACK_EMAIL_TO: 'feedback@example.test',
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: 587,
      SMTP_FROM: 'noreply@kaufklug.at',
    },
    smtpSender: async (mail) => {
      sentMail = mail;
    },
  });

  assert.equal(result.status, 'sent');
  assert.deepEqual(result.to, [DEFAULT_FEEDBACK_EMAIL_TO, 'feedback@example.test']);
  assert.deepEqual(sentMail.to, [DEFAULT_FEEDBACK_EMAIL_TO, 'feedback@example.test']);
});
