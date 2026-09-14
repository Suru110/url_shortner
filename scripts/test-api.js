/**
 * End-to-end API test script.
 * Run: node scripts/test-api.js
 * Tests all 5 endpoints against the running local server.
 */
'use strict';

const http = require('http');

const BASE = 'http://localhost:3000';
let shortCode = '';
let passed = 0;
let failed = 0;

// ── HTTP helper ───────────────────────────────────────────────────────────────
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { json = data; }
        resolve({ status: res.statusCode, body: json, raw: data, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Test runner ───────────────────────────────────────────────────────────────
function assert(condition, label, extra = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label} ${extra}`);
    failed++;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n══════════════════════════════════════════');
  console.log('  URL Shortener — End-to-End API Tests');
  console.log('══════════════════════════════════════════\n');

  // ── 1. POST /shorten ─────────────────────────────────────────────────────
  console.log('1️⃣  POST /shorten — shorten a URL');
  try {
    const r = await request('POST', '/shorten', { url: 'https://www.example.com/very/long/path?q=1' });
    assert(r.status === 201,           'Status 201 Created', `got ${r.status}`);
    assert(r.body.shortCode,           'Has shortCode',      r.body.shortCode);
    assert(r.body.shortUrl,            'Has shortUrl',       r.body.shortUrl);
    assert(r.body.longUrl,             'Has longUrl',        r.body.longUrl);
    assert(r.body.createdAt,           'Has createdAt',      r.body.createdAt);
    assert(r.body.isCustomAlias === false, 'isCustomAlias false');
    shortCode = r.body.shortCode;
    console.log(`     → shortCode: ${shortCode}`);
    console.log(`     → shortUrl:  ${r.body.shortUrl}`);
  } catch (e) { console.log(`  ❌ Request failed: ${e.message}`); failed++; }

  // ── 2. POST /shorten — custom alias ──────────────────────────────────────
  console.log('\n2️⃣  POST /shorten — custom alias');
  try {
    const r = await request('POST', '/shorten', { url: 'https://nodejs.org', alias: 'my-node' });
    assert(r.status === 201,               'Status 201 Created',  `got ${r.status}`);
    assert(r.body.shortCode === 'my-node', 'shortCode is my-node', r.body.shortCode);
    assert(r.body.isCustomAlias === true,  'isCustomAlias true');
    console.log(`     → shortCode: ${r.body.shortCode}`);
  } catch (e) { console.log(`  ❌ Request failed: ${e.message}`); failed++; }

  // ── 3. POST /shorten — collision on alias ────────────────────────────────
  console.log('\n3️⃣  POST /shorten — alias collision → 409');
  try {
    const r = await request('POST', '/shorten', { url: 'https://example.org', alias: 'my-node' });
    assert(r.status === 409, 'Status 409 Conflict', `got ${r.status}`);
    assert(r.body.error === 'Conflict', 'Body has Conflict error');
    console.log(`     → message: ${r.body.message}`);
  } catch (e) { console.log(`  ❌ Request failed: ${e.message}`); failed++; }

  // ── 4. POST /shorten — invalid URL ───────────────────────────────────────
  console.log('\n4️⃣  POST /shorten — invalid URL → 400');
  try {
    const r = await request('POST', '/shorten', { url: 'javascript:alert(1)' });
    assert(r.status === 400, 'Status 400 Bad Request', `got ${r.status}`);
    assert(r.body.error === 'Bad Request', 'Body has Bad Request error');
  } catch (e) { console.log(`  ❌ Request failed: ${e.message}`); failed++; }

  // ── 5. GET /stats/{shortCode} ─────────────────────────────────────────────
  console.log('\n5️⃣  GET /stats/{shortCode}');
  try {
    const r = await request('GET', `/stats/${shortCode}`);
    assert(r.status === 200,                'Status 200 OK',       `got ${r.status}`);
    assert(r.body.shortCode === shortCode,  'shortCode matches');
    assert(typeof r.body.clickCount === 'number', 'clickCount is number', r.body.clickCount);
    assert(r.body.isExpired === false,      'isExpired false');
    assert(r.body.longUrl,                  'Has longUrl');
    console.log(`     → clicks:  ${r.body.clickCount}`);
    console.log(`     → longUrl: ${r.body.longUrl}`);
  } catch (e) { console.log(`  ❌ Request failed: ${e.message}`); failed++; }

  // ── 6. GET /stats/{shortCode} — not found ────────────────────────────────
  console.log('\n6️⃣  GET /stats/nonexistent → 404');
  try {
    const r = await request('GET', '/stats/nonexistent999');
    assert(r.status === 404, 'Status 404 Not Found', `got ${r.status}`);
  } catch (e) { console.log(`  ❌ Request failed: ${e.message}`); failed++; }

  // ── 7. GET /urls ──────────────────────────────────────────────────────────
  console.log('\n7️⃣  GET /urls — list all');
  try {
    const r = await request('GET', '/urls');
    assert(r.status === 200,              'Status 200 OK',     `got ${r.status}`);
    assert(Array.isArray(r.body.items),   'items is array');
    assert(r.body.items.length >= 2,      'At least 2 items',  `got ${r.body.items.length}`);
    assert(typeof r.body.count === 'number', 'count is number');
    console.log(`     → total items: ${r.body.count}`);
    r.body.items.forEach(i => console.log(`       • ${i.shortCode} → ${i.longUrl.slice(0,50)}`));
  } catch (e) { console.log(`  ❌ Request failed: ${e.message}`); failed++; }

  // ── 8. GET /{shortCode} — redirect ───────────────────────────────────────
  console.log('\n8️⃣  GET /{shortCode} — redirect');
  try {
    const r = await request('GET', `/${shortCode}`);
    assert(r.status === 301,       'Status 301 Redirect',  `got ${r.status}`);
    assert(r.headers.location,     'Has Location header',  r.headers.location);
    console.log(`     → Location: ${r.headers.location}`);
  } catch (e) { console.log(`  ❌ Request failed: ${e.message}`); failed++; }

  // ── 9. GET /{shortCode} — not found ──────────────────────────────────────
  console.log('\n9️⃣  GET /badcode999 → 404 HTML page');
  try {
    const r = await request('GET', '/badcode999');
    assert(r.status === 404,                    'Status 404',         `got ${r.status}`);
    assert(r.headers['content-type'].includes('text/html'), 'HTML response');
  } catch (e) { console.log(`  ❌ Request failed: ${e.message}`); failed++; }

  // ── 10. DELETE /urls/{shortCode} ─────────────────────────────────────────
  console.log('\n🔟  DELETE /urls/my-node');
  try {
    const r = await request('DELETE', '/urls/my-node');
    assert(r.status === 204, 'Status 204 No Content', `got ${r.status}`);
    console.log('     → Deleted successfully');
  } catch (e) { console.log(`  ❌ Request failed: ${e.message}`); failed++; }

  // ── 11. GET /stats after delete ─────────────────────────────────────────
  console.log('\n1️⃣1️⃣  GET /stats/my-node after delete → 404');
  try {
    const r = await request('GET', '/stats/my-node');
    assert(r.status === 404, 'Status 404 after delete', `got ${r.status}`);
  } catch (e) { console.log(`  ❌ Request failed: ${e.message}`); failed++; }

  // ── Summary ───────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log('\n══════════════════════════════════════════');
  console.log(`  Results: ${passed}/${total} passed`);
  if (failed === 0) {
    console.log('  🎉 All tests passed! App is working.');
  } else {
    console.log(`  ⚠️  ${failed} test(s) failed.`);
  }
  console.log('══════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('\n❌ Fatal error:', e.message);
  console.error('   Is the server running? → node server.js');
  process.exit(1);
});
