'use strict';
const auth    = require('../_lib/auth');
const { created, badRequest, conflict, serverError, handleOptions } = require('../_lib/helpers');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') { res.status(405).end(); return; }
  try {
    const result = await auth.register(req.body || {});
    created(res, result);
  } catch (e) {
    if (e.status === 400) badRequest(res, e.message);
    else if (e.status === 409) conflict(res, e.message);
    else serverError(res, e.message);
  }
};
