'use strict';
/**
 * Google ログイン（組織ドメイン限定）。公開Funnel URLを守る。
 * OAuth2 Authorization Code を手実装（idトークンはGoogleのtoken endpointから直接取得＝署名検証は省略）。
 * セッションは HMAC 署名クッキー。環境変数:
 *   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / ALLOWED_DOMAIN / SESSION_SECRET / PUBLIC_ORIGIN
 * 未設定時は保護しない（設定投入で自動有効化）。
 */
const crypto = require('crypto');

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || '';
const SECRET = process.env.SESSION_SECRET || '';
const ORIGIN = process.env.PUBLIC_ORIGIN || '';
const COOKIE = 'wl_session';
const TTL_MS = 1000 * 60 * 60 * 12; // 12時間

function authEnabled() { return !!(CLIENT_ID && CLIENT_SECRET && SECRET && ORIGIN); }
function redirectUri() { return ORIGIN + '/auth/callback'; }

function sign(obj) {
  const data = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return data + '.' + mac;
}
function verify(tok) {
  if (!tok) return null;
  const i = tok.lastIndexOf('.');
  if (i < 0) return null;
  const data = tok.slice(0, i), mac = tok.slice(i + 1);
  const exp = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const o = JSON.parse(Buffer.from(data, 'base64url').toString()); if (o.exp && Date.now() > o.exp) return null; return o; } catch (e) { return null; }
}
function parseCookies(req) {
  const h = req.headers.cookie || ''; const o = {};
  h.split(';').forEach(function (p) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return o;
}
function currentUser(req) { if (!authEnabled()) return { email: '(auth disabled)', anon: true }; return verify(parseCookies(req)[COOKIE]); }

function loginUrl() {
  const p = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirectUri(), response_type: 'code',
    scope: 'openid email profile', access_type: 'online', prompt: 'select_account'
  });
  if (ALLOWED_DOMAIN) p.set('hd', ALLOWED_DOMAIN);
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
}
async function exchange(code) {
  const body = new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: redirectUri(), grant_type: 'authorization_code' });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (!r.ok) throw new Error('token exchange failed: ' + JSON.stringify(j));
  return j;
}
function decodeIdToken(idToken) { return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString()); }

function install(app) {
  app.get('/auth/login', (req, res) => { if (!authEnabled()) return res.redirect('/'); res.redirect(loginUrl()); });
  app.get('/auth/callback', async (req, res) => {
    try {
      if (!authEnabled()) return res.redirect('/');
      const code = req.query.code; if (!code) throw new Error('認可コードがありません');
      const tok = await exchange(code);
      const claims = decodeIdToken(tok.id_token);
      const email = String(claims.email || '').toLowerCase();
      const ok = !ALLOWED_DOMAIN || claims.hd === ALLOWED_DOMAIN || email.endsWith('@' + ALLOWED_DOMAIN.toLowerCase());
      if (!ok) return res.status(403).send('このアプリは ' + ALLOWED_DOMAIN + ' のアカウントのみ利用できます。');
      const session = sign({ email, name: claims.name || '', exp: Date.now() + TTL_MS });
      res.setHeader('Set-Cookie', COOKIE + '=' + encodeURIComponent(session) + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + Math.floor(TTL_MS / 1000));
      res.redirect('/');
    } catch (e) { res.status(500).send('ログイン処理でエラー: ' + ((e && e.message) || e)); }
  });
  app.get('/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', COOKIE + '=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
    res.redirect('/auth/login');
  });
  app.get('/api/me', (req, res) => { res.json({ user: currentUser(req) || null, authEnabled: authEnabled() }); });
}

function middleware() {
  return function (req, res, next) {
    if (!authEnabled()) return next();
    const p = req.path;
    if (p.startsWith('/auth/') || p === '/api/health') return next();
    if (currentUser(req)) return next();
    if (p.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
    return res.redirect('/auth/login');
  };
}

module.exports = { install, middleware, authEnabled, currentUser };
