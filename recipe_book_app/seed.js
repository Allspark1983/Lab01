// Lab 3: load the handout's sample data without deleting existing work.
const fs = require('node:fs');
const path = require('node:path');
const { BSON } = require('mongodb');
const { diagnoseMongoError } = require('./dbDiagnostics');

function readSample(collectionName) {
  const file = path.join(__dirname, 'data', `${collectionName}.json`);
  // EJSON turns { "$oid": "..." } into a real MongoDB ObjectId.
  return BSON.EJSON.parse(fs.readFileSync(file, 'utf8'));
}

async function seedDatabase(db) {
  const summary = {};

  // Matching by name also recognizes documents already imported in Compass.
  // $setOnInsert leaves every matching document and its edits unchanged.
  for (const collectionName of ['cuisines', 'tags']) {
    const collection = db.collection(collectionName);
    let inserted = 0;
    for (const document of readSample(collectionName)) {
      const result = await collection.updateOne(
        { name: document.name },
        { $setOnInsert: document },
        { upsert: true }
      );
      inserted += result.upsertedCount;
    }
    summary[collectionName] = {
      inserted,
      total: await collection.countDocuments()
    };
  }

  const recipes = db.collection('recipes');
  let insertedRecipes = 0;
  for (const sample of readSample('recipes')) {
    // Use the actual catalog IDs if Compass gave existing records new IDs.
    const cuisine = await db.collection('cuisines').findOne({ name: sample.cuisine.name });
    const tags = [];
    for (const tag of sample.tags) {
      const storedTag = await db.collection('tags').findOne({ name: tag.name });
      if (!storedTag) throw new Error('A sample tag is missing from the database.');
      tags.push({ _id: storedTag._id, name: storedTag.name });
    }
    if (!cuisine) throw new Error('A sample cuisine is missing from the database.');

    const recipe = {
      ...sample,
      cuisine: { _id: cuisine._id, name: cuisine.name },
      tags
    };
    // The fixed ID also recognizes a sample recipe after the learner renames it.
    const result = await recipes.updateOne(
      { $or: [{ _id: recipe._id }, { name: recipe.name }] },
      { $setOnInsert: recipe },
      { upsert: true }
    );
    insertedRecipes += result.upsertedCount;
  }
  summary.recipes = {
    inserted: insertedRecipes,
    total: await recipes.countDocuments()
  };

  return summary;
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
  if (!process.env.MONGO_URI) {
    console.error('Add MONGO_URI to recipe_book_app/.env before running npm run seed.');
    process.exitCode = 1;
    return;
  }

  const { connect, close } = require('./db');
  try {
    const db = await connect(process.env.MONGO_URI, process.env.DB_NAME || 'recipe_book');
    const summary = await seedDatabase(db);
    for (const [collection, counts] of Object.entries(summary)) {
      console.log(`${collection}: ${counts.inserted} inserted, ${counts.total} total`);
    }
    console.log('Sample data ready. Existing documents were preserved.');
  } catch (error) {
    if (error.code === 11000) {
      console.error('A sample ID is already used by another document. Existing documents were preserved. Check the matching collection in Compass.');
    } else {
      console.error('Could not finish seeding.');
      console.error(diagnoseMongoError(error, process.env.MONGO_URI));
    }
    process.exitCode = 1;
  } finally {
    await close();
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('Could not finish closing the database connection.');
    process.exitCode = 1;
  });
}

module.exports = { seedDatabase };
