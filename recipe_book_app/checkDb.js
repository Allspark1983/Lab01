// A read-only connection check. Never print the URI, password, or raw errors.
const path = require('node:path');
const { connect, close } = require('./db');
const { diagnoseMongoError } = require('./dbDiagnostics');

async function main() {
  const uriFromEnvironment = Object.hasOwn(process.env, 'MONGO_URI');
  require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
  console.log(uriFromEnvironment
    ? 'Using MONGO_URI from the terminal environment; it takes precedence over .env.'
    : 'Using MONGO_URI from recipe_book_app/.env.');
  try {
    await connect(process.env.MONGO_URI, process.env.DB_NAME || 'recipe_book');
    console.log('MongoDB connection and ping succeeded. Next, run npm run seed to load the sample data and check write access.');
  } catch (error) {
    console.error(diagnoseMongoError(error, process.env.MONGO_URI));
    process.exitCode = 1;
  } finally {
    await close();
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('Could not complete the database check.');
    process.exitCode = 1;
  });
}

module.exports = { main };
