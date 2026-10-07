'use strict';

const http       = require('http');
const fs         = require('fs');
const pathModule = require('path');
const urlModule  = require('url');

// ── Must set env BEFORE loading any src module ────────────────────────────────
process.env.USE_LOCAL_DB          = 'true';   // use JSON file, no Docker needed
process.env.URLS_TABLE            = 'urls-local';
process.env.USERS_TABLE           = 'users-local';
process.env.AWS_REGION            = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID     = 'AKIAIOSFODNN7EXAMPLE';
process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
// BASE_URL is intentionally left unset here when not provided externally.
// Each request derives the correct host dynamically (see buildEvent + shorten handler),
// so short links work on localhost, LAN IPs, phones, and production domains alike.
process.env.BASE_URL              = process.env.BASE_URL  || '';
process.env.CORS_ORIGIN           = '*';
process.env.JWT_SECRET            = process.env.JWT_SECRET || 'local-dev-secret-change-in-prod';

// ── Load handlers & auth ──────────────────────────────────────────────────────
const shortenH   = require('./src/handlers/shorten');
const redirectH  = require('./src/handlers/redirect');
const statsH     = require('./src/handlers/stats');
const listUrlsH  = require('./src/handlers/listUrls');
const deleteUrlH = require('./src/handlers/deleteUrl');
const auth       = require('./src/lib/auth');

const PORT = process.env.PORT || 3000;

// ── CORS ──────────────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise(resolve => {
    let d = ''; req.on('data', c => (d += c)); req.on('end', () => resolve(d || null));
  });
}

function send(res, status, body, extra = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  const ct   = typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json';
  res.writeHead(status, { ...CORS, 'Content-Type': ct, 'Content-Length': Buffer.byteLength(data), 'Connection': 'close', ...extra });
  res.end(data);
}

function buildEvent(req, rawBody, pathParameters = {}) {
  const p = urlModule.parse(req.url, true);
  return {
    version: '2.0', rawPath: p.pathname,
    rawQueryString: p.search ? p.search.slice(1) : '',
    headers: req.headers,
    queryStringParameters: Object.keys(p.query).length ? p.query : undefined,
    pathParameters,
    requestContext: { requestId: `local-${Date.now()}`, http: { method: req.method } },
    body: rawBody || null,
    isBase64Encoded: false,
  };
}

function sendLambda(res, r) {
  const body    = r.body || '';
  const headers = { ...CORS, ...(r.headers || {}), 'Content-Length': Buffer.byteLength(body), 'Connection': 'close' };
  res.writeHead(r.statusCode || 200, headers);
  res.end(body);
}

function serveStatic(res, relPath) {
  const abs = pathModule.join(__dirname, relPath);
  if (!fs.existsSync(abs)) { send(res, 404, { error: 'Not Found' }); return; }
  const ext  = pathModule.extname(abs);
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css' };
  const data = fs.readFileSync(abs);
  res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain', 'Content-Length': data.length, 'Cache-Control': 'no-cache', 'Connection': 'close' });
  res.end(data);
}

const lambdaCtx = { awsRequestId: 'local-dev' };

// ── Router ────────────────────────────────────────────────────────────────────
async function router(req, res) {
  const method  = req.method.toUpperCase();
  const parsed  = urlModule.parse(req.url, true);
  const path    = parsed.pathname.replace(/\/$/, '') || '/';

  if (method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  // ── Health check (used by Render and load balancers) ─────────────────────
  if (method === 'GET' && path === '/api/health') {
    send(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
    return;
  }

  const rawBody = await readBody(req);
  let body = null;
  if (rawBody) { try { body = JSON.parse(rawBody); } catch { body = rawBody; } }

  // ── Static files ──────────────────────────────────────────────────────────
  if (path === '/' || path === '/index.html') { serveStatic(res, 'frontend/index.html'); return; }
  if (path === '/app.js')                     { serveStatic(res, 'frontend/app.js');     return; }
  if (path === '/favicon.ico')                { res.writeHead(204); res.end();            return; }

  // ── Auth: register ────────────────────────────────────────────────────────
  if (method === 'POST' && path === '/auth/register') {
    try {
      const r = await auth.register(body || {});
      send(res, 201, r);
    } catch (e) { send(res, e.status || 500, { error: e.message }); }
    return;
  }

  // ── Auth: login ───────────────────────────────────────────────────────────
  if (method === 'POST' && path === '/auth/login') {
    try {
      const r = await auth.login(body || {});
      send(res, 200, r);
    } catch (e) { send(res, e.status || 500, { error: e.message }); }
    return;
  }

  // ── Auth: me ──────────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/auth/me') {
    try {
      const claims = auth.requireAuth(req);
      const user   = auth.getUserById(claims.userId);
      if (!user) { send(res, 404, { error: 'User not found' }); return; }
      send(res, 200, auth.safeUser(user));
    } catch (e) { send(res, e.status || 401, { error: e.message }); }
    return;
  }

  // ── POST /shorten ─────────────────────────────────────────────────────────
  if (method === 'POST' && path === '/shorten') {
    let ownerId = null;
    try { ownerId = auth.requireAuth(req).userId; } catch { /* anonymous OK */ }
    const event = buildEvent(req, rawBody, {});
    if (ownerId && event.body) {
      try { const b = JSON.parse(event.body); b.ownerId = ownerId; event.body = JSON.stringify(b); } catch { /* ignore */ }
    }
    try { sendLambda(res, await shortenH.handler(event, lambdaCtx)); }
    catch (e) { console.error('[shorten]', e); send(res, 500, { error: e.message }); }
    return;
  }

  // ── GET /urls ─────────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/urls') {
    let ownerId;
    try { ownerId = auth.requireAuth(req).userId; }
    catch (e) { send(res, e.status || 401, { error: e.message }); return; }
    const event = buildEvent(req, rawBody, {});
    event.queryStringParameters = { ...(event.queryStringParameters || {}), ownerId };
    try { sendLambda(res, await listUrlsH.handler(event, lambdaCtx)); }
    catch (e) { console.error('[listUrls]', e); send(res, 500, { error: e.message }); }
    return;
  }

  // ── GET /stats/:code ─────────────────────────────────────────────────────
  if (method === 'GET' && path.startsWith('/stats/')) {
    const shortCode = path.slice('/stats/'.length);
    try { sendLambda(res, await statsH.handler(buildEvent(req, rawBody, { shortCode }), lambdaCtx)); }
    catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

  // ── DELETE /urls/:code ────────────────────────────────────────────────────
  if (method === 'DELETE' && path.startsWith('/urls/')) {
    let ownerId;
    try { ownerId = auth.requireAuth(req).userId; }
    catch (e) { send(res, e.status || 401, { error: e.message }); return; }
    const shortCode = path.slice('/urls/'.length);
    const event = buildEvent(req, rawBody, { shortCode });
    event.headers = { ...event.headers, 'x-owner-id': ownerId };
    try { sendLambda(res, await deleteUrlH.handler(event, lambdaCtx)); }
    catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

  // ── Redirect /{shortCode} ─────────────────────────────────────────────────
  if (method === 'GET' && path !== '/' && !path.includes('.') && !path.startsWith('/auth')) {
    const shortCode = path.slice(1);
    try { sendLambda(res, await redirectH.handler(buildEvent(req, rawBody, { shortCode }), lambdaCtx)); }
    catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

  send(res, 404, { error: 'Not Found', path });
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const t = Date.now();
  try { await router(req, res); } catch (e) {
    console.error('[unhandled]', e);
    if (!res.headersSent) send(res, 500, { error: 'Internal Server Error' });
  }
  console.log(`${req.method} ${req.url} → ${res.statusCode} (${Date.now() - t}ms)`);
});

server.listen(PORT, '0.0.0.0', () => {
  const dataFile = pathModule.join(__dirname, 'data', 'db.json');
  // Resolve the machine's LAN IP so users know the address to share
  const os      = require('os');
  const lanIp   = Object.values(os.networkInterfaces())
    .flat()
    .find(n => n.family === 'IPv4' && !n.internal)?.address || 'localhost';
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║  URL Shortener dev server                        ║`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Local  →  http://localhost:${PORT}                  ║`);
  console.log(`║  LAN    →  http://${lanIp}:${PORT}`.padEnd(51) +  '║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  Short links auto-use the host the request came  ║');
  console.log('║  from — no BASE_URL config needed.               ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  No Docker required — data stored in data/db.json║');
  console.log(`║  DB file: ${dataFile.slice(-40).padEnd(40)}║`);
  console.log('╚══════════════════════════════════════════════════╝\n');
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use.`);
    console.error(`   Run this to free it:  npx kill-port ${PORT}\n`);
  } else console.error('Server error:', e);
  process.exit(1);
});
