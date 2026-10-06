'use strict';

/**
 * store.js — unified data store.
 *
 * In Vercel production: uses Upstash Redis (set UPSTASH_REDIS_REST_URL + TOKEN).
 * In local dev:         falls back to the JSON file store (localDb.js).
 */

let _store;

function getStore() {
  if (_store) return _store;

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    _store = require('./redisStore');
  } else {
    // Local dev fallback — JSON file
    _store = require('../../src/lib/localDb');
  }
  return _store;
}

module.exports = {
  getUrl:               (...a) => getStore().getUrl(...a),
  putUrl:               (...a) => getStore().putUrl(...a),
  incrementClickCount:  (...a) => getStore().incrementClickCount(...a),
  deleteUrl:            (...a) => getStore().deleteUrl(...a),
  listUrls:             (...a) => getStore().listUrls(...a),
  getUserById:          (...a) => getStore().getUserById(...a),
  getUserByEmail:       (...a) => getStore().getUserByEmail(...a),
  putUser:              (...a) => getStore().putUser(...a),
  updateUser:           (...a) => getStore().updateUser(...a),
};
