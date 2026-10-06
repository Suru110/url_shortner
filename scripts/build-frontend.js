'use strict';
/**
 * build-frontend.js
 *
 * Copies frontend/ → public/ and injects window.APP_CONFIG into index.html.
 *
 * Usage:
 *   node scripts/build-frontend.js              # Vercel (same-origin /api calls)
 *   API_BASE=https://my-app.onrender.com \
 *     node scripts/build-frontend.js            # Render backend URL
 */

const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const SRC     = path.join(ROOT, 'frontend');
const DEST    = path.join(ROOT, 'public');

// When deploying frontend to Vercel the API lives on the same origin under /api.
// When the frontend is served from a CDN/static host pointing at a Render backend,
// set API_BASE to the full Render service URL (e.g. https://my-app.onrender.com).
const apiBase = process.env.API_BASE || '';

// ── Copy frontend/ → public/ ─────────────────────────────────────────────────
if (!fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true });

for (const file of fs.readdirSync(SRC)) {
  fs.copyFileSync(path.join(SRC, file), path.join(DEST, file));
}

// ── Inject APP_CONFIG into public/index.html ─────────────────────────────────
const indexPath = path.join(DEST, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

const configScript = `<script>window.APP_CONFIG = { apiBase: ${JSON.stringify(apiBase)} };</script>`;

// Replace the placeholder script tag written in frontend/index.html
html = html.replace(
  /<!-- APP_CONFIG injected at build time.*?-->\s*<script>window\.APP_CONFIG = window\.APP_CONFIG \|\| \{\};<\/script>/s,
  configScript,
);

fs.writeFileSync(indexPath, html, 'utf8');

console.log(`✓ Frontend built → public/`);
console.log(`  API_BASE = "${apiBase || '(same origin)'}"`);
