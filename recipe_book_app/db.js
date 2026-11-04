// LAB 3: Reuse one MongoClient instead of reconnecting for every request.
const { MongoClient, ServerApiVersion } = require('mongodb');
const { validateMongoUri } = require('./dbDiagnostics');
let client = null;

async function connect(uri, dbname) {
  validateMongoUri(uri);
  if (client) return client.db(dbname);

  const candidate = new MongoClient(uri, {
    serverApi: { version: ServerApiVersion.v1 },
    serverSelectionTimeoutMS: 10000
  });
  try {
    await candidate.connect();
    await candidate.db(dbname).command({ ping: 1 });
    client = candidate;
    return client.db(dbname);
  } catch (error) {
    // Preserve the connection failure even if cleanup also fails.
    try { await candidate.close(); } catch { /* The original error is more useful. */ }
    throw error;
  }
}

async function close() {
  if (client) await client.close();
  client = null;
}

async function ensureIndexes(db) {
  // An index, rather than a pre-check alone, also prevents simultaneous duplicates.
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
}

module.exports = { connect, close, ensureIndexes };
