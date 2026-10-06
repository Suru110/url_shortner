'use strict';
const store = require('../_lib/store');
const { ok, notFound, serverError, handleOptions } = require('../_lib/helpers');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') { res.status(405).end(); return; }

  const shortCode = req.query.code;
  if (!shortCode) { notFound(res); return; }

  try {
    const item = await store.getUrl(shortCode);
    if (!item) { notFound(res, `No URL found for "${shortCode}"`); return; }

    const nowEpoch = Math.floor(Date.now() / 1000);
    ok(res, {
      shortCode:      item.shortCode,
      longUrl:        item.longUrl,
      createdAt:      item.createdAt,
      lastAccessedAt: item.lastAccessedAt || null,
      clickCount:     item.clickCount || 0,
      isCustomAlias:  item.isCustomAlias || false,
      isExpired:      item.expiresAt ? item.expiresAt < nowEpoch : false,
      ...(item.expiresAt && { expiresAt: new Date(item.expiresAt * 1000).toISOString() }),
    });
  } catch (e) {
    console.error(e);
    serverError(res);
  }
};
