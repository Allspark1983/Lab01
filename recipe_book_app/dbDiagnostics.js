// Driver errors can contain credentials. Return only our own fixed messages.
function uriProblem(uri) {
  if (typeof uri !== 'string' || !uri.trim()) {
    return '[MISSING_URI] Set MONGO_URI in recipe_book_app/.env, then save the file.';
  }
  if (/(?:<|%3c)(?:db_password|password|db_username|username|hostname)(?:>|%3e)/i.test(uri)) {
    return '[URI_PLACEHOLDER] MONGO_URI still contains a placeholder. Replace it with your database user details, remove the angle brackets, and percent-encode special password characters.';
  }
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri)) {
    return '[URI_FORMAT] MONGO_URI must start with mongodb:// or mongodb+srv://. Copy the Drivers connection string into recipe_book_app/.env on one line.';
  }
  return null;
}

function validateMongoUri(uri) {
  const problem = uriProblem(uri);
  if (problem) throw new Error(problem);
}

// A server-selection error often wraps the useful cause inside a topology Map.
function errorChain(error) {
  const pending = [error];
  const seen = new Set();
  const result = [];
  while (pending.length && result.length < 64) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    result.push(current);
    pending.push(current.cause, current.reason, current.error, current.errorResponse);
    if (current.servers instanceof Map) {
      pending.push(...Array.from(current.servers.values()).slice(0, 32));
    }
    if (Array.isArray(current.errors)) pending.push(...current.errors.slice(0, 32));
  }
  return result;
}

function diagnoseMongoError(error, uri) {
  const configuration = uriProblem(uri);
  if (configuration) return configuration;
  const errors = errorChain(error);
  const hasCode = (...codes) => errors.some(item => codes.some(code => item.code === code ||
    (typeof code === 'number' && item.code === String(code))));
  const hasName = (...names) => errors.some(item => names.includes(item.name));
  const hasMessage = pattern => errors.some(item => typeof item.message === 'string' && pattern.test(item.message));

  if (hasCode(18) || errors.some(item => item.codeName === 'AuthenticationFailed') ||
      hasMessage(/bad auth|authentication failed|unable to authenticate/i)) {
    return '[AUTHENTICATION] MongoDB rejected the database login. Check the database username and password in MONGO_URI, percent-encode special password characters, and use the authentication settings from Atlas Connect > Drivers. The database password is separate from your Atlas website login.';
  }
  if (hasCode(13) || errors.some(item => item.codeName === 'Unauthorized')) {
    return '[PERMISSIONS] MongoDB denied this operation. Give the database user readWrite access to the database selected by DB_NAME (recipe_book by default), then retry.';
  }
  if (hasCode(11000)) {
    return '[DUPLICATE_DATA] Existing data conflicts with a unique index. Check for duplicate user emails or sample IDs in the relevant collection before retrying.';
  }
  if (hasName('MongoParseError', 'URIError') || hasCode('ERR_INVALID_URL')) {
    return '[URI_FORMAT] MongoDB could not parse the connection settings. Copy the complete Drivers URI, replace its placeholders, and percent-encode special characters in the username and password.';
  }
  if (hasName('MongoInvalidArgumentError')) {
    return '[CONFIGURATION] MongoDB rejected a connection setting. Check MONGO_URI and DB_NAME in recipe_book_app/.env.';
  }
  if (hasCode('ENOTFOUND', 'ENODATA', 'EAI_AGAIN', 'ESERVFAIL') ||
      errors.some(item => /^(querySrv|queryTxt|getaddrinfo)$/.test(item.syscall || ''))) {
    return '[DNS] The database hostname or SRV record could not be resolved. Recopy the hostname from Atlas Connect > Drivers, check the cluster is available, and check DNS from the Codespace or computer running Node.js.';
  }
  if (errors.some(item => typeof item.code === 'string' && /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(item.code)) ||
      hasMessage(/certificate has expired|unable to verify|self.signed certificate|tls.*alert|ssl routines/i)) {
    return '[TLS] The secure connection failed. Check your system clock, certificate trust, and any network proxy. Keep TLS and certificate verification enabled.';
  }
  if (hasName('MongoServerSelectionError', 'MongoNetworkError', 'MongoNetworkTimeoutError') ||
      hasCode('ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH')) {
    if (/^mongodb:\/\/(?:[^/?#]*@)?(?:localhost|127\.0\.0\.1|\[::1\])(?=[:/,?]|$)/i.test(uri)) {
      return '[LOCAL_CONNECTION] MONGO_URI points to this machine, but a usable MongoDB server was not reached. In Codespaces, start MongoDB inside the Codespace or replace MONGO_URI with your Atlas Drivers URI.';
    }
    return '[NETWORK] A usable MongoDB server could not be reached. For Atlas, check that the cluster is running and that Network Access allows the outbound IP of the Codespace or computer running Node.js. Also check firewall and network connectivity; this error alone does not prove the IP access list is the cause.';
  }
  return '[UNCLASSIFIED] The database operation failed without a recognized connection error. Share this category and the command that failed for further troubleshooting. Keep .env and passwords private.';
}

module.exports = { validateMongoUri, diagnoseMongoError };
