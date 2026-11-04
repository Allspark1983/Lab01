const test = require('node:test');
const assert = require('node:assert/strict');
const { createGeminiService } = require('../gemini');

// These tests use prepared provider responses. They never use a real API key.
const tags = ['pasta', 'quick', 'easy', 'vegetarian'];
const cuisines = ['Italian', 'Indian', 'Mexican'];
const ingredients = ['spaghetti', 'Pecorino Romano cheese', 'tomato'];

function serviceReturning(value, raw = false) {
  const calls = [];
  const client = {
    models: {
      async generateContent(request) {
        calls.push(request);
        return { text: raw ? value : JSON.stringify(value) };
      }
    }
  };
  return { service: createGeminiService({ client, model: 'test-model' }), calls };
}

function sampleRecipe() {
  return {
    name: ' Tomato Pasta ',
    cuisine: 'italian',
    prepTime: 10,
    cookTime: 15,
    servings: 2,
    ingredients: [
      { name: ' Spaghetti ', amount: 200, unit: 'g' },
      { name: 'Black Pepper', amount: ' to taste ', unit: '' }
    ],
    instructions: [' Cook the pasta. ', 'Add the sauce and season.'],
    tags: ['QUICK', 'quick', 'easy']
  };
}

test('Gemini is optional at startup and reports a missing key only when used', async () => {
  const service = createGeminiService({ apiKey: '' });
  assert.equal(typeof service.generateRecipe, 'function');
  await assert.rejects(
    service.generateSearchParams('Italian pasta', tags, cuisines, ingredients),
    error => error.status === 503 && /GEMINI_API_KEY/.test(error.message)
  );
});

test('search canonicalizes database casing and removes duplicate values', async () => {
  const { service } = serviceReturning({
    cuisines: [' italian ', 'ITALIAN'],
    tags: ['QUICK', 'quick'],
    ingredients: ['pecorino romano cheese']
  });
  assert.deepEqual(await service.generateSearchParams('quick Italian cheese pasta', tags, cuisines, ingredients), {
    cuisines: ['Italian'], tags: ['quick'], ingredients: ['Pecorino Romano cheese']
  });
});

test('requests specify JSON schema and keep user input separate from system instructions', async () => {
  const { service, calls } = serviceReturning({ cuisines: [], tags: [], ingredients: [] });
  const query = 'my unusual recipe search';
  await service.generateSearchParams(query, tags, cuisines, ingredients);
  const request = calls[0];
  assert.equal(request.model, 'test-model');
  assert.equal(request.contents, query);
  assert.equal(request.config.responseMimeType, 'application/json');
  assert.deepEqual(request.config.responseJsonSchema.required, ['cuisines', 'tags', 'ingredients']);
  assert.equal(request.config.responseJsonSchema.additionalProperties, false);
  assert.match(request.config.systemInstruction, /ingredients use AND/);
  assert.equal(request.config.systemInstruction.includes(query), false);
  assert.equal(request.config.temperature, undefined);
});

test('an unrecognized search remains empty instead of becoming a broad search', async () => {
  const empty = { cuisines: [], tags: [], ingredients: [] };
  const { service } = serviceReturning(empty);
  assert.deepEqual(await service.generateSearchParams('unavailable food', tags, cuisines, ingredients), empty);
});

test('search rejects unknown values instead of silently discarding a condition', async () => {
  const { service } = serviceReturning({ cuisines: ['Italian'], tags: [], ingredients: ['lobster'] });
  await assert.rejects(service.generateSearchParams('Italian lobster', tags, cuisines, ingredients),
    error => error.status === 502 && /not available/.test(error.message));
});

test('search rejects malformed filters, extra operators and oversized arrays', async () => {
  const invalid = [
    { cuisines: 'Italian', tags: [], ingredients: [] },
    { cuisines: [], tags: [] },
    { cuisines: [], tags: [], ingredients: [], $where: 'malicious code' },
    { cuisines: [], tags: [], ingredients: [{ $ne: null }] },
    { cuisines: [], tags: Array(21).fill('quick'), ingredients: [] }
  ];
  for (const output of invalid) {
    const { service } = serviceReturning(output);
    await assert.rejects(service.generateSearchParams('pasta', tags, cuisines, ingredients),
      error => error.status === 502);
  }
});

test('invalid JSON, empty responses and oversized responses return safe errors', async () => {
  for (const output of ['not JSON: confidential upstream text', '', 'x'.repeat(100001)]) {
    const { service } = serviceReturning(output, true);
    await assert.rejects(service.generateSearchParams('pasta', tags, cuisines, ingredients),
      error => error.status === 502 && !error.message.includes('confidential'));
  }
});

test('a provider failure does not expose its original error or credentials', async () => {
  const service = createGeminiService({ client: {
    models: { async generateContent() { throw new Error('secret-key=DO-NOT-EXPOSE'); } }
  } });
  await assert.rejects(service.generateSearchParams('pasta', tags, cuisines, ingredients),
    error => error.status === 502 && !error.message.includes('DO-NOT-EXPOSE'));
});

test('recipe parsing preserves numeric and text quantities and canonicalizes names', async () => {
  const { service } = serviceReturning(sampleRecipe());
  const recipe = await service.generateRecipe('Make quick Italian pasta for two.', cuisines, tags);
  assert.equal(recipe.name, 'Tomato Pasta');
  assert.equal(recipe.cuisine, 'Italian');
  assert.deepEqual(recipe.tags, ['quick', 'easy']);
  assert.deepEqual(recipe.ingredients, [
    { name: 'spaghetti', amount: 200, unit: 'g' },
    { name: 'black pepper', amount: 'to taste', unit: '' }
  ]);
  assert.equal(recipe.instructions[0], 'Cook the pasta.');
});

test('zero cook time is valid for a recipe that needs no cooking', async () => {
  const recipe = sampleRecipe();
  recipe.prepTime = 0;
  recipe.cookTime = 0;
  recipe.tags = [];
  const { service } = serviceReturning(recipe);
  const result = await service.generateRecipe('A cold Italian dish.', cuisines, tags);
  assert.equal(result.cookTime, 0);
  assert.equal(result.prepTime, 0);
});

test('recipe validation rejects invalid fields and unknown taxonomy values', async () => {
  const mutations = [
    recipe => { recipe.cuisine = 'Atlantis'; },
    recipe => { recipe.tags = ['not-seeded']; },
    recipe => { recipe.prepTime = -1; },
    recipe => { recipe.cookTime = '15'; },
    recipe => { recipe.servings = 1.5; },
    recipe => { recipe.ingredients = []; },
    recipe => { recipe.ingredients[0].amount = 0; },
    recipe => { recipe.ingredients[0].amount = {}; },
    recipe => { recipe.instructions = ['']; },
    recipe => { recipe.instructions = Array(101).fill('Repeat.'); },
    recipe => { recipe.name = 'x'.repeat(201); },
    recipe => { recipe.reviews = []; }
  ];
  for (const change of mutations) {
    const recipe = sampleRecipe();
    change(recipe);
    const { service } = serviceReturning(recipe);
    await assert.rejects(service.generateRecipe('Make some pasta.', cuisines, tags),
      error => error.status === 502);
  }
});

test('invalid user input and unseeded cuisines fail before calling Gemini', async () => {
  const { service, calls } = serviceReturning(sampleRecipe());
  await assert.rejects(service.generateSearchParams('', tags, cuisines, ingredients),
    error => error.status === 400);
  await assert.rejects(service.generateSearchParams('x'.repeat(1001), tags, cuisines, ingredients),
    error => error.status === 400);
  await assert.rejects(service.generateRecipe({}, cuisines, tags), error => error.status === 400);
  await assert.rejects(service.generateRecipe('Make pasta.', [], tags), error => error.status === 503);
  assert.equal(calls.length, 0);
});
