'use strict';
const store = require('../_lib/store');
const auth  = require('../_lib/auth');
const { noContent, unauthorized, notFound, serverError, handleOptions } = require('../_lib/helpers');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'DELETE') { res.status(405).end(); return; }

  let ownerId;
  try { ownerId = auth.requireAuth(req).userId; }
  catch (e) { unauthorized(res, e.message); return; }

  const shortCode = req.query.code;
  try {
    await store.deleteUrl(shortCode, ownerId);
    noContent(res);
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') notFound(res, `"${shortCode}" not found`);
    else { console.error(e); serverError(res); }
  }
};
