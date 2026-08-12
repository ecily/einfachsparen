const test = require('node:test');
const assert = require('node:assert/strict');

test('backend app loads the production dashboard dependency chain', () => {
  process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
  process.env.MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'app-load-smoke';
  process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'app-load-smoke-admin-key';

  assert.doesNotThrow(() => {
    require('../src/app');
  });
});
