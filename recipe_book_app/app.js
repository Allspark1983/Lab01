// LABS 3–9: Routes are grouped in the same order as the handout.
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const { createGeminiService } = require('./gemini');
const { httpError, object, text, objectId, recipeInput, reviewInput, credentials, recipeQuery } = require('./validation');

function createApp(db, options = {}) {
  const { tokenSecret, requireAuthForWrites = false } = options;
  if (typeof tokenSecret !== 'string' || tokenSecret.length < 32) {
    throw new Error('TOKEN_SECRET must be at least 32 characters. Run npm run setup first.');
  }
  const aiService = options.aiService || createGeminiService({
    apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL
  });
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  // LAB 8: A middleware checks the Bearer token before the protected handler.
  function verifyToken(req, res, next) {
    const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
    if (!match) return next(httpError(401, 'A valid Bearer token is required.'));
    try {
      req.user = jwt.verify(match[1], tokenSecret, { algorithms: ['HS256'] });
      if (!req.user || typeof req.user !== 'object' || !ObjectId.isValid(req.user.user_id)
          || typeof req.user.email !== 'string') throw new Error('Invalid payload');
      next();
    } catch {
      next(httpError(401, 'Invalid or expired token. Please log in again.'));
    }
  }

  // Keep the early lab requests public by default, as in the handout.
  const writeAccess = requireAuthForWrites ? verifyToken : (req, res, next) => next();

  // Resolve request names into the embedded catalog documents used in MongoDB.
  async function buildRecipe(body) {
    const input = recipeInput(body);
    const [cuisine, tags] = await Promise.all([
      db.collection('cuisines').findOne({ name: input.cuisine }),
      db.collection('tags').find({ name: { $in: input.tags } }).toArray()
    ]);
    if (!cuisine) throw httpError(400, 'Invalid cuisine. Use a name from GET /cuisines.');
    if (tags.length !== input.tags.length) throw httpError(400, 'One or more invalid tags. See GET /tags.');
    return {
      ...input,
      cuisine: { _id: cuisine._id, name: cuisine.name },
      tags: input.tags.map(name => {
        const tag = tags.find(item => item.name === name);
        return { _id: tag._id, name: tag.name };
      })
    };
  }

  app.get('/', (req, res) => res.json({ message: 'Hello World!' }));

  // LAB 3: Both list and detail routes are kept. IDs make later CRUD easy to try.
  app.get('/recipes', async (req, res) => {
    const recipes = await db.collection('recipes').find(recipeQuery(req.query)).project({
      _id: 1, name: 1, 'cuisine.name': 1, 'tags.name': 1, prepTime: 1, cookTime: 1
    }).toArray();
    res.json({ recipes });
  });

  app.get('/recipes/:id', async (req, res) => {
    const recipe = await db.collection('recipes').findOne({ _id: objectId(req.params.id) });
    if (!recipe) throw httpError(404, 'Recipe not found');
    res.json(recipe);
  });

  // These two helper routes show the exact names accepted by POST and PUT.
  app.get('/cuisines', async (req, res) => res.json({ cuisines: await db.collection('cuisines').find().toArray() }));
  app.get('/tags', async (req, res) => res.json({ tags: await db.collection('tags').find().toArray() }));

  // LAB 4: CREATE a recipe.
  app.post('/recipes', writeAccess, async (req, res) => {
    const recipe = await buildRecipe(req.body);
    const result = await db.collection('recipes').insertOne({ ...recipe, reviews: [] });
    res.status(201).json({ message: 'Recipe created successfully', recipeId: result.insertedId });
  });

  // LAB 5: UPDATE every editable recipe field, preserving its reviews and _id.
  app.put('/recipes/:id', writeAccess, async (req, res) => {
    const _id = objectId(req.params.id);
    const recipe = await buildRecipe(req.body);
    const result = await db.collection('recipes').updateOne({ _id }, { $set: recipe });
    if (result.matchedCount === 0) throw httpError(404, 'Recipe not found');
    res.json({ message: 'Recipe updated successfully' });
  });

  // LAB 6: DELETE one recipe.
  app.delete('/recipes/:id', writeAccess, async (req, res) => {
    const result = await db.collection('recipes').deleteOne({ _id: objectId(req.params.id) });
    if (result.deletedCount === 0) throw httpError(404, 'Recipe not found');
    res.json({ message: 'Recipe deleted successfully' });
  });

  // LAB 7: Reviews are embedded in their parent recipe.
  app.post('/recipes/:id/reviews', writeAccess, async (req, res) => {
    const _id = objectId(req.params.id);
    const review = { ...reviewInput(req.body), review_id: new ObjectId(), date: new Date() };
    const result = await db.collection('recipes').updateOne({ _id }, { $push: { reviews: review } });
    if (result.matchedCount === 0) throw httpError(404, 'Recipe not found');
    res.status(201).json({ message: 'Review added successfully', reviewId: review.review_id });
  });

  app.put('/recipes/:recipeId/reviews/:reviewId', writeAccess, async (req, res) => {
    const _id = objectId(req.params.recipeId, 'recipeId');
    const review_id = objectId(req.params.reviewId, 'reviewId');
    const review = { ...reviewInput(req.body), review_id, date: new Date() };
    // $ means the review matched by reviews.review_id in the query.
    const result = await db.collection('recipes').updateOne(
      { _id, 'reviews.review_id': review_id }, { $set: { 'reviews.$': review } }
    );
    if (result.matchedCount === 0) throw httpError(404, 'Recipe or review not found');
    res.json({ message: 'Review updated successfully', reviewId: review_id });
  });

  app.delete('/recipes/:recipeId/reviews/:reviewId', writeAccess, async (req, res) => {
    const _id = objectId(req.params.recipeId, 'recipeId');
    const review_id = objectId(req.params.reviewId, 'reviewId');
    const result = await db.collection('recipes').updateOne({ _id }, { $pull: { reviews: { review_id } } });
    if (result.matchedCount === 0) throw httpError(404, 'Recipe not found');
    if (result.modifiedCount === 0) throw httpError(404, 'Review not found');
    res.json({ message: 'Review deleted successfully' });
  });

  // LAB 8: Store only a bcrypt hash, never the original password.
  app.post('/users', async (req, res) => {
    const { email, password } = credentials(req.body, true);
    const hash = await bcrypt.hash(password, 12);
    try {
      const result = await db.collection('users').insertOne({ email, password: hash });
      res.status(201).json({ message: 'New user account', userId: result.insertedId });
    } catch (error) {
      if (error.code === 11000) throw httpError(409, 'An account with this email already exists.');
      throw error;
    }
  });

  app.post('/login', async (req, res) => {
    const { email, password } = credentials(req.body);
    const user = await db.collection('users').findOne({ email });
    if (!user || typeof user.password !== 'string' || !await bcrypt.compare(password, user.password)) {
      throw httpError(401, 'Invalid email or password.');
    }
    const accessToken = jwt.sign({ user_id: user._id.toHexString(), email: user.email }, tokenSecret,
      { algorithm: 'HS256', expiresIn: '1h' });
    res.json({ accessToken });
  });

  app.get('/profile', verifyToken, (req, res) => {
    res.json({ message: 'This is a protected route', user: req.user });
  });

  // LAB 9: AI produces values; our code alone chooses the MongoDB operators.
  app.get('/ai/recipes', writeAccess, async (req, res) => {
    const query = text(req.query.q, 'q', 1000);
    const [tags, cuisines, ingredients] = await Promise.all([
      db.collection('tags').distinct('name'), db.collection('cuisines').distinct('name'),
      db.collection('recipes').distinct('ingredients.name')
    ]);
    const filters = await aiService.generateSearchParams(query, tags, cuisines, ingredients);
    if (!filters.cuisines.length && !filters.tags.length && !filters.ingredients.length) {
      return res.json({ recipes: [], searchParams: filters, message: 'No supported search terms were found.' });
    }
    const criteria = {};
    if (filters.cuisines.length) criteria['cuisine.name'] = { $in: filters.cuisines };
    if (filters.tags.length) criteria['tags.name'] = { $in: filters.tags };
    if (filters.ingredients.length) criteria['ingredients.name'] = { $all: filters.ingredients };
    const recipes = await db.collection('recipes').find(criteria).toArray();
    res.json({ recipes, searchParams: filters });
  });

  app.post('/ai/recipes', writeAccess, async (req, res) => {
    object(req.body);
    const recipeText = text(req.body.recipeText, 'recipeText', 10000);
    const [cuisines, tags] = await Promise.all([
      db.collection('cuisines').distinct('name'), db.collection('tags').distinct('name')
    ]);
    const generated = await aiService.generateRecipe(recipeText, cuisines, tags);
    let recipe;
    try {
      recipe = await buildRecipe(generated);
    } catch (error) {
      if (error.status === 400) throw httpError(502, 'The AI returned a recipe that failed validation. Try a more specific description.');
      throw error;
    }
    const result = await db.collection('recipes').insertOne({ ...recipe, reviews: [] });
    res.status(201).json({ message: 'Recipe created successfully', recipeId: result.insertedId });
  });

  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  // Express 5 forwards rejected async handlers here automatically.
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body exceeds 100 KB.' });
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
    res.status(status).json({ error: status === 500 ? 'Internal server error' : error.message });
  });
  return app;
}

module.exports = { createApp };
