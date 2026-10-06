'use strict';

// API base URL — overridden at deploy time via window.APP_CONFIG (injected by the HTML)
// Vercel: /api prefix (same origin, no CORS needed)
// Render: full URL of your Render backend service
const API = (window.APP_CONFIG && window.APP_CONFIG.apiBase) || '';

// ── State (persisted in localStorage) ────────────────────────────────────────
let TOKEN = localStorage.getItem('sl_token') || null;
let USER  = (() => { try { return JSON.parse(localStorage.getItem('sl_user')); } catch { return null; } })();

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (TOKEN && USER) {
    showMain();
  } else {
    showAuth();
  }
});

// ── View helpers ──────────────────────────────────────────────────────────────
function showAuth() {
  g('authView').style.display = '';
  g('mainView').style.display = 'none';
}

function showMain() {
  g('authView').style.display = 'none';
  g('mainView').style.display = '';
  g('navName').textContent = USER?.name || 'User';
  loadLinks(null);   // auto-load links on entry
}

// ── Auth tab switching ────────────────────────────────────────────────────────
function switchTab(tab) {
  const isLogin = tab === 'login';
  g('loginPanel').style.display  = isLogin ? '' : 'none';
  g('regPanel').style.display    = isLogin ? 'none' : '';
  g('tabLogin').classList.toggle('on', isLogin);
  g('tabRegister').classList.toggle('on', !isLogin);
  txt('liErr', ''); txt('rgErr', '');
}

// ── Register ──────────────────────────────────────────────────────────────────
async function doRegister() {
  txt('rgErr', '');
  const name  = g('rgName').value.trim();
  const email = g('rgEmail').value.trim();
  const pass  = g('rgPass').value;
  const pass2 = g('rgPass2').value;

  if (!name)          { txt('rgErr', 'Please enter your name'); return; }
  if (!email)         { txt('rgErr', 'Please enter your email'); return; }
  if (!pass)          { txt('rgErr', 'Please enter a password'); return; }
  if (pass !== pass2) { txt('rgErr', 'Passwords do not match'); return; }
  if (pass.length < 6){ txt('rgErr', 'Password must be at least 6 characters'); return; }

  const btn = g('rgBtn');
  setLoading(btn, true, 'Creating account…');
  try {
    const { ok, data } = await api('POST', '/auth/register', { name, email, password: pass });
    if (!ok) { txt('rgErr', data.error || 'Registration failed'); return; }
    saveSession(data.token, data.user);
    toast(`Welcome, ${data.user.name}! 🎉`, 'success');
    showMain();
  } catch { txt('rgErr', 'Cannot connect — is the server running? (npm run dev)'); }
  finally   { setLoading(btn, false, 'Create account'); }
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function doLogin() {
  txt('liErr', '');
  const email = g('liEmail').value.trim();
  const pass  = g('liPass').value;

  if (!email) { txt('liErr', 'Please enter your email'); return; }
  if (!pass)  { txt('liErr', 'Please enter your password'); return; }

  const btn = g('liBtn');
  setLoading(btn, true, 'Signing in…');
  try {
    const { ok, data } = await api('POST', '/auth/login', { email, password: pass });
    if (!ok) { txt('liErr', data.error || 'Login failed'); return; }
    saveSession(data.token, data.user);
    toast(`Welcome back, ${data.user.name}!`, 'success');
    showMain();
  } catch { txt('liErr', 'Cannot connect — is the server running? (npm run dev)'); }
  finally   { setLoading(btn, false, 'Sign in'); }
}

// ── Logout ────────────────────────────────────────────────────────────────────
function doLogout() {
  TOKEN = null; USER = null;
  localStorage.removeItem('sl_token');
  localStorage.removeItem('sl_user');
  g('linkList').innerHTML = '';
  g('resultBox').style.display = 'none';
  g('statsOut').style.display  = 'none';
  showAuth();
  toast('Signed out', 'info', 2000);
}

function saveSession(token, user) {
  TOKEN = token; USER = user;
  localStorage.setItem('sl_token', token);
  localStorage.setItem('sl_user',  JSON.stringify(user));
}

// ── Advanced options toggle ───────────────────────────────────────────────────
function toggleAdv() {
  const open = g('advFields').classList.toggle('open');
  g('advBtn').textContent = open ? '✕ Hide options' : '⚙ Advanced options';
}

// ── Shorten ───────────────────────────────────────────────────────────────────
async function doShorten(e) {
  e.preventDefault();
  txt('urlErr', ''); txt('aliasErr', '');

  const longUrl   = g('longUrl').value.trim();
  const alias     = g('alias').value.trim()    || undefined;
  const expiresAt = g('expiresAt').value        || undefined;

  if (!longUrl) { txt('urlErr', 'Please enter a URL'); g('longUrl').focus(); return; }

  const btn = g('shortenBtn');
  setLoading(btn, true, 'Shortening…');

  try {
    const body = { url: longUrl };
    if (alias)     body.alias     = alias;
    if (expiresAt) body.expiresAt = new Date(expiresAt).toISOString();

    const { ok, status, data } = await api('POST', '/shorten', body);

    if (!ok) {
      const msg = data?.error || data?.message || `Error ${status}`;
      if (msg.toLowerCase().includes('alias')) txt('aliasErr', msg);
      else txt('urlErr', msg);
      return;
    }

    // Show result inline
    const lnk = g('shortLink');
    lnk.href = lnk.textContent = data.shortUrl;
    txt('mLong',    trunc(data.longUrl, 55));
    txt('mCode',    data.shortCode);
    txt('mCreated', fmtDate(data.createdAt));
    txt('mExpires', data.expiresAt ? fmtDate(data.expiresAt) : 'Never');
    g('resultBox').style.display = 'block';
    g('resultBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    toast('Short link created!', 'success');

    // Reset form
    g('longUrl').value = '';
    if (alias)     g('alias').value    = '';
    if (expiresAt) g('expiresAt').value = '';
    g('advFields').classList.remove('open');
    g('advBtn').textContent = '⚙ Advanced options';

    // Refresh link list
    loadLinks(null);

  } catch (err) {
    console.error(err);
    txt('urlErr', 'Cannot connect — is the server running? (npm run dev)');
  } finally {
    setLoading(btn, false, 'Shorten URL');
  }
}

// ── Copy ──────────────────────────────────────────────────────────────────────
async function doCopy() {
  const href = g('shortLink').href;
  if (!href || href === window.location.href) return;
  try { await navigator.clipboard.writeText(href); }
  catch { const i=document.createElement('input'); i.value=href; document.body.appendChild(i); i.select(); document.execCommand('copy'); i.remove(); }
  toast('Copied!', 'success', 2000);
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function doStats(e) {
  e.preventDefault();
  let raw = g('statsIn').value.trim();
  if (!raw) { toast('Enter a short code or URL', 'error'); return; }

  // Extract code from full URL
  try { const p = new URL(raw); raw = p.pathname.replace(/^\//, '').split('/')[0]; } catch { /* bare code */ }
  if (!raw) { toast('Invalid short code', 'error'); return; }

  const btn = g('statsBtn');
  setLoading(btn, true, 'Loading…');
  g('statsOut').style.display = 'none';

  try {
    const { ok, status, data } = await api('GET', `/stats/${encodeURIComponent(raw)}`);
    if (!ok) { toast(data?.error || data?.message || `Not found (${status})`, 'error'); return; }

    const days = Math.floor((Date.now() - new Date(data.createdAt).getTime()) / 86_400_000);
    txt('sClicks', (data.clickCount || 0).toLocaleString());
    txt('sDays',   days < 1 ? '<1' : String(days));
    g('sStatus').innerHTML = data.isExpired
      ? '<span class="badge badge-expired">Expired</span>'
      : '<span class="badge badge-active">Active</span>';
    txt('sLong',    trunc(data.longUrl, 50));
    txt('sLast',    data.lastAccessedAt ? fmtDate(data.lastAccessedAt) : 'Never');
    txt('sCreated', fmtDate(data.createdAt));
    txt('sExpires', data.expiresAt ? fmtDate(data.expiresAt) : 'Never');
    g('statsOut').style.display = 'block';

  } catch (err) {
    console.error(err);
    toast('Cannot connect — is the server running?', 'error');
  } finally {
    setLoading(btn, false, 'Get stats');
  }
}

// ── Load links ────────────────────────────────────────────────────────────────
async function loadLinks(cursor) {
  if (!TOKEN) return;
  const btn = g('loadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin spin-dark"></span> Loading…';

  try {
    const qs = cursor ? `?limit=50&cursor=${encodeURIComponent(cursor)}` : '?limit=50';
    const { ok, status, data } = await api('GET', `/urls${qs}`);

    if (!ok) { toast(data?.error || `Error ${status}`, 'error'); return; }

    const list = g('linkList');
    if (!cursor) list.innerHTML = '';

    if (!data.items?.length && !cursor) {
      list.innerHTML = '<div class="empty">No links yet — shorten one above!</div>';
    } else {
      data.items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'url-item';
        row.innerHTML = `
          <div class="url-info">
            <div class="url-code"><a href="/${esc(item.shortCode)}" target="_blank" rel="noopener">${esc(item.shortCode)}</a></div>
            <div class="url-long" title="${esc(item.longUrl)}">${esc(item.longUrl)}</div>
          </div>
          <div class="url-clicks">${item.clickCount || 0} clicks</div>
          <button class="del-btn" title="Delete">🗑</button>
        `;
        row.querySelector('.del-btn').addEventListener('click', () => delLink(item.shortCode, row));
        list.appendChild(row);
      });
    }

    const pager = g('pager');
    pager.innerHTML = '';
    if (data.nextCursor) {
      const more = document.createElement('button');
      more.className = 'btn btn-outline';
      more.textContent = 'Load more';
      more.addEventListener('click', () => loadLinks(data.nextCursor));
      pager.appendChild(more);
    }
  } catch (err) {
    console.error(err);
    toast('Cannot connect — is the server running?', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Refresh my links';
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────
async function delLink(code, row) {
  if (!confirm(`Delete "${code}"? This cannot be undone.`)) return;
  try {
    const { ok, status, data } = await api('DELETE', `/urls/${encodeURIComponent(code)}`);
    if (!ok) { toast(data?.error || `Error ${status}`, 'error'); return; }
    row.style.transition = 'opacity .2s'; row.style.opacity = '0';
    setTimeout(() => row.remove(), 200);
    toast(`"${code}" deleted`, 'info');
  } catch { toast('Network error', 'error'); }
}

// ── API helper ────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(API + path, opts);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  return { ok: res.ok, status: res.status, data };
}

// ── Utilities ─────────────────────────────────────────────────────────────────
const g   = id => document.getElementById(id);
const txt = (id, v) => { const e = g(id); if (e) e.textContent = v; };

function setLoading(btn, on, label) {
  btn.disabled = on;
  btn.innerHTML = on ? `<span class="spin"></span> ${label}` : label;
}

function trunc(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : (s || '—'); }

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); }
  catch { return iso; }
}

function esc(s) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(s)));
  return d.innerHTML;
}

function toast(msg, type = 'info', ms = 3500) {
  const d = document.createElement('div');
  d.className = `toast toast-${type}`;
  d.textContent = msg;
  g('toasts').appendChild(d);
  setTimeout(() => { d.style.transition = 'opacity .3s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 300); }, ms);
}
