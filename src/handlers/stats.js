/**
 * GET /stats/{shortCode}
 *
 * Returns analytics for a short URL:
 *   - clickCount, createdAt, lastAccessedAt, longUrl, expiresAt, isCustomAlias
 *
 * Does NOT expose the ownerId to avoid information leakage.
 * In a production system with auth, add ownership verification here.
 */

'use strict';

const { getUrl } = require('../lib/db');
const { ok, notFound, gone, serverError, log } = require('../lib/response');

exports.handler = async (event, context) => {
  const shortCode = (event.pathParameters?.shortCode || '').trim();

  log('INFO', 'stats invoked', { shortCode }, context);

  if (!shortCode) {
    return notFound('Short code is required');
  }

  let item;
  try {
    item = await getUrl(shortCode);
  } catch (err) {
    log('ERROR', 'DynamoDB get failed', { shortCode, error: err.message }, context);
    return serverError();
  }

  if (!item) {
    return notFound(`No URL found for short code "${shortCode}"`);
  }

  // Check expiry — still return stats for expired URLs (useful for debugging)
  const nowEpoch = Math.floor(Date.now() / 1000);
  const isExpired = item.expiresAt && item.expiresAt < nowEpoch;

  const response = {
    shortCode: item.shortCode,
    longUrl: item.longUrl,
    createdAt: item.createdAt,
    lastAccessedAt: item.lastAccessedAt || null,
    clickCount: item.clickCount || 0,
    isCustomAlias: item.isCustomAlias || false,
    isExpired: isExpired || false,
    ...(item.expiresAt && {
      expiresAt: new Date(item.expiresAt * 1000).toISOString(),
    }),
  };

  log('INFO', 'stats returned', { shortCode, clickCount: response.clickCount }, context);
  return ok(response);
};
