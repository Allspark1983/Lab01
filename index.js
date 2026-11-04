// LABS 1–2: Start here. This app does not need MongoDB or API keys.
const express = require('express');
const cors = require('cors');

function createApp() {
  const app = express();
  app.use(cors());

  // Lab 1: Send a JSON response from the home route.
  app.get('/', (req, res) => {
    res.json({ message: 'Hello World!' });
  });

  // Lab 2: :name is a route parameter. Example: /hello/Adzan
  app.get('/hello/:name', (req, res) => {
    res.type('text/plain').send('Hi, ' + req.params.name);
  });

  // Query strings follow a question mark: /echo?firstName=John&lastName=Wick
  app.get('/echo', (req, res) => {
    const { firstName, lastName } = req.query;
    if (typeof firstName !== 'string' || typeof lastName !== 'string') {
      return res.status(400).json({ error: 'Provide firstName and lastName as query strings.' });
    }
    res.json({ message: 'Here are the query parameters you sent:', firstName, lastName });
  });

  // HANDS ON 1: Convert URL text to numbers before subtracting.
  app.get('/difference/:n1/:n2', (req, res) => {
    const n1 = Number(req.params.n1);
    const n2 = Number(req.params.n2);
    const difference = n1 - n2;
    if (!req.params.n1.trim() || !req.params.n2.trim()
        || !Number.isFinite(n1) || !Number.isFinite(n2) || !Number.isFinite(difference)) {
      return res.status(400).json({ error: 'n1 and n2 must produce a finite numeric difference.' });
    }
    // Send text, so the browser displays the answer directly.
    res.type('text/plain').send(String(difference));
  });

  // HANDS ON 2: Join message + recipient with a space, then uppercase.
  app.get('/scream', (req, res) => {
    const { message, recipient } = req.query;
    if (typeof message !== 'string' || !message.trim()
        || typeof recipient !== 'string' || !recipient.trim()) {
      return res.status(400).json({ error: 'Provide message and recipient as nonempty query strings.' });
    }
    res.type('text/plain').send((message.trim() + ' ' + recipient.trim()).toUpperCase());
  });

  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  return app;
}

// When a test imports this file, do not start a second server.
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, () => console.log(`Lab 1–2 server: http://localhost:${port}`));
}

module.exports = { createApp };
