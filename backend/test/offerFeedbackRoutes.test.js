const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const feedbackRoutes = require('../src/routes/feedback.routes');
const AdminFeedback = require('../src/models/AdminFeedback');
const {
  createOfferFeedbackRouter,
} = require('../src/routes/offerFeedback.routes');

function requestJson(app, { path = '/api/offer-feedback', body = {}, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const payload = JSON.stringify(body);
      const request = http.request({
        method: 'POST',
        hostname: '127.0.0.1',
        port: server.address().port,
        path,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...headers,
        },
      }, (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => {
          server.close();
          resolve({
            statusCode: response.statusCode,
            body: raw ? JSON.parse(raw) : null,
          });
        });
      });
      request.on('error', (error) => {
        server.close();
        reject(error);
      });
      request.end(payload);
    });
  });
}

function createTestApp({ created = [] } = {}) {
  const app = express();
  const model = {
    async create(payload) {
      created.push(payload);
      return {
        _id: `feedback-${created.length}`,
        status: payload.status,
      };
    },
  };

  app.use(express.json());
  app.use('/api/offer-feedback', createOfferFeedbackRouter({
    OfferFeedbackModel: model,
    rateLimitMiddleware: (req, res, next) => next(),
  }));
  app.use((error, req, res, next) => {
    res.status(error.statusCode || 500).json({
      ok: false,
      message: error.message,
    });
  });

  return app;
}

function minimalPayload(overrides = {}) {
  return {
    reasons: ['category_wrong'],
    offerRef: {
      offerId: 'offer-123',
      stableId: 'stable-123',
      sourceId: 'source-123',
      dedupeKey: 'dedupe-123',
    },
    offerSnapshot: {
      title: 'Felix Felix Linsen mit Speck',
      retailerKey: 'billa',
      retailerLabel: 'BILLA',
      priceCurrent: {
        amount: 4.99,
        currency: 'EUR',
      },
      priceOriginal: {
        amount: 6.49,
        currency: 'EUR',
      },
      quantity: '800 g',
      categoryPrimary: 'Katzenfutter',
      conditionBadges: ['Gilt ab 2 Stück'],
      imagePresent: true,
      imageUrlPresent: true,
    },
    ...overrides,
  };
}

test('POST /api/offer-feedback speichert minimales valides Feedback', async () => {
  const created = [];
  const app = createTestApp({ created });

  const response = await requestJson(app, {
    body: minimalPayload({
      offerSnapshot: {
        title: '  Felix Felix Linsen mit Speck  ',
      },
    }),
    headers: {
      'user-agent': 'node-test-agent',
    },
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.body, {
    ok: true,
    feedbackId: 'feedback-1',
    status: 'new',
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].type, 'offer_feedback');
  assert.equal(created[0].status, 'new');
  assert.equal(created[0].priority, 'normal');
  assert.deepEqual(created[0].reasons, ['category_wrong']);
  assert.equal(created[0].offerSnapshot.title, 'Felix Felix Linsen mit Speck');
  assert.equal(created[0].clientContext.userAgent, 'node-test-agent');
});

test('POST /api/offer-feedback speichert mehrere reasons', async () => {
  const created = [];
  const app = createTestApp({ created });

  const response = await requestJson(app, {
    body: minimalPayload({
      reasons: ['category_wrong', 'condition_wrong', 'offer_nonsense'],
    }),
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(created[0].reasons, ['category_wrong', 'condition_wrong', 'offer_nonsense']);
});

test('POST /api/offer-feedback speichert category_wrong Details', async () => {
  const created = [];
  const app = createTestApp({ created });

  const response = await requestJson(app, {
    body: minimalPayload({
      structuredDetails: {
        category_wrong: {
          currentCategoryPrimary: ' Katzenfutter ',
          suggestedCategoryPrimary: 'Konserven',
          suggestedCategoryUnknown: false,
          userNote: 'Ist ein Lebensmittel.',
          ignoredField: 'not stored',
        },
      },
    }),
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(created[0].structuredDetails.category_wrong, {
    currentCategoryPrimary: 'Katzenfutter',
    suggestedCategoryPrimary: 'Konserven',
    suggestedCategoryUnknown: false,
    userNote: 'Ist ein Lebensmittel.',
  });
  assert.equal(created[0].structuredDetails.category_wrong.ignoredField, undefined);
});

test('POST /api/offer-feedback speichert condition_wrong Details mit duplicate_or_conflicting', async () => {
  const created = [];
  const app = createTestApp({ created });

  const response = await requestJson(app, {
    body: minimalPayload({
      reasons: ['condition_wrong'],
      offerSnapshot: {
        title: 'Felix Felix Linsen mit Speck',
        conditionBadges: ['Gilt ab 2 Stück', 'ab 2 Dosen'],
      },
      structuredDetails: {
        condition_wrong: {
          visibleConditions: ['Gilt ab 2 Stück', 'ab 2 Dosen'],
          issueTypes: ['duplicate_or_conflicting'],
          userNote: 'Zwei Bedingungen wirken doppelt.',
        },
      },
    }),
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(created[0].structuredDetails.condition_wrong.issueTypes, ['duplicate_or_conflicting']);
  assert.deepEqual(created[0].structuredDetails.condition_wrong.visibleConditions, [
    'Gilt ab 2 Stück',
    'ab 2 Dosen',
  ]);
});

test('POST /api/offer-feedback speichert offer_nonsense', async () => {
  const created = [];
  const app = createTestApp({ created });

  const response = await requestJson(app, {
    body: minimalPayload({
      reasons: ['offer_nonsense'],
      structuredDetails: {
        offer_nonsense: {
          userNote: 'Der Artikel passt fachlich nicht zur Karte.',
        },
      },
    }),
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(created[0].structuredDetails.offer_nonsense, {
    userNote: 'Der Artikel passt fachlich nicht zur Karte.',
  });
});

test('POST /api/offer-feedback lehnt leere reasons ab', async () => {
  const created = [];
  const app = createTestApp({ created });

  const response = await requestJson(app, {
    body: minimalPayload({
      reasons: [],
    }),
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.ok, false);
  assert.match(response.body.message, /Feedback-Grund/);
  assert.equal(created.length, 0);
});

test('POST /api/offer-feedback speichert keine unerlaubten Top-Level-Felder', async () => {
  const created = [];
  const app = createTestApp({ created });

  const response = await requestJson(app, {
    body: minimalPayload({
      unexpectedAdminFlag: true,
    }),
  });

  assert.equal(response.statusCode, 201);
  assert.equal(created[0].unexpectedAdminFlag, undefined);
});

test('POST /api/offer-feedback speichert keine structuredDetails fuer nicht ausgewaehlte reasons', async () => {
  const created = [];
  const app = createTestApp({ created });

  const response = await requestJson(app, {
    body: minimalPayload({
      reasons: ['category_wrong'],
      structuredDetails: {
        category_wrong: {
          suggestedCategoryPrimary: 'Konserven',
        },
        price_wrong: {
          seenPriceText: '3,99 EUR',
        },
      },
    }),
  });

  assert.equal(response.statusCode, 201);
  assert.equal(created[0].structuredDetails.category_wrong.suggestedCategoryPrimary, 'Konserven');
  assert.equal(created[0].structuredDetails.price_wrong, undefined);
});

test('POST /api/offer-feedback lehnt ungueltige reasons ab', async () => {
  const created = [];
  const app = createTestApp({ created });

  const response = await requestJson(app, {
    body: minimalPayload({
      reasons: ['category_wrong', 'not_allowed'],
    }),
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.ok, false);
  assert.match(response.body.message, /ungueltig/);
  assert.equal(created.length, 0);
});

test('POST /api/offer-feedback lehnt ungueltige detail issueTypes ab', async () => {
  const created = [];
  const app = createTestApp({ created });

  const response = await requestJson(app, {
    body: minimalPayload({
      reasons: ['condition_wrong'],
      structuredDetails: {
        condition_wrong: {
          issueTypes: ['not_allowed'],
        },
      },
    }),
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.ok, false);
  assert.match(response.body.message, /ungueltigen Wert/);
  assert.equal(created.length, 0);
});

test('POST /api/offer-feedback lehnt ueberlange Freitexte ab', async () => {
  const created = [];
  const app = createTestApp({ created });

  const response = await requestJson(app, {
    body: minimalPayload({
      freeText: 'x'.repeat(801),
    }),
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.ok, false);
  assert.match(response.body.message, /freeText ist zu lang/);
  assert.equal(created.length, 0);
});

test('POST /api/feedback bleibt als generisches Feedback unveraendert', async (t) => {
  const originalCreate = AdminFeedback.create;
  const calls = [];

  AdminFeedback.create = async (payload) => {
    calls.push(payload);
    return {
      _id: 'admin-feedback-1',
      ...payload,
    };
  };

  t.after(() => {
    AdminFeedback.create = originalCreate;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/feedback', feedbackRoutes);
  app.use((error, req, res, next) => {
    res.status(error.statusCode || 500).json({
      ok: false,
      message: error.message,
    });
  });

  const response = await requestJson(app, {
    path: '/api/feedback',
    body: {
      scope: 'offer-review',
      note: 'Generisches Feedback bleibt moeglich.',
      digest: 'digest',
      metadata: {
        beta: true,
      },
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.item.note, 'Generisches Feedback bleibt moeglich.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].scope, 'offer-review');
  assert.deepEqual(calls[0].metadata, {
    beta: true,
    source: 'public-feedback',
  });
});
