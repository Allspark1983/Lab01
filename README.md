# Lab01 — RESTful APIs using MongoDB and Express

Completed, commented code for **Labs 1–9**, including both hands-on exercises. The root app teaches Express basics; `recipe_book_app` contains MongoDB CRUD, embedded reviews, JWT login, and optional Gemini features.

## 1. Run Labs 1–2

Use **Node.js 22 or newer** and npm. Check with `node --version` and `npm --version`.

**Codespaces:** open [Allspark1983/Lab01](https://github.com/Allspark1983/Lab01), choose **Code → Codespaces**, create/open a Codespace, and open its terminal.

**Your computer:** clone and open the project:

```bash
git clone https://github.com/Allspark1983/Lab01.git
cd Lab01
```

From the repository root:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). In Codespaces, use the browser link for port **3000** in the **Ports** panel. Append these paths to that base URL:

| Path | Expected result |
| --- | --- |
| `/` | `{"message":"Hello World!"}` |
| `/hello/Adzan` | `Hi, Adzan` |
| `/echo?firstName=John&lastName=Wick` | JSON containing both names |
| `/difference/15/4` | `11` |
| `/difference/-5/3` | `-8` |
| `/scream?message=hello&recipient=Adzan` | `HELLO ADZAN` |

**Hands-on 1:** convert the route parameters into numbers and calculate `n1 - n2`. Invalid numbers return `400`.

**Hands-on 2:** read `message` and `recipient` from the query string, join them with one space, and call `.toUpperCase()`. Encode spaces inside query values as `%20`.

These labs need no database or keys. `npm start` runs normally; `npm run dev` uses the project's local nodemon to restart after code changes.

## 2. Run the recipe API: Labs 3–9

### Prepare the application

Stop the first server with **Ctrl+C**. Both apps use port 3000, so run one at a time. From the repository root:

```bash
cd recipe_book_app
npm install
npm run setup
```

Setup creates `.env` with a randomly generated `TOKEN_SECRET`. It preserves an existing `.env`. There is no need to run `npm init`.

### Connect your database

**Compass is a client for viewing/editing data.** Atlas or a local MongoDB server stores the data; installing Compass alone does not start a server.

| Database | `MONGO_URI` setting in `recipe_book_app/.env` |
| --- | --- |
| Local MongoDB Server, already running | `mongodb://127.0.0.1:27017` — the setup default |
| MongoDB Atlas | Your cluster's **Connect → Drivers** connection string |

For Atlas, create/use a **database user**, allow your development environment's IP in network access, and replace the password placeholder in the driver URI. Use the database password, remove placeholder angle brackets, and URL-encode special password characters such as `@`. Keep the URI on one line.

In Codespaces, use Atlas unless you separately started MongoDB inside that Codespace. Keep the generated secret, `DB_NAME=recipe_book`, and `PORT=3000`.

### Seed and start

Still inside `recipe_book_app`:

```bash
npm run check-db
npm run seed
npm run dev
```

`check-db` connects and pings without changing data. It prints a diagnostic category and suggested next step without printing credentials. A successful check confirms connectivity; seeding also checks write access. Setup's `.env already exists` message is normal: edit and save that existing file to change your connection settings.

If the check reports `[LOCAL_CONNECTION]` while you intend to use Atlas, replace the setup default in `recipe_book_app/.env` with your Atlas URI. `[URI_PLACEHOLDER]` means a placeholder such as `<db_password>` still needs replacing. `[AUTHENTICATION]` means to check the database user's login and URI encoding; `[PERMISSIONS]` means the user needs access to the database selected by `DB_NAME`. An exported terminal `MONGO_URI` takes precedence over `.env`; the check reports when this applies.

For `[NETWORK]`, check cluster availability and Atlas **Network Access**. Allow the outbound IP of the environment running Node.js. In Codespaces, Atlas's **Add Current IP Address** button in your laptop browser can identify your laptop's IP instead of the Codespace's. To look up the Codespace's public IPv4 address, run `curl -4 https://api.ipify.org` **inside its terminal**, then add that single IP to Atlas's access list. Codespace IPs can change; this is one possible cause of a connection timeout, not a diagnosis by itself. See [Atlas connection troubleshooting](https://www.mongodb.com/docs/atlas/troubleshoot-connection/) and [GitHub's Codespaces networking guidance](https://docs.github.com/en/codespaces/developing-in-a-codespace/connecting-to-a-private-network).

An empty database receives **3 cuisines, 9 tags, and 3 recipes**. Seeding prints inserted/total counts and preserves existing documents and edits. Open `/recipes` to see Spaghetti Carbonara, Chicken Tikka Masala, and Guacamole.

In Compass, connect to the same server and open **recipe_book → recipes**. The API prepares `users` at startup; signup inserts its first user.

Alternatively, import `data/cuisines.json`, `data/tags.json`, and `data/recipes.json` into their corresponding collections using Compass **Add Data → Import JSON or CSV file**. Import cuisine/tags first. These are Extended JSON arrays: `$oid` must become an ObjectId. Choose one initial import workflow; repeated manual imports can cause duplicate-ID errors.

## 3. Lab and file map

| Lab | Implementation |
| --- | --- |
| 1–2 | Root `index.js`: greeting, parameters, queries, both exercises |
| 3 | `recipe_book_app/db.js`, `seed.js`, `data/`; recipe reading/search |
| 4–6 | Recipe POST, PUT, DELETE routes in `app.js` |
| 7 | Embedded review routes in `app.js` |
| 8 | Signup/login/profile in `app.js`; `generateSecret.js` |
| 9 | `gemini.js` and AI routes in `app.js` |

The recipe app's `index.js` connects and starts the server; `validation.js` checks inputs; `setup.js` creates local configuration.

## 4. Send requests

Use [requests.http](requests.http) for Labs 1–2 and [recipe_book_app/requests.http](recipe_book_app/requests.http) for Labs 3–9. In VS Code with the **REST Client** extension, click **Send Request** above an individual request.

Run `createRecipe` before requests using its ID, `addReview` before review updates/deletion, and `login` before `/profile`. Named requests automatically supply values such as:

```http
{{createRecipe.response.body.$.recipeId}}
{{addReview.response.body.$.reviewId}}
{{login.response.body.$.accessToken}}
```

In ARC/Postman, copy the method, URL and body, then replace these expressions with previous responses' actual values. Set **Content-Type: application/json** for JSON bodies. A browser address bar only sends GET requests.

Inside Codespaces, REST Client can use `http://localhost:3000`; an external client needs the forwarded URL and its required GitHub access. Keep the classroom server private.

The seeded recipe IDs end in `9031`, `9032`, `9033`; the full first ID is `507f1f77bcf86cd799439031`. If your existing imports use different IDs, read `/recipes`. The supplied mutation examples target a newly created practice pizza, so they do not delete seed recipes.

## 5. Recipe API reference

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Greeting |
| GET | `/recipes` | Summaries in a `recipes` array |
| GET | `/recipes/:id` | Full recipe, including reviews |
| GET | `/cuisines` | Valid cuisine names/documents |
| GET | `/tags` | Valid tag names/documents |
| POST | `/recipes` | Create; `201` with `recipeId` |
| PUT | `/recipes/:id` | Update; `200` |
| DELETE | `/recipes/:id` | Delete; `200` |
| POST | `/recipes/:id/reviews` | Add review; `201` with `reviewId` |
| PUT | `/recipes/:recipeId/reviews/:reviewId` | Update review; `200` |
| DELETE | `/recipes/:recipeId/reviews/:reviewId` | Delete review; `200` |
| POST | `/users` | Signup; `201` |
| POST | `/login` | Login; returns `accessToken` |
| GET | `/profile` | Protected token/profile information |
| GET | `/ai/recipes?q=...` | AI search |
| POST | `/ai/recipes` | Parse and save a recipe; `201` |

### Search

| Query | Meaning |
| --- | --- |
| `?name=chicken` | Case-insensitive partial name |
| `?cuisine=Italian` | Case-insensitive partial cuisine |
| `?tags=quick,easy` | **Any** exact tag name: OR |
| `?ingredients=tomato,garam` | **All** ingredient terms: AND; partial, case-insensitive |
| `?cuisine=Indian&tags=spicy` | Both conditions must match |

`name`/`cuisine` accept up to 200 characters. Comma-separated `tags`/`ingredients` accept 1–20 nonempty values and up to 1,000 characters. Regex symbols are treated literally.

### Recipe request schema

Send **all eight fields** for both POST and PUT, including unchanged fields. Complete pizza JSON examples are in `requests.http`.

| Field | Accepted input |
| --- | --- |
| `name` | Nonempty string, maximum 200 characters |
| `cuisine` | Existing cuisine **name**, maximum 200 characters |
| `prepTime`, `cookTime` | JSON numbers, 0–10,080 minutes |
| `servings` | Integer, 1–1,000 |
| `ingredients` | Array of 1–100 objects |
| `ingredients[].name` | Nonempty string, maximum 200 characters |
| `ingredients[].amount` | Positive number up to 1,000,000,000, or nonempty text up to 100 characters, e.g. `"to taste"` |
| `ingredients[].unit` | String, maximum 50 characters; empty is allowed |
| `instructions` | 1–100 nonempty strings, maximum 2,000 characters each |
| `tags` | 0–20 existing tag **names**; duplicates are removed |

Send names such as `"Italian"` and `["quick","easy"]`, not embedded objects. The server resolves them into `{_id, name}` references. PUT preserves `_id` and the separately managed `reviews` array.

### Reviews

POST/PUT review bodies require `{ "user": "Adzan", "rating": 5, "comment": "Easy to follow." }`.

`user` is nonempty text up to 100 characters; `rating` is an integer from 1 to 5; `comment` is nonempty text up to 2,000 characters. The server supplies `review_id` and `date`; editing refreshes the date. Read reviews through GET `/recipes/:id`.

### Login

POST the following to `/users`, then `/login`:

```json
{"email":"adzan@example.com","password":"class-demo-123"}
```

These are classroom example credentials. Email is trimmed/lowercased. Signup passwords require at least eight characters and at most 72 UTF-8 bytes; the database stores a bcrypt hash. Repeated signup returns `409`; use login instead.

Send `/profile` with `Authorization: Bearer YOUR_TOKEN`. Tokens expire after one hour; log in again when needed.

By default, **only `/profile` requires login**, matching the handout. Other routes are accessible to anyone who can reach this classroom server. Set `REQUIRE_AUTH_FOR_WRITES=true` in `.env` and restart to require Bearer tokens for recipe/review writes and **both AI routes**. This authenticates users but does not enforce ownership or administrator roles. Keep the learning server private.

## 6. Enable Gemini

Labs 1–8 work without an AI key. For Lab 9, create a key in [Google AI Studio](https://aistudio.google.com/api-keys), edit `.env`, then restart:

```dotenv
GEMINI_API_KEY=YOUR_OWN_KEY
GEMINI_MODEL=gemini-3.5-flash-lite
```

The default follows Google's [deprecation guidance](https://aistudio.google.com/docs/deprecations), checked **4 November 2026**, replacing the handout's deprecated `gemini-2.5-flash`.

Try `/ai/recipes?q=quick%20Italian%20pasta`. `q` allows 1,000 characters. Responses include recipes and interpreted `searchParams`. Cuisines/tags use OR, ingredients use AND, and categories combine with AND. Unsupported/empty interpreted filters return no matches and a message.

POST `/ai/recipes` accepts `{ "recipeText": "..." }`, up to 10,000 characters. Use the complete Italian pasta example in `requests.http`; write string newlines as `\n`. Generated recipes are validated before insertion. Cuisine/tags must already exist; the handout's Mediterranean example needs an additional cuisine entry.

Missing configuration returns `503`; provider failures or invalid output return `502`. Automated tests supply AI responses and do not make live Gemini requests.

## 7. Tests and GitHub Actions

| Working folder | Command | What runs |
| --- | --- | --- |
| Repository root | `npm test` | Express basics HTTP tests |
| `recipe_book_app` | `npm test` | Gemini and credential-safe database diagnostic tests; no database/key required |
| `recipe_book_app` | `npm run test:integration` | HTTP, CRUD, reviews, authentication, and seed tests against real MongoDB |
| `recipe_book_app` | `npm run test:all` | All recipe-app suites |

Integration tests start a disposable MongoDB process, which may require a binary download. Alternatively, set `TEST_MONGO_URI` to a suitable test server. They create/remove only a fresh `recipe_book_test_*` database, not `recipe_book`.

The GitHub **Lab tests** workflow runs all suites on pushes and pull requests using Node 24 and a MongoDB service. Open the repository's **Actions** tab for current results. Atlas credentials and live Gemini access still need verification in your own environment.

Verified on **4 November 2026**: **all 35 tests passed** — 7 Express HTTP tests, 12 Gemini unit tests, and 16 integration tests against a real MongoDB server. There were no failures or skipped tests. See the [successful GitHub Actions run](https://github.com/Allspark1983/Lab01/actions/runs/41783686409) for source commit `82edd111`. AI responses were mocked for tests; no live Atlas or Gemini request was made.

## 8. Troubleshooting and handout corrections

| Problem | Next step |
| --- | --- |
| Port already in use | Stop the other app with Ctrl+C. |
| `/recipes` not found | Start the app inside `recipe_book_app`. |
| Database startup or seed fails | Run `npm run check-db` inside `recipe_book_app` and follow its diagnostic. |
| Secret configuration error | Run setup; for an existing placeholder, run `npm run secret` and update `.env`. |
| Invalid cuisine/tag | Seed, then check `/cuisines` and `/tags`. |
| `400` | Check JSON, required fields, types, and the 24-character ID. |
| `401` | Log in and provide a valid Bearer token. |
| `409` | Email already registered; log in instead. |

Corrections include retaining both list/detail routes and IDs, preserving reviews during PUT, validating inputs/ObjectIds, returning appropriate `400`/`401` errors, escaping search text, enforcing unique normalized emails, and checking AI output. Recipe fixtures add deterministic IDs and empty reviews while preserving the handout's ingredients/instructions.

`.gitignore` excludes `.env`, dependencies, logs and caches. `.env.example` contains placeholders. Keep actual credentials and keys out of commits.

## References

The supplied **RESTFul APIs Using Mongo and Express** handout defines the exercises and sample data. Implementation references:

- [Express routing](https://expressjs.com/en/guide/routing.html) and [error handling](https://expressjs.com/en/guide/error-handling.html)
- [MongoDB Node.js driver](https://www.mongodb.com/docs/drivers/node/current/) and [Extended JSON](https://www.mongodb.com/docs/manual/reference/mongodb-extended-json/)
- [Gemini model](https://aistudio.google.com/docs/models/gemini-3.5-flash-lite), [structured output](https://aistudio.google.com/docs/structured-output), and [SDK configuration](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html)
- [VS Code REST Client request variables](https://github.com/Huachao/vscode-restclient#request-variables)
