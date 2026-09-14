/**
 * GET /urls
 *
 * Lists all shortened URLs with optional pagination.
 *
 * Query params:
 *   - limit  (number, 1–100, default 20)
 *   - cursor (base64-encoded DynamoDB LastEvaluatedKey for pagination)
 *
 * NOTE: This uses a full-table Scan which is fine for demo scale.
 * For production, add a GSI (e.g. on createdAt) and use Query instead.
 *
 * In a multi-tenant system, filter by ownerId derived from the
 * authenticated user's JWT / API key — see the ownerId parameter in db.listUrls().
 */

'use strict';

const { listUrls } = require('../lib/db');
const { ok, badRequest, serverError, log } = require('../lib/response');

exports.handler = async (event, context) => {
  log('INFO', 'listUrls invoked', {}, context);

  const qs = event.queryStringParameters || {};

  // Parse and validate limit
  let limit = parseInt(qs.limit, 10) || 20;
  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;

  // Decode cursor (base64-encoded JSON of DynamoDB's LastEvaluatedKey)
  let lastKey;
  if (qs.cursor) {
    try {
      const decoded = Buffer.from(qs.cursor, 'base64').toString('utf8');
      lastKey = JSON.parse(decoded);
    } catch {
      return badRequest('Invalid cursor value');
    }
  }

  // Optional owner scoping — in a real system, derive this from auth context
  const ownerId = qs.ownerId || null; // Don't trust this in production without auth!

  let result;
  try {
    result = await listUrls(ownerId, lastKey, limit);
  } catch (err) {
    log('ERROR', 'listUrls DynamoDB error', { error: err.message }, context);
    return serverError();
  }

  // Encode next cursor for the client
  const nextCursor = result.lastKey
    ? Buffer.from(JSON.stringify(result.lastKey)).toString('base64')
    : null;

  // Strip internal fields before returning
  const items = result.items.map(sanitizeItem);

  const response = {
    items,
    count: items.length,
    ...(nextCursor && { nextCursor }),
  };

  log('INFO', 'listUrls returned', { count: items.length }, context);
  return ok(response);
};

/**
 * Remove internal/sensitive fields from a URL record before returning it.
 */
function sanitizeItem(item) {
  const { shortCode, longUrl, createdAt, lastAccessedAt, clickCount, isCustomAlias, expiresAt } =
    item;
  return {
    shortCode,
    longUrl,
    createdAt,
    lastAccessedAt: lastAccessedAt || null,
    clickCount: clickCount || 0,
    isCustomAlias: isCustomAlias || false,
    ...(expiresAt && { expiresAt: new Date(expiresAt * 1000).toISOString() }),
    isExpired: expiresAt ? expiresAt < Math.floor(Date.now() / 1000) : false,
  };
}
