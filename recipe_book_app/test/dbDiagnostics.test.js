const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { MongoClient } = require('mongodb');
const { validateMongoUri, diagnoseMongoError } = require('../dbDiagnostics');

// Deliberately fake credentials let us detect accidental disclosure in output.
const secret = 'diagnostic-fixture-secret';
const uri = `mongodb+srv://fixture:${secret}@example.invalid/`;

function wrapped(error) {
  return {
    name: 'MongoServerSelectionError',
    reason: { servers: new Map([['example.invalid', { error }]]) }
  };
}

test('URI placeholders and missing settings fail before connecting', () => {
  for (const value of ['', undefined, '   ']) {
    assert.throws(() => validateMongoUri(value), /\[MISSING_URI\]/);
  }
  for (const placeholder of ['<db_password>', '%3Cdb_password%3E']) {
    assert.throws(() => validateMongoUri(uri.replace(secret, placeholder)), /\[URI_PLACEHOLDER\]/);
  }
  assert.doesNotThrow(() => validateMongoUri(uri));
  assert.doesNotThrow(() => validateMongoUri('mongodb://127.0.0.1:27017'));
});

test('nested login and permission failures take precedence over server selection', () => {
  for (const error of [
    { code: 18 }, { code: '18' }, { codeName: 'AuthenticationFailed' },
    { code: 8000, message: `bad auth : authentication failed ${uri}` }
  ]) {
    const output = diagnoseMongoError(wrapped({ cause: error }), uri);
    assert.match(output, /^\[AUTHENTICATION\]/);
    assert.ok(!output.includes(secret));
    assert.ok(!output.includes(uri));
  }
  assert.match(diagnoseMongoError(wrapped({ code: 13 }), uri), /^\[PERMISSIONS\]/);
  assert.match(diagnoseMongoError({ code: 11000 }, uri), /^\[DUPLICATE_DATA\]/);
  assert.match(diagnoseMongoError({ code: 8000, message: 'Unrelated Atlas error' }, uri), /^\[UNCLASSIFIED\]/);
});

test('DNS refusal and TLS failures are distinguished from general network errors', () => {
  const dns = { cause: { code: 'ECONNREFUSED', syscall: 'querySrv', message: uri } };
  assert.match(diagnoseMongoError(wrapped(dns), uri), /^\[DNS\]/);
  const tls = new AggregateError([{ code: 'CERT_HAS_EXPIRED', message: uri }]);
  assert.match(diagnoseMongoError(wrapped(tls), uri), /^\[TLS\]/);
  assert.match(diagnoseMongoError(wrapped({ code: 'ETIMEDOUT' }), uri), /^\[NETWORK\]/);
  assert.match(diagnoseMongoError(wrapped({ code: 'ECONNREFUSED' }), 'mongodb://127.0.0.1:27017'), /^\[LOCAL_CONNECTION\]/);
});

test('real MongoDB URI parse errors are explained without exposing credentials', () => {
  let failure;
  const malformed = `mongodb://fixture:${secret}%ZZ@localhost/`;
  try { new MongoClient(malformed); } catch (error) { failure = error; }
  assert.ok(failure, 'The driver must reject malformed percent escapes');
  const output = diagnoseMongoError(failure, malformed);
  assert.match(output, /^\[URI_FORMAT\]/);
  assert.ok(!output.includes(secret));
  assert.ok(!output.includes(malformed));
});

test('unknown and cyclic errors never echo arbitrary messages, names, or codes', () => {
  const error = { name: secret, code: secret, message: uri, reason: {} };
  error.cause = error;
  error.reason.error = error;
  const output = diagnoseMongoError(error, uri);
  assert.match(output, /^\[UNCLASSIFIED\]/);
  assert.ok(!output.includes(secret));
  assert.ok(!output.includes(uri));
});

test('check-db exits with a safe diagnostic and needs no token secret', () => {
  for (const [value, category] of [
    ['', 'MISSING_URI'],
    [uri.replace(secret, '<db_password>'), 'URI_PLACEHOLDER'],
    [`invalid-${secret}`, 'URI_FORMAT']
  ]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'checkDb.js')], {
      env: { ...process.env, MONGO_URI: value, TOKEN_SECRET: '' },
      encoding: 'utf8', timeout: 5000
    });
    assert.equal(result.status, 1);
    const output = result.stdout + result.stderr;
    assert.ok(output.includes(`[${category}]`));
    assert.match(output, /terminal environment/);
    assert.ok(!output.includes(secret));
    assert.ok(!output.includes('TOKEN_SECRET'));
  }
});
