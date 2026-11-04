// Create local configuration without overwriting an existing .env.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const destination = path.join(__dirname, '.env');
if (fs.existsSync(destination)) {
  console.log('.env already exists; nothing was changed.');
} else {
  const template = fs.readFileSync(path.join(__dirname, '.env.example'), 'utf8');
  const secret = crypto.randomBytes(64).toString('hex');
  fs.writeFileSync(destination, template.replace(
    'replace-with-a-random-secret-of-at-least-32-characters', secret
  ), { flag: 'wx', mode: 0o600 });
  console.log('Created .env with a random TOKEN_SECRET. Edit MONGO_URI before seeding.');
}
