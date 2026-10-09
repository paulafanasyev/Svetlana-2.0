// Живой аватар: виземы, фразы, эмоции и кадр отрисовки без браузера (заглушки canvas/DOM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function load() {
  const calls = []; let raf = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push(k); return k === "getImageData" ? { data: new Uint8ClampedArray(64).fill(200) } : k === "createRadialGradient" ? { addColorStop() {} } : undefined; }), set: (t, k, v) => ((t[k] = v), true) });
  const canvas = () => ({ width: 0, height: 0, style: {}, getContext: () => ctx, isConnected: true, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
  const listeners = {};
  const win = {
    devicePixelRatio: 2, innerWidth: 400, innerHeight: 800,
    addEventListener: (n, f) => { listeners[n] = f; },
    requestAnimationFrame: (f) => raf.push(f),
    document: { hidden: false, createElement: () => canvas() },
    performance: { now: () => 0 },
    Image: class { set src(v) { this._s = v; } },
  };
  win.window = win;
  const c = vm.createContext(win);
  vm.runInContext(readFileSync(new URL("../web/avatar.js", import.meta.url), "utf8"), c);
  return { A: win.SvAvatar, win, calls, listeners, step: (now) => { const q = raf; raf = []; q.forEach((f) => f(now)); } };
}

test("эмоции по тексту и эмодзи", () => {
  const { emotion } = load().A._test;
  assert.equal(emotion("Ха-ха, смешно"), "laugh");
  assert.equal(emotion("Не удалось открыть файл"), "sad");
  assert.equal(emotion("Извините, я ошиблась"), "sorry");
  assert.equal(emotion("Как вас зовут?"), "question");
  assert.equal(emotion("Готово!"), "joy");
  assert.equal(emotion("Обнимаю 🥰"), "tender");
  assert.equal(emotion("Хм, дай подумать"), "thinking");
  assert.equal(emotion("Просто текст"), "calm");
});

test("виземы: «а» открывает рот, «м» смыкает губы, «у» округляет, «и» растягивает", () => {
  const { timeline, visemeAt } = load().A._test;
  const tl = timeline("мама");
  const at = (i) => { const x = tl.items.find((y) => y.i === i); return visemeAt(tl, x.t0 + (x.t1 - x.t0) * .3); };
  assert.equal(at(0).o, 0); assert.ok(at(1).o > .8);
  const u = timeline("у").items[0], tu = timeline("у"); assert.ok(visemeAt(tu, .1).w < -.8, String(u.v));
  assert.ok(visemeAt(timeline("и"), .1).w > .7);
  assert.equal(visemeAt(tl, tl.total + 1).o, 0); // после конца — рот закрыт
});

test("паузы на знаках препинания и цифры как слова", () => {
  const { timeline } = load().A._test;
  assert.ok(timeline("да. да").total > timeline("да да").total + 4);
  assert.ok(timeline("2025").total > 8);
});

test("фразы: кивок на «да», покачивание на «нет», наклон на вопрос", () => {
  const { phrases } = load().A._test;
  const p = phrases("Да, сделаю. Нет, это опасно. Как назовём проект? Ура!");
  assert.equal(p.map((x) => x.g).join(","), "nod,shake,tilt,browflash");
  assert.equal(p[1].e, "fear");
  assert.equal(p[0].i0, 0); assert.ok(p[1].i0 > p[0].i0);
});

test("синхронизация: событие «слово N» подтягивает губы к нужному месту", () => {
  const { Speech } = load().A._test;
  const s = new Speech("Привет, как дела у тебя сегодня?");
  assert.equal(s.frame(5).o, 0); // ещё не началось
  s.start(1000); s.at(20, 1500);
  const f = s.frame(1501); assert.ok(f.ph, "есть текущая фраза");
  const { unitsAtChar } = load().A._test;
  assert.ok(Math.abs(s.units(1501) - unitsAtChar(s.tl, 20)) < 1, "губы на 20-м символе");
  s.ended = true; assert.equal(s.frame(1600).o, 0);
});

test("кадр рисуется без ошибок во всех состояниях, с речью и без", async () => {
  const { A, win, step, calls, listeners } = load();
  // портрет «загрузился»: заглушка Image сама вызывает onload
  win.Image = class { constructor() { this.naturalWidth = 600; this.naturalHeight = 600; } set src(v) { setTimeout(() => this.onload?.(), 0); } };
  const el = (id) => ({ className: "ava", id, title: "", replaceWith() {} });
  A.mount(el("ava"), 44); A.mount(el("stageAva"), 128);
  await new Promise((r) => setTimeout(r, 5));
  let now = 0;
  for (const s of ["idle", "listening", "thinking", "offline", "speaking"]) { A.setState(s); for (let i = 0; i < 20; i++) step((now += 16)); }
  const lip = A.speech("Да, конечно! Это отличная идея? Ммм... у-у-у, и-и-и.");
  lip.start(); for (let i = 0; i < 200; i++) step((now += 16));
  lip.at(10); for (let i = 0; i < 50; i++) step((now += 16));
  listeners.pointermove?.({ clientX: 10, clientY: 10 });
  for (const e of Object.keys(A._test.EXPR)) { A.feel(e); for (let i = 0; i < 5; i++) step((now += 16)); }
  for (const a of Object.keys(A._test.ACTION_MS)) { A.react(a); for (let i = 0; i < 10; i++) step((now += 16)); }
  lip.end(); A.hush(); step((now += 16));
  assert.ok(calls.includes("ellipse") && calls.includes("drawImage"));
});

test("say() + мост телефона: губы стартуют по __svSpeechStart/__svRange, «готова» их останавливает", () => {
  const { A, win } = load();
  A.setState("speaking"); A.say("Привет! Как дела?");
  assert.equal(typeof win.__svRange, "function");
  win.__svSpeechStart(); win.__svRange(8); // не падает и принимает позицию
  A.setState("idle"); win.__svRange(10); // речи уже нет — тихо игнорируем
});

test("звук сервера: губы идут по времени плеера и молчат на паузе; системные API не подменяются", () => {
  const { A, win } = load();
  const play = function () {}; win.HTMLMediaElement = { prototype: { play } };
  const audio = { paused: true, currentTime: 0, duration: 4, addEventListener(n, f) { this["on_" + n] = f; } };
  A.setState("speaking"); A.say("Мама мыла раму. А потом отдыхала.");
  A.voice(audio);
  const sp = A._test.current();
  assert.equal(sp.frame(10).o, 0, "до старта рот закрыт");
  audio.paused = false; audio.currentTime = .1; audio.on_playing();
  let open = 0; for (let t = .1; t < 4; t += .05) { audio.currentTime = t; open = Math.max(open, sp.frame(1000 + t * 1000).o); }
  assert.ok(open > .5, "по ходу речи рот открывается");
  audio.paused = true; assert.equal(sp.frame(9000).o, 0, "пауза — рот закрыт");
  assert.equal(win.HTMLMediaElement.prototype.play, play, "play не подменён");
  assert.equal(sp.an, null, "без работающего AudioContext анализатор не подключается — звук не пропадёт");
});
