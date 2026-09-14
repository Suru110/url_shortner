/**
 * Short-code generator using crypto.randomBytes → base62 encoding.
 *
 * Design decisions:
 * - base62 alphabet (a-z, A-Z, 0-9) gives 62^7 ≈ 3.5 trillion combinations —
 *   more than enough for a demo and well into production scale before collision
 *   rates become meaningful.
 * - We use crypto.randomBytes (CSPRNG) rather than Math.random() to avoid
 *   predictable sequences.
 * - The caller is responsible for collision detection via conditional DynamoDB
 *   writes; this module just generates candidates.
 */

'use strict';

const { randomBytes } = require('crypto');

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const BASE = ALPHABET.length; // 62
const DEFAULT_LENGTH = 7;

/**
 * Generate a random base62 string of the given length.
 * @param {number} [length=7] - Number of characters to generate.
 * @returns {string} Random base62 string.
 */
function generateCode(length = DEFAULT_LENGTH) {
  // Request more bytes than needed to avoid modulo bias.
  // Each output char needs ~6 bits of entropy; a byte gives 8 bits.
  // We use rejection sampling: skip bytes >= floor(256/62)*62 = 248.
  const result = [];
  const REJECT_THRESHOLD = 256 - (256 % BASE); // 248 — avoids modulo bias

  while (result.length < length) {
    const buf = randomBytes(length * 2); // over-allocate to reduce loop iterations
    for (let i = 0; i < buf.length && result.length < length; i++) {
      const byte = buf[i];
      if (byte < REJECT_THRESHOLD) {
        result.push(ALPHABET[byte % BASE]);
      }
    }
  }

  return result.join('');
}

/**
 * Validate that an alias string is safe to use as a short code.
 * Must be 3–50 chars, alphanumeric + hyphens only.
 * @param {string} alias
 * @returns {{ valid: boolean, error?: string }}
 */
function validateAlias(alias) {
  if (typeof alias !== 'string') {
    return { valid: false, error: 'Alias must be a string' };
  }
  if (alias.length < 3 || alias.length > 50) {
    return { valid: false, error: 'Alias must be between 3 and 50 characters' };
  }
  if (!/^[a-zA-Z0-9-]+$/.test(alias)) {
    return { valid: false, error: 'Alias may only contain letters, numbers, and hyphens' };
  }
  // Block reserved paths used by the API itself
  const RESERVED = new Set(['shorten', 'stats', 'urls', 'health', 'favicon.ico']);
  if (RESERVED.has(alias.toLowerCase())) {
    return { valid: false, error: `"${alias}" is a reserved path and cannot be used as an alias` };
  }
  return { valid: true };
}

module.exports = { generateCode, validateAlias, ALPHABET, BASE };
