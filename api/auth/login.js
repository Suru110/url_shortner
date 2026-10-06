'use strict';
const auth    = require('../_lib/auth');
const { ok, badRequest, unauthorized, serverError, handleOptions } = require('../_lib/helpers');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') { res.status(405).end(); return; }
  try {
    const result = await auth.login(req.body || {});
    ok(res, result);
  } catch (e) {
    if (e.status === 400) badRequest(res, e.message);
    else if (e.status === 401) unauthorized(res, e.message);
    else serverError(res, e.message);
  }
};
