/**
 * POST /shorten
 *
 * Accepts: { url, alias?, expiresAt? }
 * Returns: { shortCode, shortUrl, longUrl, createdAt, expiresAt? }
 *
 * Collision handling strategy:
 * 1. Generate a random 7-char base62 code (or use the custom alias).
 * 2. Attempt a conditional PutItem with attribute_not_exists(shortCode).
 * 3. If DynamoDB throws ConditionalCheckFailedException, generate a new code
 *    and retry — up to MAX_RETRIES times.
 * 4. If a custom alias collides, we return 409 immediately (no retries —
 *    the user chose that alias deliberately).
 *
 * With 62^7 ≈ 3.5T combinations the probability of a collision at 1M records
 * is ~0.000002% per attempt, so 3 retries is more than sufficient in practice.
 */

'use strict';

const { generateCode, validateAlias } = require('../lib/generator');
const { validateUrl, validateExpiry } = require('../lib/validator');
const { putUrl } = require('../lib/db');
const { created, badRequest, conflict, serverError, log } = require('../lib/response');

const MAX_RETRIES = 5;

exports.handler = async (event, context) => {
  log('INFO', 'shorten invoked', { path: event.rawPath }, context);

  // Parse and validate request body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return badRequest('Request body must be valid JSON');
  }

  const { url, alias, expiresAt, ownerId } = body;

  // Validate the target URL
  const urlResult = validateUrl(url);
  if (!urlResult.valid) {
    return badRequest(urlResult.error);
  }

  // Validate optional expiry
  const expiryResult = validateExpiry(expiresAt);
  if (!expiryResult.valid) {
    return badRequest(expiryResult.error);
  }

  // Validate optional custom alias
  let useCustomAlias = false;
  if (alias !== undefined && alias !== null && alias !== '') {
    const aliasResult = validateAlias(alias);
    if (!aliasResult.valid) {
      return badRequest(aliasResult.error);
    }
    useCustomAlias = true;
  }

  const createdAt = new Date().toISOString();

  // Build base item — only include expiresAt if set (DynamoDB TTL field)
  const baseItem = {
    longUrl: urlResult.url,
    createdAt,
    clickCount: 0,
    lastAccessedAt: null,
    isCustomAlias: useCustomAlias,
    ...(ownerId && { ownerId }),
    ...(expiryResult.timestamp && { expiresAt: expiryResult.timestamp }),
  };

  // --- Custom alias path: single attempt, 409 on collision ---
  if (useCustomAlias) {
    const item = { ...baseItem, shortCode: alias };
    try {
      await putUrl(item);
      log('INFO', 'custom alias created', { shortCode: alias }, context);
      return created(buildResponse(alias, item));
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        log('WARN', 'custom alias collision', { alias }, context);
        return conflict(`The alias "${alias}" is already in use. Please choose a different alias.`);
      }
      log('ERROR', 'failed to save custom alias', { alias, error: err.message }, context);
      return serverError();
    }
  }

  // --- Auto-generated code path: retry on collision ---
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const shortCode = generateCode(7);
    const item = { ...baseItem, shortCode };

    try {
      await putUrl(item);
      log('INFO', 'short code created', { shortCode, attempt }, context);
      return created(buildResponse(shortCode, item));
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        log('WARN', 'short code collision, retrying', { shortCode, attempt }, context);
        lastError = err;
        continue; // Try again with a new code
      }
      log('ERROR', 'unexpected DynamoDB error', { error: err.message, attempt }, context);
      return serverError();
    }
  }

  // Exhausted retries (astronomically unlikely in practice)
  log('ERROR', 'exhausted collision retries', { retries: MAX_RETRIES }, context);
  return serverError('Could not generate a unique short code. Please try again.');
};

/**
 * Build the success response body from the saved item.
 */
function buildResponse(shortCode, item) {
  const BASE_URL = process.env.BASE_URL || 'https://example.com';
  const response = {
    shortCode,
    shortUrl: `${BASE_URL}/${shortCode}`,
    longUrl: item.longUrl,
    createdAt: item.createdAt,
    isCustomAlias: item.isCustomAlias,
  };
  if (item.expiresAt) {
    // Return ISO string to the client, not the raw epoch
    response.expiresAt = new Date(item.expiresAt * 1000).toISOString();
  }
  return response;
}
