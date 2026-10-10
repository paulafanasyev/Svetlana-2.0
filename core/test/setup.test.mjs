// Мастер первого запуска: облачные пресеты, сборка провайдера, проверки телефона и итог (без DOM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const win = {}; win.window = win;
vm.runInContext(readFileSync(new URL("../web/setup-logic.js", import.meta.url), "utf8"), vm.createContext(win));
const L = win.SvSetupLogic;
const model = (o) => ({ id: "m", title: "M", gb: 1.1, fits: true, rec: false, space: true, state: { phase: "none" }, ...o });

test("пресеты: уникальные id, ссылка на ключ, модель по умолчанию", () => {
  const ids = [...L.PRESETS.map((p) => p.id)];
  assert.equal(new Set(ids).size, ids.length);
  for (const p of L.PRESETS) { assert.match(p.link, /^https:\/\//); assert.ok(p.models.length > 0); assert.ok(p.caps.includes("chat")); }
  assert.deepEqual([...ids.slice(0, 4)], ["gigachat", "yandex", "deepseek", "openrouter"]); // из России — первыми
});

test("провайдер: ключ чистится, тип и модель из пресета", () => {
  const b = L.buildProvider("deepseek", { key: "  Bearer sk-1234567890abcdef  " });
  assert.equal(b.apiKey, "sk-1234567890abcdef"); assert.equal(b.type, "openai"); assert.equal(b.model, "deepseek-chat"); assert.equal(b.id, "deepseek");
  assert.equal(L.buildProvider("gigachat", { key: "Basic MDE5YTxxxxxxxx==" }).type, "gigachat");
  assert.equal(L.buildProvider("anthropic", { key: "sk-ant-abcdefgh" }).type, "anthropic");
  assert.throws(() => L.buildProvider("openai", { key: "short" }), /не целиком/);
  assert.throws(() => L.buildProvider("openai", { key: "sk-abc def ghij" }), /не целиком/);
  assert.throws(() => L.buildProvider("nope", { key: "x".repeat(20) }), /Нет такого/);
});

test("YandexGPT: нужен ID каталога, модель gpt://каталог/…, ключ Api-Key", () => {
  assert.throws(() => L.buildProvider("yandex", { key: "AQVN1234567890" }), /каталога/);
  const b = L.buildProvider("yandex", { key: "AQVN1234567890", folder: "b1gabcdef12345", model: "yandexgpt-lite/latest" });
  assert.equal(b.model, "gpt://b1gabcdef12345/yandexgpt-lite/latest"); assert.equal(b.authScheme, "Api-Key"); assert.equal(b.headers["x-folder-id"], "b1gabcdef12345");
});

test("проверки телефона: 32-бит и старый Android — красные, мало места — предупреждение", () => {
  const strong = L.checks({ arm64: true, sdk: 34, android: "14", ramGb: 7.6, freeGb: 40, serverBundled: true, models: [model({})] });
  assert.ok(strong.every((c) => c.ok));
  const weak = L.checks({ arm64: false, sdk: 26, android: "8.0", ramGb: 2, freeGb: 0.2, serverBundled: false, models: [model({ fits: false })] });
  const by = Object.fromEntries(weak.map((c) => [c.id, c]));
  assert.equal(by.cpu.ok, false); assert.equal(by.android.ok, false); assert.equal(by.ram.ok, false); assert.equal(by.disk.ok, false); assert.equal(by.disk.warn, true);
  assert.match(by.cpu.why, /64-бит/);
});

test("итог: сильный — модель с советом, слабый — облако со всеми функциями", () => {
  const local = L.verdictText({ verdict: "local", tierName: "хороший телефон", models: [model({ title: "Qwen3 4B — умная", gb: 2.5, rec: true })] });
  assert.match(local.text, /Qwen3 4B/); assert.match(local.title, /хороший телефон/);
  const cloud = L.verdictText({ verdict: "cloud", arm64: true, sdk: 34, serverBundled: true, models: [] });
  assert.match(cloud.text, /памяти/); assert.match(cloud.text, /всё будет работать/); assert.match(cloud.text, /👁/);
  assert.match(L.verdictText({ verdict: "cloud", arm64: false, sdk: 34 }).text, /64-битного/);
  assert.match(L.verdictText({ verdict: "weak" }).text, /облако/i);
});

test("строка состояния модели", () => {
  assert.match(L.modelLine(model({ state: { phase: "downloading", done: 5e8, total: 1e9 } }), "", null), /0,5 из 1,0 ГБ/);
  assert.match(L.modelLine(model({ id: "a", state: { phase: "ready" } }), "a", { state: "ready" }), /Включена/);
  assert.match(L.modelLine(model({ id: "a", state: { phase: "ready" } }), "a", { state: "starting" }), /в память/);
  assert.match(L.modelLine(model({ state: { phase: "corrupt" } }), "", null), /повреждён/);
  assert.match(L.modelLine(model({ space: false, gb: 2 }), "", null), /2,1 ГБ свободного/);
});

// ---------- мастер в «браузере» на заглушках DOM: порядок скриптов, автозапуск, «Позже», гонки ----------
function fakeDom() {
  const els = {};
  const el = (id) => els[id] || (els[id] = { id, hidden: true, innerHTML: "", textContent: "", dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    querySelector: (s) => el(id + " " + s), querySelectorAll: () => [], addEventListener(n, f) { (this.on ||= {})[n] = f; }, insertAdjacentHTML() {}, focus() {} });
  return { els, el };
}
function loadWizard({ hash = "", providers = [], skip = false, bridge = null } = {}) {
  const { els, el } = fakeDom(); const store = skip ? { sv_setup_skip: "1" } : {}; const calls = [];
  let release; const gate = new Promise((r) => (release = r));
  const win = {
    document: { querySelector: (s) => el(s), body: el("body") }, location: { hash, pathname: "/", search: "" }, history: { replaceState() {} },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
    addEventListener() {}, setTimeout, clearInterval() {}, setInterval: () => 0, confirm: () => true,
    api: async (path) => { calls.push(path); await gate; return providers; }, speak() {},
    SvAvatar: { mount() {}, setState() {}, feel() {} }, SvetlanaSetup: bridge,
  };
  win.window = win; const c = vm.createContext(win);
  vm.runInContext(readFileSync(new URL("../web/setup-logic.js", import.meta.url), "utf8"), c);
  vm.runInContext(readFileSync(new URL("../web/setup.js", import.meta.url), "utf8"), c);
  return { win, els, store, calls, release, W: win.svSetup._w };
}

test("index.html: setup.js загружается до app.js (иначе boot() не видит мастер)", () => {
  const h = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  const at = (f) => h.indexOf(`<script src="/${f}">`);
  assert.ok(at("avatar.js") >= 0 && at("avatar.js") < at("setup-logic.js") && at("setup-logic.js") < at("setup.js") && at("setup.js") < at("app.js"));
  assert.doesNotMatch(h, /onclick=/); // CSP script-src 'self': встроенные обработчики не работают
});

test("автозапуск: #setup открывает сразу; нет провайдеров — открывает; «Позже» — нет", async () => {
  const a = loadWizard({ hash: "#setup" }); await a.win.svSetup.auto(); assert.equal(a.W.open, true); assert.equal(a.W.step, "hello");
  const b = loadWizard(); const p = b.win.svSetup.auto(); b.release(); await p; assert.equal(b.W.open, true);
  const n = loadWizard({ hash: "#setup", bridge: { report: () => "{}", skipped: () => true } }); await n.win.svSetup.auto(); assert.equal(n.W.open, false); // «Позже» на телефоне сильнее ссылки #setup
  const c = loadWizard({ skip: true, hash: "#setup" }); await c.win.svSetup.auto(); assert.equal(c.W.open, false); assert.equal(c.calls.length, 0);
  const d = loadWizard({ providers: [{ id: "gigachat" }] }); const q = d.win.svSetup.auto(); d.release(); await q; assert.equal(d.W.open, false);
});

test("автозапуск не перебивает пользователя: открыл облако или закрыл, пока ждали ядро", async () => {
  const a = loadWizard(); const p = a.win.svSetup.auto(); a.win.svSetup.open("cloud"); a.release(); await p;
  assert.equal(a.W.step, "cloud"); assert.equal(a.W.mode, "cloud");
  const b = loadWizard(); const q = b.win.svSetup.auto(); b.win.svSetup.open("cloud"); b.win.svSetup.close(); b.release(); await q;
  assert.equal(b.W.open, false);
});

test("Android: модель уже выбрана — мастер сам не открывается; «brain» начинает с оценки телефона", async () => {
  const rep = { arm64: true, sdk: 34, ramGb: 7.6, freeGb: 50, serverBundled: true, verdict: "local", active: "qwen3-4b", llm: { state: "ready" }, models: [] };
  const bridge = { report: () => JSON.stringify(rep) };
  const a = loadWizard({ bridge }); await a.win.svSetup.auto(); assert.equal(a.W.open, false); assert.equal(a.calls.length, 0);
  a.win.svSetup.open("brain"); assert.equal(a.W.step, "check");
  const b = loadWizard(); b.win.svSetup.open("brain"); assert.equal(b.W.step, "cloud"); // в браузере без телефона — сразу облако
});

test("модель выбрана, но упала — мастер открывается; «Добавить 👁» показывает только видящие сервисы", async () => {
  const rep = { arm64: true, sdk: 34, ramGb: 7.6, freeGb: 50, serverBundled: true, verdict: "local", active: "qwen3-4b", llm: { state: "error" }, models: [] };
  const a = loadWizard({ bridge: { report: () => JSON.stringify(rep), skipped: () => false } }); const p = a.win.svSetup.auto(); a.release(); await p; assert.equal(a.W.open, true);
  const b = loadWizard(); const el = { innerHTML: "", querySelector: () => null }; b.win.svSetup.cloudForm(el, true, () => {});
  assert.match(el.innerHTML, /data-p="openrouter"/); assert.doesNotMatch(el.innerHTML, /data-p="gigachat"|data-p="deepseek"|data-p="yandex"/);
  const c = loadWizard(); const el2 = { innerHTML: "", querySelector: () => null }; c.win.svSetup.cloudForm(el2, () => {}); assert.match(el2.innerHTML, /data-p="gigachat"/);
});
