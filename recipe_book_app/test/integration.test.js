// Real HTTP + real MongoDB tests. Gemini is replaced with controlled responses.
// TEST_MONGO_URI can point to a permitted test server. Only a freshly named
// recipe_book_test_* database is created and removed; recipe_book is never used.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID, randomBytes } = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server-core');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createApp } = require('../app');
const { createGeminiService } = require('../gemini');
const { ensureIndexes } = require('../db');
const { seedDatabase } = require('../seed');

const tokenSecret = randomBytes(64).toString('hex');
const databaseName = 'recipe_book_test_' + randomUUID().replaceAll('-', '');
const recipeId = '507f1f77bcf86cd799439031';
const servers = [];
let mongo;
let client;
let db;
let baseUrl;
let aiSearchOutput;
let aiRecipeOutput;
let aiCalls;

function pizza(overrides = {}) {
  return {
    name: 'Test Margherita Pizza', cuisine: 'Italian', prepTime: 20,
    cookTime: 15, servings: 4,
    ingredients: [
      { name: 'pizza dough', amount: 1, unit: 'ball' },
      { name: 'tomato sauce', amount: 100, unit: 'ml' },
      { name: 'mozzarella cheese', amount: 200, unit: 'g' }
    ],
    instructions: ['Prepare the dough.', 'Add toppings and bake.'],
    tags: ['quick', 'easy', 'vegetarian'],
    ...overrides
  };
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(path, { method = 'GET', body, headers = {}, base = baseUrl } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

const aiService = {
  async generateSearchParams(...args) {
    aiCalls.push({ kind: 'search', args });
    return structuredClone(aiSearchOutput);
  },
  async generateRecipe(...args) {
    aiCalls.push({ kind: 'recipe', args });
    return structuredClone(aiRecipeOutput);
  }
};

before(async () => {
  let uri = process.env.TEST_MONGO_URI;
  if (!uri) {
    // Explicit version keeps the downloaded test server reproducible.
    mongo = await MongoMemoryServer.create({ binary: { version: '7.0.24' } });
    uri = mongo.getUri();
  }
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  db = client.db(databaseName);
  await db.command({ ping: 1 });
  await ensureIndexes(db);
  baseUrl = await listen(createApp(db, { tokenSecret, aiService }));
}, { timeout: 120000 });

beforeEach(async () => {
  for (const name of ['recipes', 'cuisines', 'tags', 'users']) {
    await db.collection(name).deleteMany({});
  }
  await seedDatabase(db);
  aiCalls = [];
  aiSearchOutput = { cuisines: [], tags: [], ingredients: [] };
  aiRecipeOutput = pizza({ name: 'AI Test Pizza' });
});

after(async () => {
  for (const server of servers) {
    const closing = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closing;
  }
  if (db) await db.dropDatabase();
  if (client) await client.close();
  if (mongo) await mongo.stop();
});

test('seeded recipes can be listed and read using returned ObjectIds', async () => {
  const list = await request('/recipes');
  assert.equal(list.status, 200);
  assert.equal(list.body.recipes.length, 3);
  assert.ok(list.body.recipes.every(recipe => ObjectId.isValid(recipe._id)));
  const detail = await request('/recipes/' + recipeId);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.name, 'Spaghetti Carbonara');
  assert.equal(detail.body.cuisine._id, '507f1f77bcf86cd799439011');
  assert.ok(detail.body.ingredients.length > 0);
  assert.deepEqual(detail.body.reviews, []);
});

test('search combines filters correctly and treats regex characters as ordinary text', async () => {
  const names = async query => (await request('/recipes?' + query)).body.recipes.map(recipe => recipe.name).sort();
  assert.deepEqual(await names('name=CHICKEN'), ['Chicken Tikka Masala']);
  assert.deepEqual(await names('cuisine=itAL'), ['Spaghetti Carbonara']);
  assert.deepEqual(await names('tags=spicy,vegetarian'), ['Chicken Tikka Masala', 'Guacamole']);
  assert.deepEqual(await names('ingredients=chicken,yogurt'), ['Chicken Tikka Masala']);
  assert.deepEqual(await names('ingredients=chicken,avocado'), []);
  assert.deepEqual(await names('cuisine=Indian&tags=vegetarian'), []);
  assert.deepEqual(await names('name=.*'), []);
  assert.deepEqual(await names('cuisine=.*'), []);
  assert.deepEqual(await names('name=%5B'), []);
  assert.equal((await request('/recipes?name=A&name=B')).status, 400);
  assert.equal((await request('/recipes?tags=quick,,easy')).status, 400);
});

test('create resolves catalog names, accepts zero cooking time, and ignores uncontrolled fields', async () => {
  const response = await request('/recipes', {
    method: 'POST',
    body: pizza({ cookTime: 0, tags: ['easy', 'easy'], reviews: [{ rating: 99 }], $set: { admin: true } })
  });
  assert.equal(response.status, 201);
  assert.ok(ObjectId.isValid(response.body.recipeId));
  const stored = await db.collection('recipes').findOne({ _id: new ObjectId(response.body.recipeId) });
  assert.ok(stored.cuisine._id instanceof ObjectId);
  assert.equal(stored.cuisine.name, 'Italian');
  assert.equal(stored.cookTime, 0);
  assert.equal(stored.tags.length, 1);
  assert.ok(stored.tags[0]._id instanceof ObjectId);
  assert.deepEqual(stored.reviews, []);
  assert.equal(stored.$set, undefined);
  assert.equal(stored.admin, undefined);
});

test('bad recipe bodies and unknown catalog names are rejected without inserting documents', async () => {
  for (const invalid of [
    null, [], pizza({ prepTime: -1 }), pizza({ servings: 0 }),
    pizza({ ingredients: [] }), pizza({ cuisine: 'Unknown Cuisine' }),
    pizza({ tags: ['unknown-tag'] }), pizza({ name: { $ne: null } })
  ]) {
    const response = await request('/recipes', { method: 'POST', body: invalid });
    assert.equal(response.status, 400);
  }
  assert.equal(await db.collection('recipes').countDocuments(), 3);
});

test('malformed IDs are 400, while valid absent IDs are 404', async () => {
  const missingId = new ObjectId().toHexString();
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const options = { method, ...(method === 'PUT' ? { body: pizza() } : {}) };
    assert.equal((await request('/recipes/not-an-id', options)).status, 400);
    assert.equal((await request('/recipes/' + missingId, options)).status, 404);
  }
});

test('recipe PUT preserves identity and embedded reviews, and delete removes the target only', async () => {
  const created = await request('/recipes', { method: 'POST', body: pizza() });
  const id = created.body.recipeId;
  const review = await request(`/recipes/${id}/reviews`, {
    method: 'POST', body: { user: 'FoodLearner', rating: 4, comment: 'Easy to follow.' }
  });
  assert.equal(review.status, 201);
  const updated = await request('/recipes/' + id, {
    method: 'PUT', body: pizza({ name: 'Updated Test Pizza', servings: 6 })
  });
  assert.equal(updated.status, 200);
  const detail = await request('/recipes/' + id);
  assert.equal(detail.body._id, id);
  assert.equal(detail.body.name, 'Updated Test Pizza');
  assert.equal(detail.body.servings, 6);
  assert.equal(detail.body.reviews[0].review_id, review.body.reviewId);
  assert.equal((await request('/recipes/' + id, { method: 'PUT', body: { name: 'Incomplete' } })).status, 400);
  assert.equal((await request('/recipes/' + id, { method: 'DELETE' })).status, 200);
  assert.equal((await request('/recipes/' + id)).status, 404);
  assert.equal(await db.collection('recipes').countDocuments(), 3);
});

test('embedded reviews support create, read, update, and delete with bounded ratings', async () => {
  const body = { user: 'FoodLearner', rating: 4, comment: 'Tasty and simple.' };
  const created = await request(`/recipes/${recipeId}/reviews`, { method: 'POST', body });
  assert.equal(created.status, 201);
  const id = created.body.reviewId;
  assert.ok(ObjectId.isValid(id));
  let detail = await request('/recipes/' + recipeId);
  assert.equal(detail.body.reviews[0].comment, body.comment);
  assert.ok(Number.isFinite(Date.parse(detail.body.reviews[0].date)));
  assert.equal((await request(`/recipes/${recipeId}/reviews/${id}`, {
    method: 'PUT', body: { ...body, rating: 5, comment: 'Even better the second time.' }
  })).status, 200);
  detail = await request('/recipes/' + recipeId);
  assert.equal(detail.body.reviews[0].rating, 5);
  assert.equal(detail.body.reviews[0].review_id, id);
  for (const rating of [0, 6, 2.5, '5']) {
    assert.equal((await request(`/recipes/${recipeId}/reviews`, {
      method: 'POST', body: { ...body, rating }
    })).status, 400);
  }
  assert.equal((await request(`/recipes/${recipeId}/reviews/${id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await request('/recipes/' + recipeId)).body.reviews, []);
  assert.equal((await request(`/recipes/${recipeId}/reviews/${id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await request(`/recipes/${recipeId}/reviews/${id}`, { method: 'PUT', body })).status, 404);
  assert.equal((await request(`/recipes/${recipeId}/reviews/not-an-id`, { method: 'DELETE' })).status, 400);
  assert.equal((await request(`/recipes/${new ObjectId()}/reviews`, { method: 'POST', body })).status, 404);
});

test('seeding again preserves existing edits, reviews, and document counts', async () => {
  await db.collection('recipes').updateOne({ _id: new ObjectId(recipeId) }, {
    $set: { name: 'My Renamed Carbonara', prepTime: 99 },
    $push: { reviews: { review_id: new ObjectId(), user: 'Existing', rating: 5, comment: 'Keep me', date: new Date() } }
  });
  const summary = await seedDatabase(db);
  assert.equal(summary.cuisines.inserted, 0);
  assert.equal(summary.tags.inserted, 0);
  assert.equal(summary.recipes.inserted, 0);
  assert.equal(summary.recipes.total, 3);
  const preserved = await db.collection('recipes').findOne({ _id: new ObjectId(recipeId) });
  assert.equal(preserved.name, 'My Renamed Carbonara');
  assert.equal(preserved.prepTime, 99);
  assert.equal(preserved.reviews[0].comment, 'Keep me');
});

test('seeding uses the IDs of catalog documents already imported through Compass', async () => {
  await db.collection('recipes').deleteMany({});
  await db.collection('cuisines').deleteMany({});
  await db.collection('tags').deleteMany({});
  const cuisineId = new ObjectId();
  const tagId = new ObjectId();
  await db.collection('cuisines').insertOne({ _id: cuisineId, name: 'Italian' });
  await db.collection('tags').insertOne({ _id: tagId, name: 'pasta' });
  await seedDatabase(db);
  const stored = await db.collection('recipes').findOne({ _id: new ObjectId(recipeId) });
  assert.ok(stored.cuisine._id.equals(cuisineId));
  assert.ok(stored.tags.find(tag => tag.name === 'pasta')._id.equals(tagId));
  assert.equal(await db.collection('cuisines').countDocuments({ name: 'Italian' }), 1);
});

test('signup normalizes email, hashes the password, and rejects duplicate accounts', async () => {
  const account = { email: '  Learner@Example.com  ', password: 'LearnMongo123!' };
  const created = await request('/users', { method: 'POST', body: account });
  assert.equal(created.status, 201);
  assert.ok(ObjectId.isValid(created.body.userId));
  assert.equal(created.body.password, undefined);
  const user = await db.collection('users').findOne({ email: 'learner@example.com' });
  assert.notEqual(user.password, account.password);
  assert.equal(await bcrypt.compare(account.password, user.password), true);
  assert.equal((await request('/users', {
    method: 'POST', body: { ...account, email: 'learner@example.com' }
  })).status, 409);
  assert.equal(await db.collection('users').countDocuments(), 1);
  assert.equal((await request('/users', { method: 'POST', body: { ...account, password: 'short' } })).status, 400);
  assert.equal((await request('/login', {
    method: 'POST', body: { email: { $ne: null }, password: account.password }
  })).status, 400);
});

test('login issues a one-hour JWT; profile rejects missing, wrong-scheme, forged, and expired tokens', async () => {
  const account = { email: 'learner@example.com', password: 'LearnMongo123!' };
  const registered = await request('/users', { method: 'POST', body: account });
  assert.equal((await request('/login', { method: 'POST', body: { ...account, password: 'WrongPassword' } })).status, 401);
  assert.equal((await request('/login', { method: 'POST', body: { ...account, email: 'missing@example.com' } })).status, 401);
  const login = await request('/login', { method: 'POST', body: account });
  assert.equal(login.status, 200);
  const token = login.body.accessToken;
  const claims = jwt.verify(token, tokenSecret, { algorithms: ['HS256'] });
  assert.equal(claims.user_id, registered.body.userId);
  assert.equal(claims.email, account.email);
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(claims.password, undefined);
  assert.equal((await request('/profile')).status, 401);
  assert.equal((await request('/profile', { headers: { Authorization: 'Basic ' + token } })).status, 401);
  assert.equal((await request('/profile', { headers: { Authorization: 'Bearer invalid-token' } })).status, 401);
  const forged = jwt.sign({ user_id: claims.user_id, email: claims.email }, randomBytes(64).toString('hex'));
  assert.equal((await request('/profile', { headers: { Authorization: 'Bearer ' + forged } })).status, 401);
  const expired = jwt.sign({ user_id: claims.user_id, email: claims.email }, tokenSecret, { expiresIn: -1 });
  assert.equal((await request('/profile', { headers: { Authorization: 'Bearer ' + expired } })).status, 401);
  const profile = await request('/profile', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.user.email, account.email);
});

test('AI search receives the catalogs and applies cuisine/tag OR plus ingredient AND', async () => {
  aiSearchOutput = { cuisines: ['Indian'], tags: ['spicy', 'easy'], ingredients: ['chicken breast', 'yogurt'] };
  const response = await request('/ai/recipes?q=' + encodeURIComponent('spicy Indian chicken with yogurt'));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.recipes.map(recipe => recipe.name), ['Chicken Tikka Masala']);
  assert.equal(aiCalls[0].kind, 'search');
  assert.ok(aiCalls[0].args[1].includes('spicy'));
  assert.ok(aiCalls[0].args[2].includes('Italian'));
  assert.ok(aiCalls[0].args[3].includes('chicken breast'));
  aiSearchOutput = { cuisines: [], tags: [], ingredients: [] };
  assert.deepEqual((await request('/ai/recipes?q=unrecognized')).body.recipes, []);
  assert.equal((await request('/ai/recipes')).status, 400);
});

test('AI recipe creation validates the generated data before storing it', async () => {
  aiRecipeOutput = pizza({ name: 'AI Test Pizza', ingredients: [{ name: 'salt', amount: 'to taste', unit: '' }] });
  const result = await request('/ai/recipes', {
    method: 'POST', body: { recipeText: 'An Italian pizza with salt to taste.' }
  });
  assert.equal(result.status, 201);
  const stored = await db.collection('recipes').findOne({ _id: new ObjectId(result.body.recipeId) });
  assert.equal(stored.cuisine.name, 'Italian');
  assert.equal(stored.ingredients[0].amount, 'to taste');
  assert.deepEqual(stored.reviews, []);
  aiRecipeOutput = pizza({ cuisine: 'Invented Cuisine' });
  assert.equal((await request('/ai/recipes', { method: 'POST', body: { recipeText: 'Another pizza.' } })).status, 502);
  assert.equal(await db.collection('recipes').countDocuments(), 4);
});

test('an absent Gemini key affects only AI routes and reports 503', async () => {
  const base = await listen(createApp(db, {
    tokenSecret, aiService: createGeminiService({ apiKey: '' })
  }));
  assert.equal((await request('/recipes', { base })).status, 200);
  assert.equal((await request('/ai/recipes?q=pasta', { base })).status, 503);
  assert.equal((await request('/ai/recipes', {
    base, method: 'POST', body: { recipeText: 'Make Italian pasta.' }
  })).status, 503);
});

test('opt-in authentication protects recipe/review writes and both AI endpoints', async () => {
  const base = await listen(createApp(db, { tokenSecret, aiService, requireAuthForWrites: true }));
  assert.equal((await request('/recipes', { base })).status, 200);
  for (const [method, path, body] of [
    ['POST', '/recipes', pizza()],
    ['PUT', '/recipes/' + recipeId, pizza()],
    ['DELETE', '/recipes/' + recipeId],
    ['POST', `/recipes/${recipeId}/reviews`, { user: 'Learner', rating: 5, comment: 'Good.' }],
    ['GET', '/ai/recipes?q=pasta'],
    ['POST', '/ai/recipes', { recipeText: 'Make pasta.' }]
  ]) {
    assert.equal((await request(path, { base, method, body })).status, 401);
  }
  const account = { email: 'authorized@example.com', password: 'LearnMongo123!' };
  assert.equal((await request('/users', { base, method: 'POST', body: account })).status, 201);
  const login = await request('/login', { base, method: 'POST', body: account });
  const created = await request('/recipes', {
    base, method: 'POST', body: pizza(), headers: { Authorization: 'Bearer ' + login.body.accessToken }
  });
  assert.equal(created.status, 201);
});

test('malformed JSON is a client error, and unknown routes return JSON 404', async () => {
  const response = await fetch(baseUrl + '/recipes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json'
  });
  assert.equal(response.status, 400);
  assert.equal(typeof (await response.json()).error, 'string');
  const unknown = await request('/unknown');
  assert.equal(unknown.status, 404);
  assert.equal(typeof unknown.body.error, 'string');
});
