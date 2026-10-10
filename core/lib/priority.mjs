// Приоритет ИИ: порядок в списке «Подключено» = порядок попыток (при сбое — следующий). Версия ядра — чтобы на телефоне было видно, что стоит новая сборка.
// Работает и на телефоне (Node 18 без ICU).
export const VERSION = "2.1 · команда, свой ИИ, приоритет";
const prioIds = (store) => store.get("settings", "priority")?.ids || [];
function applyPriority(providers, ids) {
  if (!ids.length) return;
  const pos = (p) => { const i = ids.indexOf(p.id); return i < 0 ? ids.length : i; };
  providers.list = providers.list.map((p, i) => [p, i]).sort((a, b) => pos(a[0]) - pos(b[0]) || a[1] - b[1]).map(([p]) => p);
}
/** Порядок сохраняется отдельно: модель телефона («local») при каждом запуске регистрируется заново — и встаёт на своё место. */
export function installPriority(store, providers) {
  const up = providers.upsert.bind(providers);
  providers.upsert = (p) => { const n = up(p); const ids = prioIds(store); if (ids.length) { applyPriority(providers, ids); providers.save(); } return n; };
  applyPriority(providers, prioIds(store));
}
export function setPriority(store, providers, ids) {
  const known = new Set(providers.list.map((p) => p.id));
  const clean = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((id) => known.has(id) || id === "local").slice(0, 100);
  const row = { ids: clean };
  if (store.get("settings", "priority")) store.update("settings", "priority", row); else store.insert("settings", { id: "priority", ...row });
  applyPriority(providers, clean); providers.save();
  return providers.list.map((p) => p.id);
}

/** [status, body] или null — маршруты /api/version и /api/providers/order (после проверки входа). */
export async function priorityApi(app, req, p, readJson) {
  if (p === "/api/version" && req.method === "GET") return [200, { version: VERSION, tools: app.registry.list().length, providers: app.providers.list.length }];
  if (p === "/api/providers/order" && req.method === "POST") { const b = await readJson(req); return [200, { ok: true, order: setPriority(app.store, app.providers, b.ids) }]; }
  return null;
}
