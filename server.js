'use strict';

const http        = require('http');
const fs          = require('fs');
const pathModule  = require('path');
const urlModule   = require('url');

// ── Env vars must be set before loading any src modules ──────────────────────
process.env.DYNAMODB_ENDPOINT     = process.env.DYNAMODB_ENDPOINT     || 'http://localhost:8000';
process.env.URLS_TABLE            = process.env.URLS_TABLE            || 'urls-local';
process.env.USERS_TABLE           = process.env.USERS_TABLE           || 'users-local';
process.env.AWS_REGION            = process.env.AWS_REGION            || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID     = process.env.AWS_ACCESS_KEY_ID     || 'AKIAIOSFODNN7EXAMPLE';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
process.env.BASE_URL              = process.env.BASE_URL              || 'http://localhost:3000';
process.env.CORS_ORIGIN           = process.env.CORS_ORIGIN           || '*';
process.env.JWT_SECRET            = process.env.JWT_SECRET            || 'local-dev-secret-change-in-prod';

// Google OAuth config — set these in .env or export before running
// GOOGLE_CLIENT_ID=...
// GOOGLE_CLIENT_SECRET=...
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const BASE_URL             = process.env.BASE_URL;

// ── Load handlers & auth ──────────────────────────────────────────────────────
const shortenHandler   = require('./src/handlers/shorten');
const redirectHandler  = require('./src/handlers/redirect');
const statsHandler     = require('./src/handlers/stats');
const listUrlsHandler  = require('./src/handlers/listUrls');
const deleteUrlHandler = require('./src/handlers/deleteUrl');
const auth             = require('./src/lib/auth');

const PORT = process.env.PORT || 3000;

// ── CORS ──────────────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

// ── Utilities ─────────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    let d = ''; req.on('data', c => (d += c)); req.on('end', () => resolve(d || null));
  });
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Connection': 'close' });
  res.end(data);
}

function buildLambdaEvent(req, body, pathParameters = {}) {
  const parsed = urlModule.parse(req.url, true);
  return {
    version: '2.0',
    rawPath: parsed.pathname,
    rawQueryString: parsed.search ? parsed.search.slice(1) : '',
    headers: req.headers,
    queryStringParameters: Object.keys(parsed.query).length ? parsed.query : undefined,
    pathParameters,
    requestContext: { requestId: `local-${Date.now()}`, http: { method: req.method } },
    body: body || null,
    isBase64Encoded: false,
  };
}

function sendLambda(res, lambdaResp) {
  const body    = lambdaResp.body || '';
  const headers = { ...CORS, ...(lambdaResp.headers || {}), 'Content-Length': Buffer.byteLength(body), 'Connection': 'close' };
  res.writeHead(lambdaResp.statusCode || 200, headers);
  res.end(body);
}

function serveFile(res, filePath) {
  const abs  = pathModule.join(__dirname, filePath);
  if (!fs.existsSync(abs)) { json(res, 404, { error: 'Not Found' }); return; }
  const ext  = pathModule.extname(abs);
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };
  const data = fs.readFileSync(abs);
  res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain', 'Content-Length': data.length, 'Cache-Control': 'no-cache', 'Connection': 'close' });
  res.end(data);
}

const lambdaCtx = { awsRequestId: 'local-dev' };

// ── Router ────────────────────────────────────────────────────────────────────
async function router(req, res) {
  const method = req.method.toUpperCase();
  const parsed = urlModule.parse(req.url, true);
  const path   = parsed.pathname.replace(/\/$/, '') || '/';

  // Preflight
  if (method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  const rawBody = await readBody(req);
  let body = null;
  if (rawBody) { try { body = JSON.parse(rawBody); } catch { body = rawBody; } }

  // ── Static files ──────────────────────────────────────────────────────────
  if (path === '/' || path === '/index.html')  { serveFile(res, 'frontend/index.html'); return; }
  if (path === '/app.js')                      { serveFile(res, 'frontend/app.js');     return; }
  if (path === '/favicon.ico')                 { res.writeHead(204); res.end();          return; }

  // ── Auth routes ───────────────────────────────────────────────────────────
  if (method === 'POST' && path === '/auth/register') {
    try {
      const result = await auth.register(body || {});
      json(res, 201, result);
    } catch (e) {
      json(res, e.status || 500, { error: e.message });
    }
    return;
  }

  if (method === 'POST' && path === '/auth/login') {
    try {
      const result = await auth.login(body || {});
      json(res, 200, result);
    } catch (e) {
      json(res, e.status || 500, { error: e.message });
    }
    return;
  }

  // Google OAuth step 1 — redirect to Google
  if (method === 'GET' && path === '/auth/google') {
    if (!GOOGLE_CLIENT_ID) {
      json(res, 503, { error: 'Google OAuth not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your environment.' });
      return;
    }
    const params = new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      redirect_uri:  `${BASE_URL}/auth/google/callback`,
      response_type: 'code',
      scope:         'openid email profile',
      access_type:   'offline',
    });
    res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, 'Connection': 'close' });
    res.end();
    return;
  }

  // Google OAuth step 2 — callback
  if (method === 'GET' && path === '/auth/google/callback') {
    const code = parsed.query.code;
    if (!code) { json(res, 400, { error: 'Missing code from Google' }); return; }
    try {
      // Exchange code for tokens
      const tokenRes = await googleTokenExchange(code);
      const profile  = await googleGetProfile(tokenRes.access_token);
      const result   = await auth.loginWithGoogle({
        googleId: profile.sub,
        email:    profile.email,
        name:     profile.name,
        picture:  profile.picture,
      });
      // Redirect to frontend with token in query string
      res.writeHead(302, { Location: `${BASE_URL}/?token=${result.token}&name=${encodeURIComponent(result.user.name)}`, 'Connection': 'close' });
      res.end();
    } catch (e) {
      console.error('[google callback]', e.message);
      res.writeHead(302, { Location: `${BASE_URL}/?error=${encodeURIComponent('Google login failed')}`, 'Connection': 'close' });
      res.end();
    }
    return;
  }

  if (method === 'GET' && path === '/auth/me') {
    try {
      const claims = auth.requireAuth(req);
      const user   = await auth.getUserById(claims.userId);
      if (!user) { json(res, 404, { error: 'User not found' }); return; }
      json(res, 200, auth.safeUser(user));
    } catch (e) {
      json(res, e.status || 401, { error: e.message });
    }
    return;
  }

  // ── URL API routes ────────────────────────────────────────────────────────
  if (method === 'POST' && path === '/shorten') {
    // Attach ownerId if token provided (optional auth)
    let ownerId = null;
    try { ownerId = auth.requireAuth(req).userId; } catch { /* anonymous allowed */ }
    const event = buildLambdaEvent(req, rawBody, {});
    if (ownerId && event.body) {
      try {
        const b = JSON.parse(event.body);
        b.ownerId = ownerId;
        event.body = JSON.stringify(b);
      } catch { /* ignore */ }
    }
    try { sendLambda(res, await shortenHandler.handler(event, lambdaCtx)); } catch (e) { json(res, 500, { error: e.message }); }
    return;
  }

  if (method === 'GET' && path === '/urls') {
    // Require auth — only return this user's URLs
    let ownerId = null;
    try { ownerId = auth.requireAuth(req).userId; } catch (e) { json(res, e.status || 401, { error: e.message }); return; }
    const event = buildLambdaEvent(req, rawBody, {});
    // Inject ownerId into query so listUrls filters by owner
    event.queryStringParameters = { ...(event.queryStringParameters || {}), ownerId };
    try { sendLambda(res, await listUrlsHandler.handler(event, lambdaCtx)); } catch (e) { json(res, 500, { error: e.message }); }
    return;
  }

  if (method === 'GET' && path.startsWith('/stats/')) {
    const shortCode = path.slice('/stats/'.length);
    const event = buildLambdaEvent(req, rawBody, { shortCode });
    try { sendLambda(res, await statsHandler.handler(event, lambdaCtx)); } catch (e) { json(res, 500, { error: e.message }); }
    return;
  }

  if (method === 'DELETE' && path.startsWith('/urls/')) {
    let ownerId = null;
    try { ownerId = auth.requireAuth(req).userId; } catch (e) { json(res, e.status || 401, { error: e.message }); return; }
    const shortCode = path.slice('/urls/'.length);
    const event = buildLambdaEvent(req, rawBody, { shortCode });
    event.headers = { ...event.headers, 'x-owner-id': ownerId };
    try { sendLambda(res, await deleteUrlHandler.handler(event, lambdaCtx)); } catch (e) { json(res, 500, { error: e.message }); }
    return;
  }

  // ── Short code redirect (catch-all) ───────────────────────────────────────
  if (method === 'GET' && path !== '/' && !path.includes('.') && !path.startsWith('/auth/')) {
    const shortCode = path.slice(1);
    const event = buildLambdaEvent(req, rawBody, { shortCode });
    try { sendLambda(res, await redirectHandler.handler(event, lambdaCtx)); } catch (e) { json(res, 500, { error: e.message }); }
    return;
  }

  json(res, 404, { error: 'Not Found', path });
}

// ── Google token exchange ─────────────────────────────────────────────────────
async function googleTokenExchange(code) {
  const https = require('https');
  const params = new URLSearchParams({
    code,
    client_id:     GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri:  `${BASE_URL}/auth/google/callback`,
    grant_type:    'authorization_code',
  });
  return new Promise((resolve, reject) => {
    const data = params.toString();
    const req  = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let body = ''; res.on('data', c => (body += c)); res.on('end', () => {
        const j = JSON.parse(body);
        if (j.error) reject(new Error(j.error_description || j.error));
        else resolve(j);
      });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

async function googleGetProfile(accessToken) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    https.get({ hostname: 'www.googleapis.com', path: '/oauth2/v3/userinfo', headers: { Authorization: `Bearer ${accessToken}` } }, (res) => {
      let body = ''; res.on('data', c => (body += c)); res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const start = Date.now();
  try { await router(req, res); } catch (e) {
    console.error('[unhandled]', e.message);
    if (!res.headersSent) json(res, 500, { error: 'Internal Server Error' });
  }
  console.log(`${req.method} ${req.url} → ${res.statusCode} (${Date.now() - start}ms)`);
});

server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║  URL Shortener  →  http://localhost:${PORT}          ║`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  AUTH                                            ║');
  console.log('║    POST /auth/register   POST /auth/login        ║');
  console.log('║    GET  /auth/google     GET  /auth/me           ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  API                                             ║');
  console.log('║    POST /shorten         GET  /urls              ║');
  console.log('║    GET  /stats/:code     DELETE /urls/:code      ║');
  console.log('║    GET  /:code  (redirect)                       ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Google OAuth: ${GOOGLE_CLIENT_ID ? 'CONFIGURED ✅' : 'not configured (add GOOGLE_CLIENT_ID)'}`.padEnd(51) + '║');
  console.log('╚══════════════════════════════════════════════════╝\n');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n❌ Port ${PORT} already in use.\n`);
  else console.error('Server error:', e);
  process.exit(1);
});
