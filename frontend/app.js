'use strict';

// ── Config ────────────────────────────────────────────────────────────────────
const API = 'http://localhost:3000';

// ── State ─────────────────────────────────────────────────────────────────────
let TOKEN     = localStorage.getItem('sl_token')  || null;
let USER      = JSON.parse(localStorage.getItem('sl_user') || 'null');
let nextCursor = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
(function boot() {
  // Handle Google OAuth redirect — token comes back in URL query string
  const params = new URLSearchParams(window.location.search);
  if (params.get('token')) {
    TOKEN = params.get('token');
    USER  = { name: params.get('name') || 'User' };
    localStorage.setItem('sl_token', TOKEN);
    localStorage.setItem('sl_user',  JSON.stringify(USER));
    // Clean URL
    history.replaceState({}, '', '/');
  }
  if (params.get('error')) {
    toast(params.get('error'), 'error', 6000);
    history.replaceState({}, '', '/');
  }

  if (TOKEN && USER) {
    showMain();
  } else {
    showAuth();
  }
})();

// ── View switching ────────────────────────────────────────────────────────────
function showAuth() {
  g('authView').style.display = '';
  g('mainView').style.display = 'none';
}
function showMain() {
  g('authView').style.display = 'none';
  g('mainView').style.display = '';
  g('navName').textContent = USER?.name || 'User';
  // Auto-load links when entering main view
  loadLinks(null);
}

// ── Auth tab switching ────────────────────────────────────────────────────────
function switchTab(tab) {
  if (tab === 'login') {
    g('loginForm').style.display    = '';
    g('registerForm').style.display = 'none';
    g('tabLogin').classList.add('active');
    g('tabRegister').classList.remove('active');
  } else {
    g('loginForm').style.display    = 'none';
    g('registerForm').style.display = '';
    g('tabLogin').classList.remove('active');
    g('tabRegister').classList.add('active');
  }
}

// ── Google login ──────────────────────────────────────────────────────────────
function googleLogin() {
  window.location.href = API + '/auth/google';
}

// ── Register ──────────────────────────────────────────────────────────────────
async function doRegister() {
  txt('regErr', '');
  const name  = g('regName').value.trim();
  const email = g('regEmail').value.trim();
  const pass  = g('regPassword').value;
  const pass2 = g('regPassword2').value;

  if (!name)         { txt('regErr', 'Name is required'); return; }
  if (!email)        { txt('regErr', 'Email is required'); return; }
  if (!pass)         { txt('regErr', 'Password is required'); return; }
  if (pass !== pass2){ txt('regErr', 'Passwords do not match'); return; }

  const btn = g('regBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Creating account…';

  try {
    const { ok, data } = await call('POST', '/auth/register', { name, email, password: pass });
    if (!ok) { txt('regErr', data.error || 'Registration failed'); return; }
    TOKEN = data.token;
    USER  = data.user;
    localStorage.setItem('sl_token', TOKEN);
    localStorage.setItem('sl_user',  JSON.stringify(USER));
    toast('Account created! Welcome 🎉', 'success');
    showMain();
  } catch (e) {
    txt('regErr', 'Network error — is the server running?');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create account';
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function doLogin() {
  txt('loginErr', '');
  const email = g('loginEmail').value.trim();
  const pass  = g('loginPassword').value;

  if (!email) { txt('loginErr', 'Email is required'); return; }
  if (!pass)  { txt('loginErr', 'Password is required'); return; }

  const btn = g('loginBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Signing in…';

  try {
    const { ok, data } = await call('POST', '/auth/login', { email, password: pass });
    if (!ok) { txt('loginErr', data.error || 'Login failed'); return; }
    TOKEN = data.token;
    USER  = data.user;
    localStorage.setItem('sl_token', TOKEN);
    localStorage.setItem('sl_user',  JSON.stringify(USER));
    toast(`Welcome back, ${USER.name}!`, 'success');
    showMain();
  } catch (e) {
    txt('loginErr', 'Network error — is the server running?');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

// ── Logout ────────────────────────────────────────────────────────────────────
function doLogout() {
  TOKEN = null; USER = null;
  localStorage.removeItem('sl_token');
  localStorage.removeItem('sl_user');
  g('linkList').innerHTML = '';
  g('resultBox').style.display = 'none';
  g('statsOut').style.display = 'none';
  showAuth();
  toast('Signed out', 'info', 2000);
}

// ── Advanced options ──────────────────────────────────────────────────────────
function toggleAdv() {
  const f = g('advFields');
  const open = f.classList.toggle('open');
  g('advBtn').textContent = open ? '✕ Hide options' : '⚙ Advanced options';
}

// ── Shorten ───────────────────────────────────────────────────────────────────
async function doShorten(e) {
  e.preventDefault();
  txt('urlErr', ''); txt('aliasErr', '');

  const longUrl   = g('longUrl').value.trim();
  const alias     = g('alias').value.trim() || undefined;
  const expiresAt = g('expiresAt').value || undefined;

  if (!longUrl) { txt('urlErr', 'Please enter a URL'); g('longUrl').focus(); return; }

  const btn = g('shortenBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Shortening…';

  try {
    const body = { url: longUrl };
    if (alias)     body.alias     = alias;
    if (expiresAt) body.expiresAt = new Date(expiresAt).toISOString();

    const { ok, status, data } = await call('POST', '/shorten', body);

    if (!ok) {
      const msg = data?.error || data?.message || `Error ${status}`;
      if (msg.toLowerCase().includes('alias')) txt('aliasErr', msg);
      else txt('urlErr', msg);
      return;
    }

    // Show result inline
    const box = g('resultBox');
    const lnk = g('shortLink');
    lnk.href        = data.shortUrl;
    lnk.textContent = data.shortUrl;
    txt('metaLong',    trunc(data.longUrl, 52));
    txt('metaCode',    data.shortCode);
    txt('metaCreated', fmtDate(data.createdAt));
    txt('metaExpires', data.expiresAt ? fmtDate(data.expiresAt) : 'Never');
    box.style.display = 'block';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    toast('Short link created!', 'success');

    // Reset form
    g('longUrl').value = '';
    g('alias').value   = '';
    g('expiresAt').value = '';
    g('advFields').classList.remove('open');
    g('advBtn').textContent = '⚙ Advanced options';

    // Refresh link list
    loadLinks(null);

  } catch (err) {
    console.error(err);
    txt('urlErr', 'Network error — is the server running?');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Shorten URL';
  }
}

// ── Copy ──────────────────────────────────────────────────────────────────────
async function doCopy() {
  const href = g('shortLink').href;
  if (!href || href === window.location.href) return;
  try {
    await navigator.clipboard.writeText(href);
    toast('Copied!', 'success', 2000);
  } catch {
    const inp = document.createElement('input');
    inp.value = href; document.body.appendChild(inp); inp.select();
    document.execCommand('copy'); inp.remove();
    toast('Copied!', 'success', 2000);
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function doStats(e) {
  e.preventDefault();
  let raw = g('statsInput').value.trim();
  if (!raw) { toast('Enter a short code or URL', 'error'); return; }

  try { const p = new URL(raw); raw = p.pathname.replace(/^\//, '').split('/')[0]; } catch { /* bare code */ }
  if (!raw) { toast('Invalid code', 'error'); return; }

  const btn = g('statsBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Loading…';
  g('statsOut').style.display = 'none';

  try {
    const { ok, status, data } = await call('GET', `/stats/${encodeURIComponent(raw)}`);
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
    toast('Network error — is the server running?', 'error', 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Get stats';
  }
}

// ── Load links ────────────────────────────────────────────────────────────────
async function loadLinks(cursor) {
  if (!TOKEN) return;
  const btn = g('loadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin spin-dark"></span> Loading…';

  try {
    const qs = cursor ? `?limit=20&cursor=${encodeURIComponent(cursor)}` : '?limit=20';
    const { ok, status, data } = await call('GET', `/urls${qs}`);

    if (!ok) {
      toast(data?.error || data?.message || `Error ${status}`, 'error');
      return;
    }

    const list = g('linkList');
    if (!cursor) list.innerHTML = '';

    if (!data.items || data.items.length === 0) {
      if (!cursor) list.innerHTML = '<div class="empty">No links yet — shorten one above!</div>';
    } else {
      data.items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'url-item';
        row.dataset.code = item.shortCode;
        row.innerHTML = `
          <div class="url-info">
            <div class="url-code"><a href="/${esc(item.shortCode)}" target="_blank" rel="noopener">${esc(item.shortCode)}</a></div>
            <div class="url-long" title="${esc(item.longUrl)}">${esc(item.longUrl)}</div>
          </div>
          <div class="url-clicks">${item.clickCount || 0} clicks</div>
          <button class="del-btn" title="Delete ${esc(item.shortCode)}">🗑</button>
        `;
        row.querySelector('.del-btn').addEventListener('click', () => delLink(item.shortCode, row));
        list.appendChild(row);
      });
    }

    nextCursor = data.nextCursor || null;
    const pager = g('pager');
    pager.innerHTML = '';
    if (nextCursor) {
      const more = document.createElement('button');
      more.className = 'btn btn-outline';
      more.textContent = 'Load more';
      more.addEventListener('click', () => loadLinks(nextCursor));
      pager.appendChild(more);
    }
  } catch (err) {
    console.error(err);
    toast('Network error', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load my links';
  }
}

// ── Delete link ───────────────────────────────────────────────────────────────
async function delLink(code, row) {
  if (!confirm(`Delete "${code}"? This cannot be undone.`)) return;
  try {
    const { ok, status, data } = await call('DELETE', `/urls/${encodeURIComponent(code)}`);
    if (!ok) { toast(data?.error || `Error ${status}`, 'error'); return; }
    row.style.transition = 'opacity .2s'; row.style.opacity = '0';
    setTimeout(() => row.remove(), 200);
    toast(`"${code}" deleted`, 'info');
  } catch (err) {
    console.error(err); toast('Network error', 'error');
  }
}

// ── API helper ────────────────────────────────────────────────────────────────
async function call(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(API + path, opts);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  return { ok: res.ok, status: res.status, data };
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function g(id)      { return document.getElementById(id); }
function txt(id, v) { const e = g(id); if (e) e.textContent = v; }
function trunc(s, n){ return s && s.length > n ? s.slice(0, n) + '…' : (s || '—'); }

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
