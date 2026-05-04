const rateLimit = require('express-rate-limit');

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

module.exports = {
  globalRateLimit,
};
