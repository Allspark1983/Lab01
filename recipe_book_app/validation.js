// Small, reusable checks keep bad input out of MongoDB.
const { ObjectId } = require('mongodb');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function object(value, label = 'Request body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(400, `${label} must be a JSON object.`);
  }
  return value;
}

function text(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw httpError(400, `${label} must be a nonempty string of at most ${max} characters.`);
  }
  return value.trim();
}

function objectId(value, label = 'id') {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) {
    throw httpError(400, `${label} must be a 24-character MongoDB ObjectId.`);
  }
  return new ObjectId(value);
}

function number(value, label, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)
      || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw httpError(400, `${label} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}.`);
  }
  return value;
}

function array(value, label, min = 0, max = 100) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw httpError(400, `${label} must be an array with ${min}–${max} items.`);
  }
  return value;
}

function recipeInput(body) {
  object(body);
  // Build a new object from allowed fields; never pass req.body directly to MongoDB.
  return {
    name: text(body.name, 'name'),
    cuisine: text(body.cuisine, 'cuisine'),
    prepTime: number(body.prepTime, 'prepTime', 0, 10080),
    cookTime: number(body.cookTime, 'cookTime', 0, 10080),
    servings: number(body.servings, 'servings', 1, 1000, true),
    ingredients: array(body.ingredients, 'ingredients', 1).map((ingredient, i) => {
      object(ingredient, `ingredients[${i}]`);
      const amount = typeof ingredient.amount === 'number'
        ? number(ingredient.amount, `ingredients[${i}].amount`, Number.MIN_VALUE, 1000000000)
        : text(ingredient.amount, `ingredients[${i}].amount`, 100);
      if (typeof ingredient.unit !== 'string' || ingredient.unit.trim().length > 50) {
        throw httpError(400, `ingredients[${i}].unit must be a string of at most 50 characters.`);
      }
      return { name: text(ingredient.name, `ingredients[${i}].name`), amount, unit: ingredient.unit.trim() };
    }),
    instructions: array(body.instructions, 'instructions', 1)
      .map((step, i) => text(step, `instructions[${i}]`, 2000)),
    tags: [...new Set(array(body.tags, 'tags', 0, 20).map(tag => text(tag, 'tag')))]
  };
}

function reviewInput(body) {
  object(body);
  return {
    user: text(body.user, 'user', 100),
    rating: number(body.rating, 'rating', 1, 5, true),
    comment: text(body.comment, 'comment', 2000)
  };
}

function credentials(body, signup = false) {
  object(body);
  const email = text(body.email, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Provide a valid email address.');
  // bcrypt processes at most 72 UTF-8 bytes; reject longer passwords explicitly.
  if (typeof body.password !== 'string' || body.password.length < (signup ? 8 : 1)
      || Buffer.byteLength(body.password, 'utf8') > 72) {
    throw httpError(400, `password must contain at least ${signup ? 8 : 1} characters and at most 72 UTF-8 bytes.`);
  }
  return { email, password: body.password };
}

// Treat search text literally: e.g. '(' should not become a broken regular expression.
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listQuery(value, label) {
  const items = text(value, label, 1000).split(',').map(item => item.trim());
  if (items.some(item => !item) || items.length > 20) {
    throw httpError(400, `${label} must contain 1–20 comma-separated nonempty values.`);
  }
  return [...new Set(items)];
}

function recipeQuery(query) {
  const criteria = {};
  if (query.name !== undefined) criteria.name = { $regex: escapeRegex(text(query.name, 'name')), $options: 'i' };
  if (query.cuisine !== undefined) criteria['cuisine.name'] = { $regex: escapeRegex(text(query.cuisine, 'cuisine')), $options: 'i' };
  if (query.tags !== undefined) criteria['tags.name'] = { $in: listQuery(query.tags, 'tags') };
  if (query.ingredients !== undefined) {
    criteria['ingredients.name'] = { $all: listQuery(query.ingredients, 'ingredients').map(value => new RegExp(escapeRegex(value), 'i')) };
  }
  return criteria;
}

module.exports = { httpError, object, text, objectId, recipeInput, reviewInput, credentials, recipeQuery };
