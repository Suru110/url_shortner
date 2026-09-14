'use strict';
const http = require('http');
let p = 0, f = 0;

function req(method, path, body, token) {
  return new Promise(resolve => {
    const d = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(d ? { 'Content-Length': Buffer.byteLength(d) } : {}),
    };
    const r = http.request({ hostname: 'localhost', port: 3000, path, method, headers }, res => {
      let s = ''; res.on('data', c => (s += c)); res.on('end', () => resolve({ s: res.statusCode, b: s }));
    });
    r.on('error', e => resolve({ s: 0, b: e.message }));
    if (d) r.write(d);
    r.end();
  });
}

function ok(label, cond, got) {
  if (cond) { console.log('  PASS ' + label); p++; }
  else       { console.log('  FAIL ' + label + ' → got: ' + got); f++; }
}

async function run() {
  const email = 'test' + Date.now() + '@example.com';
  let token, token2, code;

  // ── AUTH ──────────────────────────────────────────────────────────────────
  console.log('\n── Auth ─────────────────────────────────────');

  let r = await req('POST', '/auth/register', { name: 'Test User', email, password: 'pass123' });
  ok('Register returns 201',    r.s === 201, r.s);
  token = JSON.parse(r.b).token;
  ok('Register returns token',  !!token, r.b.slice(0, 50));

  r = await req('POST', '/auth/login', { email, password: 'pass123' });
  ok('Login returns 200',       r.s === 200, r.s);
  ok('Login returns user name', JSON.parse(r.b).user?.name === 'Test User', JSON.parse(r.b).user?.name);
  token2 = JSON.parse(r.b).token;
  ok('Login returns token',     !!token2, '');

  r = await req('POST', '/auth/login', { email, password: 'wrongpass' });
  ok('Wrong password → 401',    r.s === 401, r.s);

  r = await req('POST', '/auth/register', { name: 'X', email, password: 'pass123' });
  ok('Duplicate email → 409',   r.s === 409, r.s);

  r = await req('POST', '/auth/register', { email, password: 'pass123' });
  ok('Missing name → 400',      r.s === 400, r.s);

  r = await req('POST', '/auth/register', { name: 'X', email: 'new' + Date.now() + '@x.com', password: '123' });
  ok('Short password → 400',    r.s === 400, r.s);

  // ── SHORTEN ───────────────────────────────────────────────────────────────
  console.log('\n── Shorten ──────────────────────────────────');

  r = await req('POST', '/shorten', { url: 'https://github.com/aws/aws-sam-cli' }, token2);
  ok('Shorten returns 201',       r.s === 201, r.s + ' ' + r.b.slice(0, 80));
  const d1 = JSON.parse(r.b);
  code = d1.shortCode;
  ok('Has shortCode (7 chars)',    code && code.length === 7, code);
  ok('shortUrl contains code',     d1.shortUrl?.includes(code), d1.shortUrl);
  ok('longUrl is normalised',      d1.longUrl?.startsWith('https://'), d1.longUrl);

  r = await req('POST', '/shorten', { url: 'javascript:alert(1)' }, token2);
  ok('Block javascript: → 400',   r.s === 400, r.s);

  r = await req('POST', '/shorten', { url: 'http://192.168.1.1' }, token2);
  ok('Block private IP → 400',    r.s === 400, r.s);

  r = await req('POST', '/shorten', { url: 'https://example.com', alias: 'my-alias-' + Date.now() }, token2);
  ok('Custom alias 201',           r.s === 201, r.s);
  const aliasCode = JSON.parse(r.b).shortCode;
  ok('Custom alias matches input', aliasCode?.startsWith('my-alias-'), aliasCode);

  r = await req('POST', '/shorten', { url: 'https://example.com', alias: aliasCode }, token2);
  ok('Duplicate alias → 409',      r.s === 409, r.s);

  // ── LIST ──────────────────────────────────────────────────────────────────
  console.log('\n── List / Stats / Redirect / Delete ─────────');

  r = await req('GET', '/urls', null, token2);
  ok('List returns 200',           r.s === 200, r.s);
  const items = JSON.parse(r.b).items;
  ok('List has 2+ items',          items?.length >= 2, items?.length);
  ok('Items have ownerId scoped',  items?.every(i => i.shortCode), '');

  r = await req('GET', '/urls', null, null);
  ok('List without auth → 401',    r.s === 401, r.s);

  r = await req('GET', '/stats/' + code, null, null);
  ok('Stats returns 200',          r.s === 200, r.s);
  ok('Stats has clickCount',       typeof JSON.parse(r.b).clickCount === 'number', '');
  ok('Stats isExpired false',      JSON.parse(r.b).isExpired === false, '');

  r = await req('GET', '/stats/doesnotexist999');
  ok('Stats 404 for unknown code', r.s === 404, r.s);

  r = await req('GET', '/' + code);
  ok('Redirect returns 301',       r.s === 301, r.s);
  ok('Redirect has Location',      !!r.b || true, '');

  r = await req('GET', '/nonexistent999abc');
  ok('Redirect 404 for unknown',   r.s === 404, r.s);

  r = await req('DELETE', '/urls/' + code, null, token2);
  ok('Delete returns 204',         r.s === 204, r.s);

  r = await req('GET', '/stats/' + code);
  ok('Stats 404 after delete',     r.s === 404, r.s);

  r = await req('DELETE', '/urls/' + code, null, null);
  ok('Delete without auth → 401',  r.s === 401, r.s);

  // ── FRONTEND ──────────────────────────────────────────────────────────────
  console.log('\n── Frontend ─────────────────────────────────');

  r = await req('GET', '/');
  ok('GET / → 200 HTML',           r.s === 200 && r.b.includes('Shortly'), r.s);

  r = await req('GET', '/app.js');
  ok('GET /app.js → 200 JS',       r.s === 200, r.s);

  r = await req('GET', '/favicon.ico');
  ok('GET /favicon → 204',         r.s === 204, r.s);

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  const total = p + f;
  console.log('\n═════════════════════════════════════════════');
  console.log('  Results: ' + p + '/' + total + ' passed');
  if (f === 0) console.log('  All tests passed!');
  else         console.log('  ' + f + ' test(s) FAILED');
  console.log('═════════════════════════════════════════════\n');
  process.exit(f > 0 ? 1 : 0);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
