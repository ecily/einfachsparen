const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const app = require('../src/app');

function requestJson(server, path) {
  const address = server.address();

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      path,
      method: 'GET',
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(body),
          });
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

test('GET /api/health preserves status fields and exposes safe build metadata', async () => {
  const server = app.listen(0);

  try {
    const response = await requestJson(server, '/api/health');

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.status, 'ok');
    assert.equal(typeof response.body.database.connected, 'boolean');
    assert.match(response.body.now, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(response.body.build.packageVersion, '1.0.0');
    assert.equal(typeof response.body.build.commitSha, 'string');
    assert.equal(typeof response.body.build.commitShort, 'string');
    assert.equal(typeof response.body.build.buildTime, 'string');
    assert.equal(typeof response.body.build.nodeEnv, 'string');

    const serialized = JSON.stringify(response.body);
    assert.doesNotMatch(serialized, /MONGO_URI|ADMIN_API_KEY|ANALYTICS_SESSION_SECRET|mongodb\+srv/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
