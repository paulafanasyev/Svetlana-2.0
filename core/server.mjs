#!/usr/bin/env node
// Светлана 2.0 — сервер: веб-приложение (PWA, ставится на Android и ПК), API агента, WebSocket для устройств.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { config, loadEnvFile } from "./lib/config.mjs";
import { createApp } from "./lib/app.mjs";
import { acceptUpgrade } from "./lib/ws.mjs";
import { artifacts } from "./lib/tools/docs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".pdf": "application/pdf", ".csv": "text/csv; charset=utf-8", ".mp4": "video/mp4", ".mp3": "audio/mpeg" };

export function createServer(app) {
  const { cfg } = app;
  if (!cfg.adminToken || cfg.adminToken.length < 16) throw new Error("Задайте SVETLANA_ADMIN_TOKEN (не короче 16 символов) — это ваш пароль входа");
  const sessions = new Map(); const fails = new Map(); const picoHits = new Map(); const A = artifacts(cfg);
  const sec = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
    "Permissions-Policy": "microphone=(self), camera=(self), display-capture=(self)" };
  const send = (res, status, body, headers = {}) => { res.writeHead(status, { ...sec, ...headers }); res.end(body); };
  const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  const cookie = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((x) => x.trim().split("=")).filter((x) => x[0]));
  const authed = (req) => { const s = cookie(req).sv; const e = s && sessions.get(s); if (e && e > Date.now()) return true; const b = (req.headers.authorization || "").replace(/^Bearer\s+/, ""); return b && safeEq(b, cfg.adminToken); };
  const body = (req, limit = 30 * 1024 * 1024) => new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", (d) => { n += d.length; if (n > limit) { reject(Object.assign(new Error("слишком большой запрос"), { status: 413 })); req.destroy(); } else chunks.push(d); });
    req.on("end", () => resolve(Buffer.concat(chunks))); req.on("error", reject);
  });
  const readJson = async (req) => { const b = await body(req); try { return JSON.parse(b.toString("utf8") || "{}"); } catch { throw Object.assign(new Error("ожидается JSON"), { status: 400 }); } };
  const sameOrigin = (req) => { const o = req.headers.origin; return !o || o === `http://${req.headers.host}` || o === `https://${req.headers.host}`; };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x"); const p = url.pathname;
    try {
      // busy — идёт ли сейчас работа агента (телефон держит процессор включённым, пока Светлана думает)
      // proof — HMAC(секрет, nonce): приложение на телефоне убеждается, что на порту наше ядро, прежде чем отдать ему пароль
      if (p === "/healthz") { const n = url.searchParams.get("nonce"); return json(res, 200, { ok: true, busy: (app.agent?.locks?.size || 0) > 0, ...(n && n.length <= 128 ? { proof: crypto.createHmac("sha256", cfg.secret || cfg.adminToken).update("svetlana-health:" + n).digest("hex") } : {}) }); }
      if (!p.startsWith("/api/")) return serveStatic(res, p, send);
      // Детское приложение «Я-Зарядка» (другой источник: Capacitor/веб): свой токен, только режим Пико, без cookie, поэтому CORS безопасен.
      if (p === "/api/pico/chat") {
        const o = req.headers.origin, allow = cfg.picoOrigins?.length ? cfg.picoOrigins : ["*"];
        const cors = o && (allow.includes("*") || allow.includes(o)) ? { "Access-Control-Allow-Origin": allow.includes("*") ? "*" : o, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "600", Vary: "Origin" } : {};
        const pj = (status, obj) => send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors });
        if (req.method === "OPTIONS") return send(res, 204, "", cors);
        if (req.method !== "POST") return pj(405, { error: "только POST" });
        if (o && !cors["Access-Control-Allow-Origin"]) return pj(403, { error: "чужой источник запроса" });
        const bt = (req.headers.authorization || "").replace(/^Bearer\s+/, "");
        if (!cfg.picoToken || cfg.picoToken.length < 16 || !safeEq(bt, cfg.picoToken)) return pj(401, { error: "нужен токен Пико" });
        const ip = req.socket.remoteAddress, now = Date.now(), hits = (picoHits.get(ip) || []).filter((x) => now - x < 60_000);
        if (hits.length >= 30) return pj(429, { error: "Пико устал, подожди минутку" }); hits.push(now); picoHits.set(ip, hits);
        const b = await readJson(req); const text = String(b.text || "").slice(0, 4000); if (!text.trim()) return pj(400, { error: "пустое сообщение" });
        const old = b.conversationId && app.store.get("conversations", b.conversationId);
        if (old && old.mode !== "pico") return pj(403, { error: "это не разговор Пико" });
        const r = await app.agent.chat({ conversationId: old ? old.id : undefined, text, mode: "pico" });
        return pj(200, { conversationId: r.conversationId, answer: r.answer, steps: r.steps.map(({ tool, ok }) => ({ tool, ok })) });
      }
      if (req.method !== "GET" && !sameOrigin(req)) return json(res, 403, { error: "чужой источник запроса" });
      if (p === "/api/login" && req.method === "POST") {
        const ip = req.socket.remoteAddress; const f = fails.get(ip) || { n: 0, t: 0 };
        if (f.n >= 5 && Date.now() - f.t < 15 * 60_000) return json(res, 429, { error: "слишком много попыток, подождите 15 минут" });
        const { token } = await readJson(req);
        if (!safeEq(String(token || ""), cfg.adminToken)) { fails.set(ip, { n: f.n + 1, t: Date.now() }); return json(res, 401, { error: "неверный пароль" }); }
        fails.delete(ip); const sid = crypto.randomBytes(32).toString("base64url"); sessions.set(sid, Date.now() + 30 * 24 * 3600_000);
        return send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json", "Set-Cookie": `sv=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}` });
      }
      if (!authed(req)) return json(res, 401, { error: "нужен вход" });
      if (p === "/api/logout") { sessions.delete(cookie(req).sv); return json(res, 200, { ok: true }); }
      if (p === "/api/chat" && req.method === "POST") {
        const b = await readJson(req);
        const text = String(b.text || "").slice(0, 20000); if (!text.trim()) return json(res, 400, { error: "пустое сообщение" });
        const images = (Array.isArray(b.images) ? b.images : []).filter((u) => typeof u === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(u) && u.length < 12_000_000).slice(0, 4);
        return json(res, 200, await app.agent.chat({ conversationId: b.conversationId, text, images, mode: b.mode === "pico" ? "pico" : undefined }));
      }
      if (p === "/api/confirm" && req.method === "POST") { const b = await readJson(req); return json(res, 200, await app.agent.confirm(b)); }
      if (p === "/api/conversations" && req.method === "GET") return json(res, 200, app.store.all("conversations").map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt || c.createdAt })).reverse().slice(0, 100));
      if (p.startsWith("/api/conversations/") && req.method === "GET") { const c = app.store.get("conversations", p.split("/")[3]); return c ? json(res, 200, { id: c.id, messages: c.messages.filter((m) => m.role === "user" || (m.role === "assistant" && m.content)).map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content.filter((x) => x.type === "text").map((x) => x.text).join(" ") })) }) : json(res, 404, { error: "нет такого разговора" }); }
      if (p === "/api/tools") return json(res, 200, app.registry.list().map((t) => ({ name: t.name, risk: t.risk, domain: t.domain, description: t.description })));
      if (p === "/api/providers") {
        if (req.method === "GET") return json(res, 200, app.providers.public());
        if (req.method === "POST") { const b = await readJson(req); if (!b.id || !/^[a-z0-9_-]{2,40}$/.test(b.id)) return json(res, 400, { error: "id: латиница/цифры" }); const keep = app.providers.list.find((x) => x.id === b.id); if (keep && !b.apiKey) b.apiKey = keep.apiKey; return json(res, 200, { ok: true, provider: { ...app.providers.upsert(b), apiKey: undefined } }); }
        if (req.method === "DELETE") { app.providers.remove(url.searchParams.get("id")); return json(res, 200, { ok: true }); }
      }
      if (p === "/api/providers/test" && req.method === "POST") {
        const { id } = await readJson(req);
        try { const r = await app.providers.chat({ messages: [{ role: "user", content: "Ответь одним словом: работает?" }], maxTokens: 20 }, { prefer: id }); return json(res, 200, { ok: r.provider === id, provider: r.provider, answer: r.content.slice(0, 100) }); }
        catch (e) { return json(res, 200, { ok: false, error: e.message }); }
      }
      if (p === "/api/tts" && req.method === "POST") { const { text } = await readJson(req); const a = await app.providers.tts(String(text || "").slice(0, 5000)).catch(() => null); return a ? send(res, 200, a.bytes, { "Content-Type": a.mime, "Cache-Control": "no-store" }) : send(res, 204, ""); }
      if (p === "/api/stt" && req.method === "POST") { const b = await body(req, 25 * 1024 * 1024); try { return json(res, 200, { text: await app.providers.stt(b, req.headers["content-type"] || "audio/webm") }); } catch (e) { return json(res, 501, { error: e.message }); } }
      if (p === "/api/devices" && req.method === "GET") return json(res, 200, app.hub.list());
      if (p === "/api/devices/pair" && req.method === "POST") { const b = await readJson(req); return json(res, 200, app.hub.pair(String(b.name || "устройство").slice(0, 60), ["android", "windows", "macos", "linux", "browser"].includes(b.platform) ? b.platform : "android")); }
      if (p.startsWith("/api/devices/") && req.method === "DELETE") return json(res, 200, { ok: app.hub.revoke(p.split("/")[3]) });
      if (p.startsWith("/api/data/") && req.method === "GET") { const name = p.split("/")[3]; if (!["contacts", "deals", "tasks", "incomes", "expenses", "memory"].includes(name)) return json(res, 404, { error: "нет такого раздела" }); return json(res, 200, app.store.all(name).slice(-1000)); }
      if (p.startsWith("/api/artifacts/") && req.method === "GET") {
        const f = A.path(decodeURIComponent(p.split("/")[3] || "")); if (!f) return json(res, 404, { error: "файл не найден" });
        const ext = path.extname(f); return send(res, 200, fs.readFileSync(f), { "Content-Type": MIME[ext] || "application/octet-stream", "Content-Disposition": `${[".pdf", ".png", ".jpg", ".mp4"].includes(ext) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(path.basename(f))}`, ...(ext === ".html" ? { "Content-Security-Policy": "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'" } : {}) });
      }
      return json(res, 404, { error: "нет такого метода" });
    } catch (e) {
      const status = e.status || (e.name === "ProviderError" || e.constructor?.name === "ProviderError" ? 502 : 500);
      if (status === 500) console.error(e);
      return json(res, status, { error: status === 500 ? "внутренняя ошибка" : e.message });
    }
  });
  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname !== "/ws/device") return socket.destroy();
    const dev = app.hub.authenticate(url.searchParams.get("token") || (req.headers["sec-websocket-protocol"] || "").split(",").map((s) => s.trim()).find((s) => s.startsWith("dev_")));
    if (!dev) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); return socket.destroy(); }
    const ws = acceptUpgrade(req, socket); if (ws) app.hub.attach(dev, ws);
  });
  return server;
}

function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }

function serveStatic(res, p, send) {
  const rel = p === "/" ? "index.html" : p.replace(/^\/+/, "");
  const f = path.resolve(HERE, "web", rel);
  if (!f.startsWith(path.resolve(HERE, "web") + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
  send(res, 200, fs.readFileSync(f), { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": rel === "sw.js" || rel.endsWith(".html") ? "no-cache" : "public, max-age=3600" });
}

// Запуск напрямую (node server.mjs). Сравниваем настоящие пути: на Android /data/user/0 — ссылка на /data/data,
// и без realpath проверка молча не срабатывала — ядро загружалось и сразу выходило, не открыв порт.
const isMain = (() => { try { return !!process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  // Node на Android (nodejs-mobile) собран без Intl — подставляем минимум, нужный ядру (дата и время в системном промпте)
  if (typeof globalThis.Intl === "undefined") globalThis.Intl = (await import("./lib/intl-lite.mjs")).Intl;
  loadEnvFile(path.join(HERE, ".env"));
  const cfg = config(); const app = createApp(cfg);
  createServer(app).listen(cfg.port, cfg.host, () => console.log(`Светлана слушает http://${cfg.host}:${cfg.port} · провайдеров: ${app.providers.list.length} · инструментов: ${app.registry.list().length}`));
}
