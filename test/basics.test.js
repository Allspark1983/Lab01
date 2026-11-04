// These tests send real HTTP requests to the small Labs 1–2 app.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../index');

let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    const closing = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closing;
  }
});

test('home route returns JSON and permits the lab CORS requests', async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await response.json(), { message: 'Hello World!' });
});

test('hello reads a decoded route parameter and sends plain text', async () => {
  const response = await fetch(`${baseUrl}/hello/Adzan%20Malek`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/plain/);
  assert.equal(await response.text(), 'Hi, Adzan Malek');
});

test('echo reads both query parameters and rejects missing or repeated keys', async () => {
  const response = await fetch(`${baseUrl}/echo?firstName=John&lastName=Wick`);
  const body = await response.json();
  assert.equal(body.firstName, 'John');
  assert.equal(body.lastName, 'Wick');
  assert.equal((await fetch(`${baseUrl}/echo?firstName=John`)).status, 400);
  assert.equal((await fetch(`${baseUrl}/echo?firstName=A&firstName=B&lastName=C`)).status, 400);
});

test('difference subtracts in the requested order, including decimal and negative values', async () => {
  for (const [path, expected] of [
    ['/difference/10/3', '7'],
    ['/difference/3/10', '-7'],
    ['/difference/-2.5/1.5', '-4']
  ]) {
    const response = await fetch(baseUrl + path);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), expected);
  }
});

test('difference rejects nonnumeric and nonfinite calculations', async () => {
  for (const path of ['/difference/ten/3', '/difference/Infinity/3', '/difference/1e308/-1e308']) {
    const response = await fetch(baseUrl + path);
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, 'string');
  }
});

test('scream joins both values with one space and uppercases the response', async () => {
  const response = await fetch(`${baseUrl}/scream?message=%20hello%20there%20&recipient=%20Adzan%20`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'HELLO THERE ADZAN');
  assert.equal((await fetch(`${baseUrl}/scream?message=hello`)).status, 400);
  assert.equal((await fetch(`${baseUrl}/scream?message=&recipient=Adzan`)).status, 400);
});

test('unknown routes return a useful JSON 404', async () => {
  const response = await fetch(`${baseUrl}/unknown`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Route not found' });
});
