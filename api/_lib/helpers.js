'use strict';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  res.status(status).json(body);
}

function ok(res, body)              { send(res, 200, body); }
function created(res, body)         { send(res, 201, body); }
function noContent(res)             { Object.entries(CORS).forEach(([k,v])=>res.setHeader(k,v)); res.status(204).end(); }
function badRequest(res, message)   { send(res, 400, { error: message }); }
function unauthorized(res, message) { send(res, 401, { error: message }); }
function conflict(res, message)     { send(res, 409, { error: message }); }
function notFound(res, message)     { send(res, 404, { error: message || 'Not found' }); }
function serverError(res, message)  { send(res, 500, { error: message || 'Internal server error' }); }

function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    res.status(204).end();
    return true;
  }
  return false;
}

module.exports = { ok, created, noContent, badRequest, unauthorized, conflict, notFound, serverError, handleOptions, CORS };
