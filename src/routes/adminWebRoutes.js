import crypto from 'node:crypto';
import { Router } from 'express';
import {
  addWhitelistIp,
  getAccessControl,
  normalizeClientIp,
  removeWhitelistIp,
  setAccessMode
} from '../services/accessControlService.js';
import { config } from '../utils/config.js';

export const adminWebRoutes = Router();

const cookieName = 'tmail_admin';
const sessionMaxAgeSeconds = 12 * 60 * 60;

const html = (body) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>TMail Admin</title>
    <style>
      :root { color-scheme: dark; font-family: Arial, sans-serif; background: #1f2033; color: #f4f4f8; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
      main { width: min(720px, calc(100vw - 32px)); }
      section { background: #28293d; border: 1px solid #383950; border-radius: 8px; padding: 20px; }
      h1, h2 { margin: 0 0 16px; }
      label { display: block; margin: 12px 0 6px; color: #b9b9c8; font-size: 14px; }
      input, select, button { border-radius: 6px; border: 1px solid #44465f; padding: 10px 12px; font: inherit; }
      input, select { box-sizing: border-box; width: 100%; background: #202136; color: #fff; }
      button { background: #5b65f2; color: #fff; cursor: pointer; border-color: #5b65f2; }
      button.secondary { background: transparent; border-color: #55576f; }
      form { margin: 0 0 16px; }
      .row { display: flex; gap: 8px; align-items: end; }
      .row > * { flex: 1; }
      .top { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 16px; }
      .muted { color: #b9b9c8; }
      .pill { display: inline-flex; padding: 4px 10px; border-radius: 999px; background: #1f2033; }
      ul { list-style: none; padding: 0; margin: 12px 0 0; }
      li { display: flex; justify-content: space-between; gap: 10px; padding: 10px 0; border-top: 1px solid #383950; }
      .error { color: #ffb4b4; }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`;

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const parseCookies = (header) => {
  const cookies = {};
  for (const item of String(header || '').split(';')) {
    const separatorIndex = item.indexOf('=');
    if (separatorIndex === -1) continue;
    cookies[item.slice(0, separatorIndex).trim()] = decodeURIComponent(item.slice(separatorIndex + 1).trim());
  }
  return cookies;
};

const sign = (value) => crypto.createHmac('sha256', config.adminSessionSecret).update(value).digest('hex');

const secureCompare = (left, right) => {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const createSessionCookie = () => {
  const createdAt = String(Date.now());
  return `${createdAt}.${sign(createdAt)}`;
};

const isSessionValid = (req) => {
  const cookie = parseCookies(req.get('cookie'))[cookieName];
  const [createdAt, signature] = String(cookie || '').split('.');
  const ageSeconds = (Date.now() - Number(createdAt || 0)) / 1000;
  if (!createdAt || !signature || ageSeconds < 0 || ageSeconds > sessionMaxAgeSeconds) return false;
  return secureCompare(signature, sign(createdAt));
};

const requireAdminSession = (req, res, next) => {
  if (isSessionValid(req)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
};

const loginPage = (error = '') =>
  html(`<section>
    <h1>Admin Login</h1>
    <p class="muted">Masuk untuk mengatur whitelist IP akses web/API.</p>
    ${error ? `<p class="error">${error}</p>` : ''}
    <form method="post" action="/admin/login">
      <label>Password</label>
      <input name="password" type="password" autocomplete="current-password" autofocus>
      <div style="height: 12px"></div>
      <button type="submit">Login</button>
    </form>
  </section>`);

const dashboardPage = async (req) => {
  const access = await getAccessControl();
  const currentIp = normalizeClientIp(req.ip);
  const rows = access.whitelist
    .map(
      (ip) => `<li><span>${escapeHtml(ip)}</span><form method="post" action="/admin/whitelist/delete"><input type="hidden" name="ip" value="${escapeHtml(ip)}"><button class="secondary" type="submit">Delete</button></form></li>`
    )
    .join('');

  return html(`<section>
    <div class="top">
      <div>
        <h1>Admin</h1>
        <p class="muted">Current IP: <span class="pill">${escapeHtml(currentIp)}</span></p>
      </div>
      <form method="post" action="/admin/logout"><button class="secondary" type="submit">Logout</button></form>
    </div>

    <h2>Access Mode</h2>
    <form method="post" action="/admin/access-mode" class="row">
      <label>Mode
        <select name="mode">
          <option value="all"${access.mode === 'all' ? ' selected' : ''}>All IP</option>
          <option value="whitelist"${access.mode === 'whitelist' ? ' selected' : ''}>Whitelist only</option>
        </select>
      </label>
      <button type="submit">Save</button>
    </form>

    <h2>Whitelist IP</h2>
    <form method="post" action="/admin/whitelist" class="row">
      <label>IP Address
        <input name="ip" placeholder="${escapeHtml(currentIp)}">
      </label>
      <button type="submit">Add IP</button>
    </form>
    <form method="post" action="/admin/whitelist" class="row">
      <input type="hidden" name="ip" value="${escapeHtml(currentIp)}">
      <button class="secondary" type="submit">Add Current IP</button>
    </form>

    <ul>${rows || '<li><span class="muted">No whitelisted IP yet.</span></li>'}</ul>
  </section>`);
};

adminWebRoutes.get('/', async (req, res, next) => {
  try {
    if (!isSessionValid(req)) return res.type('html').send(loginPage());
    return res.type('html').send(await dashboardPage(req));
  } catch (error) {
    return next(error);
  }
});

adminWebRoutes.post('/login', (req, res) => {
  const password = String(req.body.password || '');
  if (!secureCompare(password, config.adminWebPassword)) {
    return res.status(401).type('html').send(loginPage('Password salah.'));
  }

  res.cookie(cookieName, createSessionCookie(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: sessionMaxAgeSeconds * 1000
  });
  return res.redirect('/admin');
});

adminWebRoutes.post('/logout', (req, res) => {
  res.clearCookie(cookieName);
  return res.redirect('/admin');
});

adminWebRoutes.post('/access-mode', requireAdminSession, async (req, res, next) => {
  try {
    await setAccessMode(req.body.mode);
    return res.redirect('/admin');
  } catch (error) {
    return next(error);
  }
});

adminWebRoutes.post('/whitelist', requireAdminSession, async (req, res, next) => {
  try {
    await addWhitelistIp(req.body.ip);
    return res.redirect('/admin');
  } catch (error) {
    return next(error);
  }
});

adminWebRoutes.post('/whitelist/delete', requireAdminSession, async (req, res, next) => {
  try {
    await removeWhitelistIp(req.body.ip);
    return res.redirect('/admin');
  } catch (error) {
    return next(error);
  }
});

adminWebRoutes.get('/api/access', requireAdminSession, async (req, res, next) => {
  try {
    const access = await getAccessControl();
    return res.json({ ...access, current_ip: normalizeClientIp(req.ip) });
  } catch (error) {
    return next(error);
  }
});
