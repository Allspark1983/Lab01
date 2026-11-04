// Alternative manual method from Lab 8. Never commit the printed secret.
const crypto = require('node:crypto');
console.log(crypto.randomBytes(64).toString('hex'));
