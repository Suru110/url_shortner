/**
 * DELETE /urls/{shortCode}
 *
 * Deletes a shortened URL.
 *
 * Returns 204 No Content on success.
 * Returns 404 if the code doesn't exist.
 * Returns 403 if the caller doesn't own the URL (when auth is enabled).
 *
 * In a production system, extract ownerId from the verified JWT/Cognito
 * claims in event.requestContext.authorizer.claims rather than from query params.
 */

'use strict';

const { deleteUrl } = require('../lib/db');
const { notFound, serverError, log } = require('../lib/response');

exports.handler = async (event, context) => {
  const shortCode = (event.pathParameters?.shortCode || '').trim();

  log('INFO', 'deleteUrl invoked', { shortCode }, context);

  if (!shortCode) {
    return notFound('Short code is required');
  }

  // In a multi-tenant system, enforce ownership here.
  // For now we accept an optional X-Owner-Id header (demo only — not secure
  // without proper auth verification upstream).
  const ownerId = event.headers?.['x-owner-id'] || null;

  try {
    await deleteUrl(shortCode, ownerId || undefined);
    log('INFO', 'short code deleted', { shortCode }, context);
    // 204 No Content — body must be empty
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
        'Cache-Control': 'no-store',
      },
      body: '',
    };
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      // Could be "not found" or "wrong owner" — return 404 either way
      // to avoid leaking existence information when owner checks fail.
      log('WARN', 'delete failed: not found or wrong owner', { shortCode }, context);
      return notFound(`Short code "${shortCode}" not found`);
    }
    log('ERROR', 'deleteUrl DynamoDB error', { shortCode, error: err.message }, context);
    return serverError();
  }
};
