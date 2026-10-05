// Устройства (Android, ПК, вкладка браузера) подключаются К ядру по WebSocket и выполняют команды.
// Доступ — только по токену устройства, который выдаёт владелец (сопряжение). Команды управления — с подтверждением.
import crypto from "node:crypto";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const METHODS = {
  "screen.capture": "screen", "ui.tree": "tree", "apps.list": "apps", "app.launch": "control", "input.tap": "control", "input.swipe": "control",
  "input.type": "control", "input.key": "control", "nav.back": "control", "nav.home": "control", "clipboard.get": "clipboard", "clipboard.set": "control",
};

export class DeviceHub {
  constructor(store) { this.store = store; this.live = new Map(); this.seq = 0; this.shots = new Map(); }
  pair(name, platform) {
    const token = "dev_" + crypto.randomBytes(24).toString("base64url");
    const row = this.store.insert("devices", { name, platform, tokenHash: sha(token) });
    return { deviceId: row.id, token };
  }
  revoke(id) { const c = this.live.get(id); if (c) c.ws.close(4001); return this.store.remove("devices", id); }
  authenticate(token) { if (typeof token !== "string") return null; const h = sha(token); return this.store.all("devices").find((d) => d.tokenHash === h) || null; }
  attach(dev, ws) {
    const prev = this.live.get(dev.id); if (prev) prev.ws.close(4000);
    const conn = { dev, ws, pending: new Map(), info: { capabilities: [] }, since: Date.now() };
    this.live.set(dev.id, conn);
    ws.on("message", (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.type === "hello") { conn.info = { platform: String(m.platform || dev.platform).slice(0, 20), name: String(m.name || dev.name).slice(0, 80), capabilities: Array.isArray(m.capabilities) ? m.capabilities.slice(0, 20).map(String) : [], screen: m.screen }; return; }
      const p = conn.pending.get(m.id); if (!p) return;
      conn.pending.delete(m.id); clearTimeout(p.t);
      m.error ? p.reject(new Error(String(m.error).slice(0, 300))) : p.resolve(m.result);
    });
    ws.on("close", () => { if (this.live.get(dev.id) === conn) this.live.delete(dev.id); for (const p of conn.pending.values()) { clearTimeout(p.t); p.reject(new Error("устройство отключилось")); } });
    this.store.update("devices", dev.id, { lastSeen: new Date().toISOString() });
  }
  list() { return this.store.all("devices").map((d) => ({ id: d.id, name: d.name, platform: d.platform, online: this.live.has(d.id), capabilities: this.live.get(d.id)?.info.capabilities || [], lastSeen: d.lastSeen })); }
  call(deviceId, method, params = {}, timeoutMs = 30000) {
    const conn = this.live.get(deviceId);
    if (!conn) return Promise.reject(new Error("устройство не в сети — откройте на нём приложение Светланы"));
    const need = METHODS[method]; if (!need) return Promise.reject(new Error("неизвестная команда"));
    if (!conn.info.capabilities.includes(need)) return Promise.reject(new Error(`устройство не дало доступ «${need}» (включите в приложении)`));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { conn.pending.delete(id); reject(new Error("устройство не ответило вовремя")); }, timeoutMs);
      conn.pending.set(id, { resolve, reject, t });
      conn.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

export function deviceTools(hub) {
  const dev = { type: "string", minLength: 1, maxLength: 40 };
  return [
    { name: "device_list", domain: "device", taints: true, risk: "read", description: "Список подключённых устройств (телефон, компьютер, вкладка браузера) и выданных ими доступов.",
      async execute() { const l = hub.list(); return { data: l, summary: `Устройств: ${l.length}, в сети: ${l.filter((d) => d.online).length}` }; } },
    { name: "screen_view", domain: "device", taints: true, risk: "read", description: "Посмотреть экран устройства (скриншот придёт вам как изображение) и, если есть, дерево элементов интерфейса.",
      parameters: { type: "object", properties: { deviceId: dev, withTree: { type: "boolean" } }, required: ["deviceId"], additionalProperties: false },
      async execute(_c, a) {
        const shot = await hub.call(a.deviceId, "screen.capture", { maxSide: 1280, format: "jpeg" });
        hub.shots.delete(a.deviceId);
        if (!shot?.image || !/^[A-Za-z0-9+/=]+$/.test(shot.image.slice(0, 200))) return { ok: false, error: "устройство не прислало изображение" };
        if (!Number.isInteger(shot.width) || !Number.isInteger(shot.height) || shot.width < 1 || shot.height < 1 || shot.width > 8192 || shot.height > 8192) return { ok: false, error: "неверный размер скриншота" };
        hub.shots.set(a.deviceId, { w: shot.width, h: shot.height, at: Date.now() }); // только валидный снимок открывает управление
        let tree; if (a.withTree) tree = await hub.call(a.deviceId, "ui.tree", {}).catch((e) => ({ error: e.message }));
        return { data: { width: shot.width, height: shot.height, app: shot.app, tree }, image: { mime: shot.mime || "image/jpeg", base64: shot.image }, summary: `Экран ${shot.width}×${shot.height}${shot.app ? `, открыто: ${shot.app}` : ""}`, untrusted: true };
      } },
    { name: "apps_list", domain: "device", taints: true, risk: "read", description: "Список установленных/запущенных приложений на устройстве.",
      parameters: { type: "object", properties: { deviceId: dev }, required: ["deviceId"], additionalProperties: false },
      async execute(_c, a) { const r = await hub.call(a.deviceId, "apps.list", {}); return { data: r, summary: `Приложений: ${Array.isArray(r) ? r.length : "?"}` }; } },
    { name: "device_act", domain: "device", taints: true, risk: "dangerous", description: "Управлять устройством: нажать, провести, ввести текст, клавиша, открыть приложение, назад, домой. Координаты — в пикселях последнего скриншота.",
      parameters: { type: "object", properties: { deviceId: dev, action: { type: "string", enum: ["tap", "swipe", "type", "key", "launch", "back", "home", "clipboard_set"] },
        x: { type: "number", minimum: 0 }, y: { type: "number", minimum: 0 }, x2: { type: "number", minimum: 0 }, y2: { type: "number", minimum: 0 }, text: { type: "string", maxLength: 5000 }, key: { type: "string", maxLength: 40 }, app: { type: "string", maxLength: 200 } },
        required: ["deviceId", "action"], additionalProperties: false },
      async execute(_c, a) {
        const map = { tap: ["input.tap", { x: a.x, y: a.y }], swipe: ["input.swipe", { x: a.x, y: a.y, x2: a.x2, y2: a.y2 }], type: ["input.type", { text: a.text }], key: ["input.key", { key: a.key }],
          launch: ["app.launch", { app: a.app }], back: ["nav.back", {}], home: ["nav.home", {}], clipboard_set: ["clipboard.set", { text: a.text }] };
        const [m, p] = map[a.action];
        if (["tap", "swipe"].includes(a.action) && (a.x === undefined || a.y === undefined)) return { ok: false, error: "нужны координаты x, y" };
        if (a.action === "swipe" && (a.x2 === undefined || a.y2 === undefined)) return { ok: false, error: "нужны x2, y2" };
        if (["type", "clipboard_set"].includes(a.action) && typeof a.text !== "string") return { ok: false, error: "нужен text" };
        // Сначала смотрим, потом делаем: нужен свежий скриншот (≤2 мин), координаты — в его границах.
        const shot = hub.shots.get(a.deviceId);
        if (!shot || Date.now() - shot.at > 120_000) return { ok: false, error: "сначала посмотрите экран (screen_view) — скриншот старше 2 минут или его нет" };
        for (const [x, y] of [[a.x, a.y], [a.x2, a.y2]]) if (x !== undefined && (x >= shot.w || y >= shot.h)) return { ok: false, error: `координаты вне экрана ${shot.w}×${shot.h}` };
        const r = await hub.call(a.deviceId, m, p);
        if (r?.executed !== true) return { ok: false, error: r?.error || "устройство не подтвердило выполнение", data: r };
        // Устройство само подтверждает факт: executed — команда выполнена, verified — изменение на экране замечено.
        hub.shots.delete(a.deviceId); // экран мог измениться — перед следующим действием снова смотрим
        return { ok: true, data: r, summary: r.verified ? "выполнено, изменение на экране подтверждено" : "команда выполнена, изменения на экране не видно — посмотрите скриншот" };
      } },
  ];
}
