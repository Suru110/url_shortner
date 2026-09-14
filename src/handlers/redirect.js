/**
 * GET /{shortCode}
 *
 * Looks up the short code in DynamoDB and issues a 301 redirect.
 * If the record is expired or not found, returns a 404/410 HTML page
 * (browsers display this directly so we return text/html).
 *
 * Click count increment is fire-and-forget — we do NOT await it on the
 * critical redirect path. The worst case is we miss a count on a Lambda
 * timeout; the redirect itself is never delayed.
 */

'use strict';

const { getUrl, incrementClickCount } = require('../lib/db');
const { redirect301, notFound, gone, serverError, log } = require('../lib/response');

exports.handler = async (event, context) => {
  const shortCode = (event.pathParameters?.shortCode || '').trim();

  log('INFO', 'redirect invoked', { shortCode }, context);

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
    log('INFO', 'short code not found', { shortCode }, context);
    return notFoundPage(shortCode);
  }

  // Check expiry explicitly — DynamoDB TTL deletion can lag up to 48 h.
  // expiresAt is stored as Unix epoch in seconds.
  if (item.expiresAt && item.expiresAt < Math.floor(Date.now() / 1000)) {
    log('INFO', 'short code expired', { shortCode, expiresAt: item.expiresAt }, context);
    return expiredPage(shortCode);
  }

  // Fire-and-forget click increment — don't block the redirect
  incrementClickCount(shortCode).catch((err) => {
    // Log but swallow — analytics failure must never break redirects
    log('WARN', 'click count increment failed', { shortCode, error: err.message }, context);
  });

  log('INFO', 'redirecting', { shortCode, longUrl: item.longUrl }, context);
  return redirect301(item.longUrl);
};

// --- HTML error pages ---
// Returning HTML directly so browsers show a user-friendly page
// rather than raw JSON.

function notFoundPage(shortCode) {
  return {
    statusCode: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Link Not Found</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 10vh auto; padding: 0 1rem; text-align: center; color: #111; }
    h1 { font-size: 4rem; margin: 0; color: #e74c3c; }
    p  { color: #555; }
    a  { color: #3498db; }
  </style>
</head>
<body>
  <h1>404</h1>
  <h2>Link Not Found</h2>
  <p>The short link <code>${escapeHtml(shortCode)}</code> doesn't exist or may have been deleted.</p>
  <p><a href="/">Create a new short link →</a></p>
</body>
</html>`,
  };
}

function expiredPage(shortCode) {
  return {
    statusCode: 410,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Link Expired</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 10vh auto; padding: 0 1rem; text-align: center; color: #111; }
    h1 { font-size: 4rem; margin: 0; color: #e67e22; }
    p  { color: #555; }
    a  { color: #3498db; }
  </style>
</head>
<body>
  <h1>410</h1>
  <h2>Link Expired</h2>
  <p>The short link <code>${escapeHtml(shortCode)}</code> has expired and is no longer available.</p>
  <p><a href="/">Create a new short link →</a></p>
</body>
</html>`,
  };
}

/** Minimal HTML escaping to prevent XSS in the shortCode echo */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
