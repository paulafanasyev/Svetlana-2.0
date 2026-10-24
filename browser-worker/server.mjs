import http from 'node:http';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { chromium } from 'playwright';
import { isPotentiallyConsequentialLink } from './browser-policy.mjs';
import { isPrivateAddress, isBlockedHost } from './network-policy.mjs';
// Network policy is unit-tested separately; every top-level and subresource request is checked.

const HOST = process.env.SVETLANA_BROWSER_HOST || '127.0.0.1';
const PORT = Number(process.env.SVETLANA_BROWSER_PORT || 4178);
const TOKEN = process.env.SVETLANA_BROWSER_TOKEN || '';
const ALLOWED_ORIGIN = process.env.SVETLANA_BROWSER_ALLOWED_ORIGIN || '';
const SESSION_TTL_MS = Math.min(Math.max(Number(process.env.SVETLANA_BROWSER_SESSION_TTL_MS || 30 * 60 * 1000), 60_000), 4 * 60 * 60 * 1000);
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SESSIONS = 8;
const sessions = new Map();
let browserPromise;

if (HOST !== '127.0.0.1' && HOST !== '::1' && HOST !== 'localhost') {
  throw new Error('Browser worker must bind to loopback only. Do not expose it to the network.');
}
if (TOKEN.length < 32) {
  throw new Error('Set SVETLANA_BROWSER_TOKEN to a random secret of at least 32 characters.');
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}
function constantTimeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

async function assertPublicUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Invalid URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are allowed');
  if (url.username || url.password) throw new Error('URLs containing credentials are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isBlockedHost(host)) {
    throw new Error('Local and internal hostnames are blocked');
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Private or reserved IP addresses are blocked');
  } else {
    let records;
    try { records = await dns.lookup(host, { all: true, verbatim: true }); } catch { throw new Error('Host could not be resolved'); }
    if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
      throw new Error('Private, reserved, or mixed DNS destinations are blocked');
    }
  }
  return url;
}
async function getBrowser() {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true });
  return browserPromise;
}
function touch(session) { session.lastUsed = Date.now(); }
async function createSession(agentId) {
  if (sessions.size >= MAX_SESSIONS) throw new Error('Maximum active browser sessions reached');
  const id = crypto.randomUUID();
  const browser = await getBrowser();
  const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  page.setDefaultNavigationTimeout(20_000);
  await page.route('**/*', async (route) => {
    try {
      await assertPublicUrl(route.request().url());
      await route.continue();
    } catch {
      await route.abort('blockedbyclient');
    }
  });
  const session = { id, agentId, context, page, createdAt: Date.now(), lastUsed: Date.now() };
  sessions.set(id, session);
  return session;
}
async function closeSession(id) {
  const session = sessions.get(id);
  if (!session) return false;
  sessions.delete(id);
  await session.context.close().catch(() => {});
  return true;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}
function safeAgentId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,80}$/.test(value) ? value : null;
}
function safeText(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(label + ' is required and must be <= ' + max + ' characters');
  return value;
}
async function snapshot(session) {
  const page = session.page;
  const aria = await page.locator('body').ariaSnapshot().catch(() => '');
  const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    aria: String(aria).slice(0, 24_000),
    text: String(text).slice(0, 12_000),
    timestamp: Date.now(),
  };
}
function getSession(id) {
  const session = sessions.get(id);
  if (!session) throw new Error('Browser session not found or expired');
  touch(session);
  return session;
}
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && origin !== ALLOWED_ORIGIN) return json(res, 403, { error: 'Origin not allowed' });
  if (origin && ALLOWED_ORIGIN) {
    res.setHeader('access-control-allow-origin', ALLOWED_ORIGIN);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'svetlana-browser-worker', sessions: sessions.size });
  if (!constantTimeEqual(req.headers.authorization?.replace(/^Bearer\s+/i, '') || '', TOKEN)) {
    return json(res, 401, { error: 'Unauthorized' });
  }
  if (req.method === 'GET' && url.pathname === '/v1/status') return json(res, 200, { ok: true, service: 'svetlana-browser-worker', sessions: sessions.size });
  try {
    if (req.method === 'POST' && url.pathname === '/v1/sessions') {
      const body = await readBody(req);
      const agentId = safeAgentId(body.agentId);
      if (!agentId) return json(res, 400, { error: 'agentId must contain 1-80 safe characters' });
      const session = await createSession(agentId);
      return json(res, 201, { sessionId: session.id, agentId, isolated: true, expiresAfterMs: SESSION_TTL_MS });
    }
    const match = url.pathname.match(/^\/v1\/sessions\/([a-f0-9-]{36})(?:\/(navigate|snapshot|click|fill|wait|screenshot|follow-link))?$/);
    if (!match) return json(res, 404, { error: 'Not found' });
    const [, id, action] = match;
    if (req.method === 'DELETE' && !action) return json(res, 200, { closed: await closeSession(id) });
    if (req.method !== 'POST' || !action) return json(res, 405, { error: 'Method not allowed' });
    const session = getSession(id);
    const body = await readBody(req);
    const page = session.page;
    if (action === 'navigate') {
      const target = await assertPublicUrl(safeText(body.url, 'url', 2048));
      await page.goto(target.href, { waitUntil: 'domcontentloaded' });
      return json(res, 200, { success: true, observation: await snapshot(session) });
    }
    if (action === 'snapshot') return json(res, 200, { success: true, observation: await snapshot(session) });
    if (action === 'follow-link') {
      const name = safeText(body.name, 'name', 300);
      const locator = page.getByRole('link', { name, exact: true });
      const count = await locator.count();
      if (count !== 1) return json(res, 400, { success: false, error: count ? 'Ambiguous link name' : 'Link not found' });
      const href = await locator.getAttribute('href');
      if (!href) return json(res, 400, { success: false, error: 'Link has no URL' });
      const target = await assertPublicUrl(new URL(href, page.url()).href);
      if (isPotentiallyConsequentialLink(name, target.href)) {
        return json(res, 403, { success: false, error: 'Potentially consequential link blocked. Use browser_click, which requires confirmation.' });
      }
      // Navigate to the link target instead of executing arbitrary page click handlers.
      await page.goto(target.href, { waitUntil: 'domcontentloaded' });
      return json(res, 200, { success: true, observation: await snapshot(session) });
    }
    if (action === 'click') {
      const role = safeText(body.role, 'role', 40);
      const name = safeText(body.name, 'name', 300);
      const allowedRoles = new Set(['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option']);
      if (!allowedRoles.has(role)) return json(res, 400, { error: 'Unsupported role' });
      await page.getByRole(role, { name, exact: true }).click();
      return json(res, 200, { success: true, observation: await snapshot(session) });
    }
    if (action === 'fill') {
      const role = safeText(body.role, 'role', 40);
      const name = safeText(body.name, 'name', 300);
      const value = safeText(body.value, 'value', 4000);
      if (!['textbox', 'searchbox', 'combobox'].includes(role)) return json(res, 400, { error: 'Unsupported fill role' });
      await page.getByRole(role, { name, exact: true }).fill(value);
      return json(res, 200, { success: true, observation: await snapshot(session) });
    }
    if (action === 'wait') {
      const ms = Number(body.ms);
      if (!Number.isInteger(ms) || ms < 0 || ms > 10_000) return json(res, 400, { error: 'ms must be 0-10000' });
      await page.waitForTimeout(ms);
      return json(res, 200, { success: true, observation: await snapshot(session) });
    }
    if (action === 'screenshot') {
      const image = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
      return json(res, 200, { success: true, mimeType: 'image/jpeg', base64: image.toString('base64'), url: page.url() });
    }
  } catch (error) {
    return json(res, 400, { success: false, error: error instanceof Error ? error.message.slice(0, 300) : 'Browser action failed' });
  }
});
const cleanup = setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) if (session.lastUsed < cutoff) void closeSession(id);
}, 60_000);
cleanup.unref();
server.listen(PORT, HOST, () => {
  console.log('Svetlana Browser Worker listening on http://' + HOST + ':' + PORT);
  console.log('Browser sessions are isolated and expire after ' + Math.round(SESSION_TTL_MS / 60_000) + ' minutes.');
});
async function shutdown() {
  clearInterval(cleanup);
  server.close();
  for (const id of sessions.keys()) await closeSession(id);
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    await browser?.close().catch(() => {});
  }
}
process.on('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.on('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
