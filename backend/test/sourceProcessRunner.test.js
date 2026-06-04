const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { runSourceInChildProcess, _private } = require('../src/services/crawl/sourceProcessRunner');

class FakeChild extends EventEmitter {
  constructor({ response = null } = {}) {
    super();
    this.response = response;
    this.sent = null;
    this.killed = false;
    this.killSignal = '';
  }

  send(message) {
    this.sent = message;
    if (this.response) {
      setImmediate(() => this.emit('message', this.response));
    }
  }

  kill(signal) {
    this.killed = true;
    this.killSignal = signal;
  }
}

test('runSourceInChildProcess resolves source worker results', async () => {
  let child = null;
  const source = { _id: 'source-1', sourceUrl: 'https://example.test/a' };
  const result = await runSourceInChildProcess({
    source,
    region: 'AT',
    trigger: 'scheduled',
    crawlRunId: 'run-1',
    timeoutMs: 100,
    forkImpl(workerPath, args, options) {
      child = new FakeChild({
        response: {
          ok: true,
          result: { status: 'success', offersStored: 1 },
        },
      });
      assert.equal(args.length, 0);
      assert.equal(options.stdio[3], 'ipc');
      assert.match(workerPath, /sourceWorkerProcess\.js$/);
      return child;
    },
  });

  assert.deepEqual(result, { status: 'success', offersStored: 1 });
  assert.equal(child.sent.source, source);
  assert.equal(child.sent.region, 'AT');
  assert.equal(child.sent.trigger, 'scheduled');
  assert.equal(child.sent.crawlRunId, 'run-1');
  assert.equal(child.killed, false);
});

test('runSourceInChildProcess kills and rejects timed-out source workers', async () => {
  let child = null;

  await assert.rejects(
    runSourceInChildProcess({
      source: { _id: 'source-timeout', sourceUrl: 'https://example.test/hang' },
      region: 'AT',
      trigger: 'scheduled',
      crawlRunId: 'run-timeout',
      timeoutMs: 20,
      forkImpl() {
        child = new FakeChild();
        return child;
      },
    }),
    (error) => {
      assert.equal(error.code, _private.SOURCE_TIMEOUT_ERROR_CODE);
      assert.equal(error.diagnostic.failureStage, 'source-timeout');
      assert.equal(error.diagnostic.sourceId, 'source-timeout');
      assert.match(error.message, /timed out/i);
      return true;
    }
  );

  assert.equal(child.killed, true);
  assert.equal(child.killSignal, 'SIGKILL');
});

test('runSourceInChildProcess rejects worker-reported source errors', async () => {
  await assert.rejects(
    runSourceInChildProcess({
      source: { _id: 'source-error', sourceUrl: 'https://example.test/error' },
      region: 'AT',
      trigger: 'manual',
      crawlRunId: 'run-error',
      timeoutMs: 100,
      forkImpl() {
        return new FakeChild({
          response: {
            ok: false,
            error: {
              message: 'source failed',
              code: 'SOURCE_FAILED',
              diagnostic: { failureStage: 'fetch' },
            },
          },
        });
      },
    }),
    (error) => {
      assert.equal(error.code, 'SOURCE_FAILED');
      assert.equal(error.diagnostic.failureStage, 'fetch');
      assert.equal(error.message, 'source failed');
      return true;
    }
  );
});
