/**
 * HTTP response helpers.
 *
 * Centralises CORS headers and JSON serialisation so every handler
 * returns a consistent shape. API Gateway HTTP API expects:
 *   { statusCode, headers, body }
 */

'use strict';

// Allow the frontend origin; comma-separated list for multi-origin support.
// Overridden at deploy time via CORS_ORIGIN env var.
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || '*';

const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key',
  'Cache-Control': 'no-store',
};

/**
 * Build a JSON response.
 * @param {number} statusCode
 * @param {Object} body
 * @param {Object} [extraHeaders]
 */
function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...BASE_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
  };
}

/**
 * 200 OK
 */
function ok(body) {
  return json(200, body);
}

/**
 * 201 Created
 */
function created(body) {
  return json(201, body);
}

/**
 * 301 Moved Permanently redirect.
 * Used for permanent redirects (SEO-friendly, browsers cache it).
 */
function redirect301(location) {
  return {
    statusCode: 301,
    headers: {
      Location: location,
      'Cache-Control': 'no-store', // Don't cache short-lived or expiring links
    },
    body: '',
  };
}

/**
 * 302 Found redirect.
 * Use for temporary / analytics-tracked redirects.
 */
function redirect302(location) {
  return {
    statusCode: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
    },
    body: '',
  };
}

/**
 * 400 Bad Request
 */
function badRequest(message, details) {
  return json(400, { error: 'Bad Request', message, ...(details && { details }) });
}

/**
 * 404 Not Found
 */
function notFound(message = 'Not found') {
  return json(404, { error: 'Not Found', message });
}

/**
 * 409 Conflict — e.g. alias already taken
 */
function conflict(message) {
  return json(409, { error: 'Conflict', message });
}

/**
 * 410 Gone — URL existed but has expired
 */
function gone(message = 'This link has expired') {
  return json(410, { error: 'Gone', message });
}

/**
 * 500 Internal Server Error
 */
function serverError(message = 'Internal server error') {
  return json(500, { error: 'Internal Server Error', message });
}

/**
 * Structured log helper — writes JSON to stdout for CloudWatch.
 * Automatically attaches the Lambda request ID if available.
 *
 * @param {'INFO'|'WARN'|'ERROR'} level
 * @param {string} message
 * @param {Object} [meta] - Additional context fields.
 * @param {Object} [context] - Lambda context object (for requestId).
 */
function log(level, message, meta = {}, context = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    requestId: context.awsRequestId || meta.requestId || 'local',
    ...meta,
  };
  // Lambda captures stdout → CloudWatch Logs
  console.log(JSON.stringify(entry)); // eslint-disable-line no-console
}

module.exports = {
  json,
  ok,
  created,
  redirect301,
  redirect302,
  badRequest,
  notFound,
  conflict,
  gone,
  serverError,
  log,
};
