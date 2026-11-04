// Connect to MongoDB first, then create the Express routes and start listening.
require('dotenv').config({ path: require('node:path').join(__dirname, '.env'), quiet: true });
const { connect, close, ensureIndexes } = require('./db');
const { createApp } = require('./app');
const { diagnoseMongoError } = require('./dbDiagnostics');

async function main() {
  let server;
  try {
    const tokenSecret = process.env.TOKEN_SECRET;
    if (!tokenSecret || tokenSecret.length < 32 || tokenSecret.startsWith('replace-with-')) {
      throw new Error('Configure TOKEN_SECRET: run npm run setup, or use npm run secret and update .env.');
    }
    if (!process.env.MONGO_URI) throw new Error('Set MONGO_URI in .env.');
    const port = Number(process.env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
    const db = await connect(process.env.MONGO_URI, process.env.DB_NAME || 'recipe_book');
    await ensureIndexes(db);
    const app = createApp(db, { tokenSecret, requireAuthForWrites: process.env.REQUIRE_AUTH_FOR_WRITES === 'true' });
    server = app.listen(port, () => {
      console.log(`Connected to MongoDB. Recipe API: http://localhost:${port}`);
      console.log('Read README.md and requests.http for the lab examples.');
    });
    server.on('error', async error => {
      console.error(error.code === 'EADDRINUSE' ? 'Port is in use. Stop the other lab with Ctrl+C, then retry.' : 'Unable to start the HTTP server.');
      await close();
      process.exitCode = 1;
    });
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => {
        server.close(async () => { await close(); process.exit(0); });
        setTimeout(() => process.exit(1), 5000).unref();
      });
    }
  } catch (error) {
    // Do not print connection strings, database credentials, or API keys.
    const configurationError = /^(Configure TOKEN_SECRET|Set MONGO_URI|PORT must)/.test(error.message);
    console.error(configurationError ? error.message : 'Startup failed.\n' + diagnoseMongoError(error, process.env.MONGO_URI));
    await close();
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { main };
