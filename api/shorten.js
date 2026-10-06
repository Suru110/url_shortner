'use strict';
const { validateUrl, validateExpiry } = require('../src/lib/validator');
const { generateCode, validateAlias } = require('../src/lib/generator');
const store   = require('./_lib/store');
const auth    = require('./_lib/auth');
const { created, badRequest, conflict, unauthorized, serverError, handleOptions } = require('./_lib/helpers');

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : (process.env.BASE_URL || 'http://localhost:3000');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') { res.status(405).end(); return; }

  // Optional auth
  let ownerId = null;
  try { ownerId = auth.requireAuth(req).userId; } catch { /* anonymous OK */ }

  const { url, alias, expiresAt } = req.body || {};

  const urlResult = validateUrl(url);
  if (!urlResult.valid) return badRequest(res, urlResult.error);

  const expiryResult = validateExpiry(expiresAt);
  if (!expiryResult.valid) return badRequest(res, expiryResult.error);

  const baseItem = {
    longUrl:       urlResult.url,
    createdAt:     new Date().toISOString(),
    clickCount:    0,
    lastAccessedAt: null,
    isCustomAlias: false,
    ...(ownerId && { ownerId }),
    ...(expiryResult.timestamp && { expiresAt: expiryResult.timestamp }),
  };

  // Custom alias path
  if (alias) {
    const ar = validateAlias(alias);
    if (!ar.valid) return badRequest(res, ar.error);
    try {
      const item = { ...baseItem, shortCode: alias, isCustomAlias: true };
      await store.putUrl(item);
      return created(res, buildResp(alias, item, BASE_URL));
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException')
        return conflict(res, `The alias "${alias}" is already in use`);
      console.error(e);
      return serverError(res);
    }
  }

  // Auto-generate with collision retry
  for (let i = 0; i < 5; i++) {
    const shortCode = generateCode(7);
    try {
      const item = { ...baseItem, shortCode };
      await store.putUrl(item);
      return created(res, buildResp(shortCode, item, BASE_URL));
    } catch (e) {
      if (e.name !== 'ConditionalCheckFailedException') { console.error(e); return serverError(res); }
    }
  }
  return serverError(res, 'Could not generate unique code');
};

function buildResp(shortCode, item, base) {
  return {
    shortCode,
    shortUrl:      `${base}/${shortCode}`,
    longUrl:       item.longUrl,
    createdAt:     item.createdAt,
    isCustomAlias: item.isCustomAlias,
    ...(item.expiresAt && { expiresAt: new Date(item.expiresAt * 1000).toISOString() }),
  };
}
