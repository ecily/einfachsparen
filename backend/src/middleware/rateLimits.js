const rateLimit = require('express-rate-limit');

function buildRateLimit({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      ok: false,
      message,
    },
  });
}

const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    message: 'Zu viele Anfragen. Bitte versuche es später erneut.',
  },
});

const offersRateLimit = buildRateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 120,
  message: 'Zu viele Angebotsanfragen. Bitte versuche es spaeter erneut.',
});

const basketRateLimit = buildRateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  message: 'Zu viele Warenkorb-Anfragen. Bitte versuche es spaeter erneut.',
});

const imageProxyRateLimit = buildRateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 180,
  message: 'Zu viele Bildanfragen. Bitte versuche es spaeter erneut.',
});

const filterRateLimit = buildRateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 180,
  message: 'Zu viele Filteranfragen. Bitte versuche es spaeter erneut.',
});

const shoppingListShareRateLimit = buildRateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  message: 'Zu viele geteilte Listen. Bitte versuche es spaeter erneut.',
});

const feedbackRateLimit = buildRateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: 'Zu viel Feedback in kurzer Zeit. Bitte versuche es spaeter erneut.',
});

const analyticsEventRateLimit = buildRateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 90,
  message: 'Zu viele Analytics-Events. Bitte versuche es spaeter erneut.',
});

module.exports = {
  analyticsEventRateLimit,
  basketRateLimit,
  feedbackRateLimit,
  filterRateLimit,
  globalRateLimit,
  imageProxyRateLimit,
  offersRateLimit,
  shoppingListShareRateLimit,
};
