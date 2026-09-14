/**
 * URL validation and sanitization.
 *
 * Security goals:
 * - Block dangerous schemes: javascript:, data:, vbscript:, file:, blob:
 * - Only allow http: and https:
 * - Reject URLs that are clearly malformed
 * - Validate hostname is not a private/loopback IP (SSRF mitigation)
 */

'use strict';

// Schemes that can execute code or access local resources
const BLOCKED_SCHEMES = new Set([
  'javascript',
  'data',
  'vbscript',
  'file',
  'blob',
  'about',
  'chrome',
  'chrome-extension',
]);

// Private / loopback IP ranges (SSRF mitigation — block obvious cases)
const PRIVATE_IP_PATTERNS = [
  /^127\./,                          // 127.0.0.0/8  loopback
  /^10\./,                           // 10.0.0.0/8   private
  /^192\.168\./,                     // 192.168.0.0/16 private
  /^172\.(1[6-9]|2\d|3[0-1])\./,    // 172.16.0.0/12 private
  /^169\.254\./,                     // 169.254.0.0/16 link-local (AWS metadata)
  /^::1$/,                           // IPv6 loopback
  /^fc00:/,                          // IPv6 unique local
  /^fe80:/,                          // IPv6 link-local
];

const MAX_URL_LENGTH = 2048;

/**
 * Validate and sanitize a URL string.
 * @param {string} url - Raw URL from user input.
 * @returns {{ valid: boolean, url?: string, error?: string }}
 */
function validateUrl(url) {
  if (typeof url !== 'string') {
    return { valid: false, error: 'URL must be a string' };
  }

  const trimmed = url.trim();

  if (!trimmed) {
    return { valid: false, error: 'URL is required' };
  }

  if (trimmed.length > MAX_URL_LENGTH) {
    return { valid: false, error: `URL must not exceed ${MAX_URL_LENGTH} characters` };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'URL is malformed — please include the scheme (https://)' };
  }

  // Strip trailing colon from protocol for comparison
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();

  if (BLOCKED_SCHEMES.has(scheme)) {
    return { valid: false, error: `URL scheme "${scheme}:" is not allowed` };
  }

  if (scheme !== 'http' && scheme !== 'https') {
    return { valid: false, error: 'Only http and https URLs are accepted' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block empty hostname
  if (!hostname) {
    return { valid: false, error: 'URL must have a valid hostname' };
  }

  // Block AWS metadata endpoint explicitly
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    return { valid: false, error: 'URL hostname is not allowed' };
  }

  // Block private IP ranges
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return { valid: false, error: 'URL hostname is not allowed (private or loopback address)' };
    }
  }

  // Return the href which URL constructor has normalised (lowercased scheme+host, etc.)
  return { valid: true, url: parsed.href };
}

/**
 * Validate an optional expiration date string (ISO 8601).
 * Must be in the future.
 * @param {string} expiresAt - ISO date string.
 * @returns {{ valid: boolean, timestamp?: number, error?: string }}
 */
function validateExpiry(expiresAt) {
  if (expiresAt === undefined || expiresAt === null) {
    return { valid: true }; // No expiry is fine
  }

  const date = new Date(expiresAt);
  if (isNaN(date.getTime())) {
    return { valid: false, error: 'expiresAt must be a valid ISO 8601 date string' };
  }

  const nowPlusFiveMinutes = Date.now() + 5 * 60 * 1000;
  if (date.getTime() <= nowPlusFiveMinutes) {
    return { valid: false, error: 'expiresAt must be at least 5 minutes in the future' };
  }

  // DynamoDB TTL expects Unix epoch in seconds
  return { valid: true, timestamp: Math.floor(date.getTime() / 1000) };
}

module.exports = { validateUrl, validateExpiry, MAX_URL_LENGTH };
