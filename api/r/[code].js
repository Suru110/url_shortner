'use strict';
/**
 * api/r/[code].js — Vercel serverless redirect handler.
 *
 * Route: GET /r/{shortCode}
 * vercel.json rewrites /{shortCode} → /r/{shortCode} so that
 * short links still look like https://your-app.vercel.app/abc1234
 */

const store = require('../_lib/store');
const { notFound, serverError, handleOptions } = require('../_lib/helpers');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') { res.status(405).end(); return; }

  const shortCode = req.query.code;
  if (!shortCode) { notFound(res, 'Missing short code'); return; }

  try {
    const item = await store.getUrl(shortCode);
    if (!item) { notFound(res, `No URL found for "${shortCode}"`); return; }

    const nowEpoch = Math.floor(Date.now() / 1000);
    if (item.expiresAt && item.expiresAt < nowEpoch) {
      res.status(410).json({ error: 'This link has expired' });
      return;
    }

    // Fire-and-forget click increment (don't await — keeps redirect fast)
    store.incrementClickCount(shortCode).catch(console.error);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.redirect(301, item.longUrl);
  } catch (e) {
    console.error(e);
    serverError(res);
  }
};
