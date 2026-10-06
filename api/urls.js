'use strict';
const store = require('./_lib/store');
const auth  = require('./_lib/auth');
const { ok, unauthorized, serverError, handleOptions } = require('./_lib/helpers');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') { res.status(405).end(); return; }

  let ownerId;
  try { ownerId = auth.requireAuth(req).userId; }
  catch (e) { unauthorized(res, e.message); return; }

  try {
    const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
    const cursor = req.query.cursor || null;
    const result = await store.listUrls(ownerId, cursor, limit);

    const items = result.items.map(item => ({
      shortCode:      item.shortCode,
      longUrl:        item.longUrl,
      createdAt:      item.createdAt,
      lastAccessedAt: item.lastAccessedAt || null,
      clickCount:     item.clickCount || 0,
      isCustomAlias:  item.isCustomAlias || false,
      isExpired:      item.expiresAt ? item.expiresAt < Math.floor(Date.now() / 1000) : false,
      ...(item.expiresAt && { expiresAt: new Date(item.expiresAt * 1000).toISOString() }),
    }));

    ok(res, { items, count: items.length, ...(result.lastKey && { nextCursor: result.lastKey }) });
  } catch (e) {
    console.error(e);
    serverError(res);
  }
};
