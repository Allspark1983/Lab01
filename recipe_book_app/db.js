// LAB 3: Reuse one MongoClient instead of reconnecting for every request.
const { MongoClient, ServerApiVersion } = require('mongodb');
let client = null;

async function connect(uri, dbname) {
  if (!uri) throw new Error('Set MONGO_URI in your .env file.');
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
    await candidate.close();
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
