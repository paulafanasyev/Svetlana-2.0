"use strict";
// Живой аватар Светланы для веба и Android — порт desktop-agent/avatar.py (а тот — svetlanaFace.js из Svetlana-self-employed):
// моргание, брови, улыбка, румянец, наклоны головы, смех/кивок/подмигивание и кольцо состояния.
// 1.1: губы под речь (виземы русских звуков по тексту + время плеера/события голоса, на ПК ещё и громкость), эмоции по каждой фразе, жесты (кивок на «да»,
// покачивание на «нет», наклон на вопрос, вскидывание бровей на «!»), дыхание, микродвижения головы и взгляд за пальцем/курсором.
// Портрет /svetlana-face.jpg (оснастка в его координатах). Нет портрета — остаётся обычная картинка.
(() => {
  const RIG = { view: [90, 95, 360], blinkMs: 130, blinkGap: [2200, 5700], eyes: [[195, 233, 36, 22], [316, 215, 36, 25]], cheeks: [[178, 282, 34], [338, 262, 32]], jawDrop: 13, mouth: [259, 319, 46] };
  // bt — наклон бровей: + поднимает внутренние концы (грусть, тревога), − опускает (сердитость)
  const ZERO = { bl: 0, br: 0, bt: 0, sq: 0, ml: 0, mr: 0, jaw: 0, round: 0, blush: 0, tear: 0, sweat: 0, wl: 0, wr: 0, rot: 0, hx: 0, hy: 0, hs: 1 };
  const EXPR = {
    calm: {}, joy: { bl: 3, br: 3, sq: .22, ml: .9, mr: .9, blush: .25 },
    laugh: { bl: 4, br: 4, sq: .95, ml: 1.2, mr: 1.2, jaw: .55, blush: .45, action: "laugh" },
    surprise: { bl: 10, br: 10, jaw: .75, round: .8, action: "browflash" }, question: { bl: 1, br: 9, ml: -.2, mr: .35, rot: .12, hx: 4 },
    thinking: { bl: -2, br: 6, sq: .18, ml: -.3, mr: .5, rot: -.08, hx: -4, hy: -3 },
    sad: { bl: -1, br: -1, bt: .9, sq: .25, ml: -1.8, mr: -1.8, rot: .04, hy: 4, tear: 1 }, fear: { bl: 6, br: 6, bt: .8, sq: .3, jaw: .3, round: .3, hy: -4, sweat: 1 },
    shy: { bl: 1, br: 1, sq: .35, ml: .5, mr: .5, blush: .9, rot: .1, hy: 5 }, wink: { bl: 2, br: 4, ml: .4, mr: 1.1, action: "wink" },
    angry: { bl: -3, br: -3, bt: -1, sq: .35, ml: -.7, mr: -.7, hy: -2 },
    tender: { bl: 2, br: 2, bt: .3, sq: .3, ml: .8, mr: .8, blush: .6, rot: .07, hy: 2 },
    tired: { bl: -2, br: -2, bt: .3, sq: .5, ml: -.3, mr: -.3, hy: 5, rot: -.03 },
    proud: { bl: 1, br: 3, sq: .1, ml: .5, mr: 1, hy: -3, rot: -.04 },
    sorry: { bl: 1, br: 1, bt: .7, sq: .2, ml: -.6, mr: -.6, rot: .06, hy: 3, action: "shake" },
  };
  const ACTION_MS = { laugh: 2200, nod: 1000, shake: 1100, wink: 900, tilt: 1300, browflash: 650 };
  const STATES = { offline: "#9aa0a6", idle: "#2f7d55", listening: "#22a6c8", thinking: "#e08a1e", speaking: "#2f7d55" };
  const STATE_EXPR = { listening: "question", thinking: "thinking" };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- эмоции ----------
  const EMOJI = [[/😂|🤣|😆|😹/u, "laugh"], [/😉|😜|😏/u, "wink"], [/😢|😭|😔|😞|💔/u, "sad"], [/😮|😲|🤯|😱/u, "surprise"], [/🤔|🧐/u, "thinking"], [/😠|😡|🤬/u, "angry"], [/❤|💖|💕|🥰|😍|🤗/u, "tender"], [/😴|🥱/u, "tired"], [/😎|💪|🏆/u, "proud"], [/😊|🙂|😀|😃|😄|🎉|✨|👍|✅/u, "joy"]];
  function emotion(text) {
    const s = String(text || ""); for (const [re, e] of EMOJI) if (re.test(s)) return e;
    const t = s.toLowerCase();
    if (/ха-?ха|хах|хи-?хи|смешно|шучу/.test(t)) return "laugh";
    if (/извини|простите|прошу прощения|к сожалению/.test(t)) return "sorry";
    if (/не удалось|не смогла|не получилось|failed|не выполнено|ошибк/.test(t)) return "sad";
    if (/опасно|срочно|внимание|осторожно|риск/.test(t)) return "fear";
    if (/возмутительно|безобразие|так нельзя|недопустимо|злит/.test(t)) return "angry";
    if (/ого|вау|ничего себе|неужели|невероятно/.test(t)) return "surprise";
    if (/люблю|обнимаю|милый|милая|дорог(ой|ая)|спасибо вам|рада за/.test(t)) return "tender";
    if (/устал|сонн|поздно уже/.test(t)) return "tired";
    if (/горжусь|я справилась|лучший результат|рекорд/.test(t)) return "proud";
    if (/дай(те)? подумать|хм+|надо подумать|давайте разберём|прикину/.test(t)) return "thinking";
    if (t.trim().endsWith("?")) return "question";
    if (/готово|отлично|супер|подтверждено|рада|ура|получилось|!/.test(t)) return "joy";
    return "calm";
  }

  // ---------- виземы: форма губ для русских букв ----------
  // o — раскрытие рта 0..1, w — ширина: + растянуты (и, э), − округлены (о, у). d — длительность звука (относительная).
  const V = { a: { o: .95, w: .15, d: 1.3 }, o: { o: .7, w: -.7, d: 1.3 }, u: { o: .38, w: -1, d: 1.2 }, y: { o: .42, w: .25, d: 1.1 }, e: { o: .6, w: .5, d: 1.2 }, i: { o: .32, w: .85, d: 1.1 },
    m: { o: 0, w: -.05, d: .9 }, f: { o: .12, w: .2, d: .8 }, sh: { o: .26, w: -.55, d: .9 }, s: { o: .16, w: .45, d: .8 }, c: { o: .22, w: .1, d: .7 }, l: { o: .3, w: .1, d: .75 } };
  const LETTER = {};
  const add = (letters, v) => { for (const ch of letters) LETTER[ch] = v; };
  add("аяa", "a"); add("оёo", "o"); add("уюuqw", "u"); add("ы", "y"); add("эеe", "e"); add("иiйj", "i"); add("мбпmbp", "m"); add("вфvf", "f");
  add("шщжчg", "sh"); add("сзцsz", "s"); add("тдкгхнрtdkhnrcx", "c"); add("лl", "l");
  const PAUSE = { ",": 3, ";": 4, ":": 4, "—": 4, "–": 4, "-": 1, ".": 6, "!": 6, "?": 6, "…": 7, "\n": 6, " ": .9 };
  const UNIT_MS = 62; // длительность «единицы» при обычном темпе (~14 букв в секунду, как и раньше)

  /** Раскладка текста по времени: [{i, v, t0, t1}] в «единицах» (потом растягиваем под реальный звук). */
  function timeline(text) {
    const s = String(text || "").toLowerCase(); const out = []; let t = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]; const v = LETTER[ch];
      if (v) { const d = V[v].d; out.push({ i, v, t0: t, t1: t + d }); t += d; continue; }
      if (/[0-9]/.test(ch)) { out.push({ i, v: "e", t0: t, t1: t + 2.4 }); t += 2.4; continue; } // цифра — это целое слово
      const p = PAUSE[ch]; if (p) { out.push({ i, v: null, t0: t, t1: t + p }); t += p; }
    }
    return { items: out, total: t, len: s.length };
  }
  /** Фразы с эмоцией и жестом в начале: [{i0, i1, e, g}] */
  function phrases(text) {
    const s = String(text || ""); const out = []; const re = /[^.!?…\n]+[.!?…]*\s*/g; let m;
    while ((m = re.exec(s))) {
      const p = m[0]; if (!p.trim()) continue; const low = p.trim().toLowerCase();
      let g = null;
      if (/^(да|конечно|хорошо|ладно|верно|точно|согласна|готово|сделала|принято|ок)(?![а-яё\w])/.test(low)) g = "nod";
      else if (/^(нет|не могу|не стоит|не надо|увы|к сожалению)(?![а-яё\w])/.test(low)) g = "shake";
      else if (/\?\s*$/.test(low)) g = "tilt";
      else if (/!\s*$/.test(low)) g = "browflash";
      out.push({ i0: m.index, i1: m.index + p.length, e: emotion(p), g });
    }
    return out;
  }
  /** Виземa в момент u (в единицах) с плавным переходом между соседними звуками. */
  function visemeAt(tl, u) {
    const it = tl.items; if (!it.length) return { o: 0, w: 0, i: 0 };
    let lo = 0, hi = it.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (it[mid].t0 <= u) lo = mid; else hi = mid - 1; }
    const a = it[lo]; const va = a.v ? V[a.v] : { o: 0, w: 0 };
    if (u >= tl.total) return { o: 0, w: 0, i: tl.len };
    const b = it[lo + 1]; const vb = b ? (b.v ? V[b.v] : { o: 0, w: 0 }) : { o: 0, w: 0 };
    const f = clamp((u - a.t0) / Math.max(.01, a.t1 - a.t0), 0, 1); const k = f < .6 ? 0 : (f - .6) / .4; // 60% звука держим форму, потом переходим к следующему
    return { o: va.o + (vb.o - va.o) * k, w: va.w + (vb.w - va.w) * k, i: a.i };
  }
  /** Время (в единицах) для позиции символа — чтобы подстроиться под события «сейчас слово N». */
  function unitsAtChar(tl, ci) { for (const x of tl.items) if (x.i >= ci) return x.t0; return tl.total; }

  // ---------- синхронизация речи ----------
  // Источники: звук сервера (точное время + громкость через WebAudio), голос браузера/телефона (события «начато слово»),
  // иначе — равномерный темп по тексту.
  let AC = null; const HOOKED = new WeakSet();
  const UA = typeof navigator === "object" ? String(navigator.userAgent || "") : "";
  const METER_OK = !window.SvetlanaAndroid && !/iPhone|iPad|iPod/.test(UA) && !(/Macintosh/.test(UA) && typeof navigator === "object" && navigator.maxTouchPoints > 1);
  function audioCtx() { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); } catch { AC = null; } return AC; }
  class Speech {
    constructor(text) { this.text = String(text || ""); this.tl = timeline(this.text); this.ph = phrases(this.text); this.t0 = 0; this.u0 = 0; this.rate = 1 / UNIT_MS; this.started = false; this.ended = false; this.audio = null; this.an = null; this.buf = null; this.peak = .05; this.first = 0; this._n = -1; this._f = null; this.id = ""; }
    start(now = performance.now()) { if (!this.started) { this.started = true; this.t0 = this.first = now; this.u0 = 0; } }
    /** голос сообщил: сейчас произносится символ ci */
    at(ci, now = performance.now()) {
      this.start(now); const u = unitsAtChar(this.tl, ci); const cur = this.units(now);
      const el = now - this.first; if (el > 300 && u > 2) this.rate = clamp(this.rate * .5 + (u / el) * .5, .4 / UNIT_MS, 2.5 / UNIT_MS); // подстраиваем темп голоса
      if (Math.abs(u - cur) > .5) { this.u0 = u; this.t0 = now; }
    }
    units(now) {
      if (this.audio && this.audio.duration > 0 && isFinite(this.audio.duration)) return this.audio.currentTime / this.audio.duration * this.tl.total;
      if (!this.started) return 0; return Math.min(this.tl.total, this.u0 + (now - this.t0) * this.rate);
    }
    /** Подключить звук: время берём из плеера, громкость — из анализатора (если браузер разрешил) */
    attach(audio) {
      this.audio = audio; audio.addEventListener("playing", () => this.start(), { once: true });
      // Громкость читаем, только если это безопасно: после createMediaElementSource звук идёт через AudioContext,
      // и уснувший контекст сделал бы голос немым. Поэтому — только уже работающий контекст и не в WebView/iOS.
      const ac = AC; if (!ac || ac.state !== "running" || !METER_OK || HOOKED.has(audio)) return;
      try { const src = ac.createMediaElementSource(audio); const an = ac.createAnalyser(); an.fftSize = 512; src.connect(an); an.connect(ac.destination); HOOKED.add(audio); this.an = an; this.buf = new Uint8Array(an.fftSize); } catch { /* работаем по тексту и времени плеера */ }
    }
    level() {
      if (!this.an) return null; this.an.getByteTimeDomainData(this.buf); let s = 0; for (const x of this.buf) { const d = (x - 128) / 128; s += d * d; }
      const rms = Math.sqrt(s / this.buf.length); this.peak = Math.max(rms, this.peak * .995, .02); return clamp(rms / this.peak, 0, 1);
    }
    /** Состояние губ и текущая фраза (один расчёт на кадр — лиц может быть несколько) */
    frame(now) {
      if (this._n === now && this._f) return this._f;
      let f;
      if (!this.started || this.ended || (this.audio && (this.audio.paused || !this.audio.currentTime))) f = { o: 0, w: 0, ph: null, pi: -1 };
      else {
        const v = visemeAt(this.tl, this.units(now)); const lv = this.level();
        let o = v.o; if (lv !== null) o = lv < .08 ? 0 : o * (.45 + .75 * lv);
        const pi = this.ph.findIndex((p) => v.i >= p.i0 && v.i < p.i1);
        f = { o, w: v.w, ph: pi >= 0 ? this.ph[pi] : null, pi };
      }
      this._n = now; this._f = f; return f;
    }
  }

  // ---------- аниматор ----------
  class Animator {
    constructor() { this.cur = { ...ZERO }; this.expr = "calm"; this.act = null; this.start = 0; this.last = 0; this.next = 0; this.blink = -1; this.lip = { o: 0, w: 0 }; this.look = { x: 0, y: 0, t: 0 }; this.seed = Math.random() * 100; }
    set(name) { name = EXPR[name] ? name : "calm"; if (name !== this.expr) { this.expr = name; if (EXPR[name].action) this.trigger(EXPR[name].action); } }
    trigger(name) { if (ACTION_MS[name]) { this.act = name; this.start = performance.now(); } }
    frame(now, mouth = null, speaking = false) {
      const dt = this.last ? Math.min(now - this.last, 100) : 16; this.last = now; if (!this.next) this.next = now + 1200;
      const T = { ...ZERO }; for (const [k, v] of Object.entries(EXPR[this.expr])) if (k !== "action") T[k] = v;
      const A = { rot: 0, hx: 0, hy: 0, bl: 0, br: 0 }; let extra = 0;
      if (this.act) {
        const e = now - this.start, p = e / ACTION_MS[this.act];
        if (p >= 1) this.act = null;
        else if (this.act === "laugh") { const env = Math.sin(Math.PI * Math.min(1, p * 1.15)); extra = (.35 + .55 * Math.abs(Math.sin(e / 75))) * env; A.rot = .05 * Math.sin(e / 95) * env; A.hy = -4 * Math.abs(Math.sin(e / 75)) * env; Object.assign(T, { sq: Math.max(T.sq, .95 * env), ml: 1.2, mr: 1.2, blush: .5, bl: 4, br: 4 }); }
        else if (this.act === "nod") { A.hy = 9 * Math.sin(Math.PI * 4 * p) * (1 - p); A.rot = .02 * Math.sin(Math.PI * 4 * p) * (1 - p); }
        else if (this.act === "shake") { A.hx = 10 * Math.sin(Math.PI * 5 * p) * (1 - p); A.rot = .05 * Math.sin(Math.PI * 5 * p) * (1 - p); }
        else if (this.act === "tilt") { const env = Math.sin(Math.PI * p); A.rot = .1 * env; A.hx = 3 * env; A.br = 4 * env; }
        else if (this.act === "browflash") { const env = Math.sin(Math.PI * p); A.bl = 6 * env; A.br = 6 * env; }
        else if (this.act === "wink") T.wr = p < .65 ? 1 : 0;
      }
      // живость: дыхание, микродвижения головы, взгляд за пальцем/курсором (затухает через 2 с)
      const m = reduced ? .3 : 1, s = now / 1000 + this.seed;
      const breathe = Math.sin(s * 1.25);
      const lk = now - this.look.t < 2000 ? 1 - (now - this.look.t) / 2000 : 0;
      T.hx += (1.6 * Math.sin(s * .37) + .8 * Math.sin(s * .91) + this.look.x * 7 * lk) * m;
      T.hy += (1.1 * Math.sin(s * .29 + 1) + .9 * breathe + this.look.y * 5 * lk) * m;
      T.rot += (.018 * Math.sin(s * .23 + 2) + .01 * Math.sin(s * .61)) * m;
      T.hs = 1 + .006 * breathe * m + (speaking ? .01 : 0);
      if (speaking) { T.bl += .8 * Math.max(0, Math.sin(s * 2.3)); T.br += .8 * Math.max(0, Math.sin(s * 2.3 + .4)); } // брови чуть «говорят» вместе с речью
      const kf = 1 - Math.exp(-dt / 95); for (const k in ZERO) this.cur[k] += (T[k] - this.cur[k]) * kf;
      // губы двигаются быстрее, чем выражение лица
      const target = mouth || { o: 0, w: 0 }; const kl = 1 - Math.exp(-dt / 38);
      this.lip.o += (target.o - this.lip.o) * kl; this.lip.w += (target.w - this.lip.w) * kl;
      let b = 0;
      if (this.blink < 0 && now >= this.next) this.blink = now;
      if (this.blink >= 0) { const q = (now - this.blink) / RIG.blinkMs; if (q >= 1) { this.blink = -1; const gap = RIG.blinkGap[0] + Math.random() * (RIG.blinkGap[1] - RIG.blinkGap[0]); this.next = now + (Math.random() < .15 ? 260 : gap); } else b = Math.sin(Math.PI * q); } // иногда — двойное моргание
      const c = this.cur, lipOpen = this.lip.o;
      return { ...c, bl: c.bl + A.bl, br: c.br + A.br, rot: c.rot + A.rot, hx: c.hx + A.hx, hy: c.hy + A.hy, open: Math.max(lipOpen, c.jaw * (lipOpen > .05 ? .4 : 1), extra), lw: speaking || lipOpen > .05 ? this.lip.w : -c.round * .7, blink: b, talk: speaking };
    }
  }

  function skinAt(img) { // цвет кожи у глаз — им «закрываются» веки
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    return RIG.eyes.map(([cx, cy, rx, ry]) => {
      try { const d = g.getImageData(Math.round(cx - rx * .7), Math.round(cy - ry * .25), Math.round(rx * 1.4), Math.max(1, Math.round(ry * .5))).data; let r = 0, gg = 0, bb = 0, n = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; bb += d[i + 2]; n++; } return `rgb(${r / n | 0},${gg / n | 0},${bb / n | 0})`; }
      catch { return "rgb(238,216,198)"; }
    });
  }

  function draw(g, img, skin, px, P, now, grey) {
    const [vx, vy, vs] = RIG.view; const k = px / vs, cx = vx + vs / 2, cy = vy + vs / 2;
    g.save(); g.clearRect(0, 0, px, px);
    g.beginPath(); g.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = "#f1f6f2"; g.fillRect(0, 0, px, px);
    if (grey) g.filter = "grayscale(1)";
    g.scale(k, k); g.translate(cx - vx + P.hx, cy - vy + P.hy); g.rotate(P.rot); g.scale(P.hs || 1, P.hs || 1); g.translate(-cx, -cy);
    g.drawImage(img, 0, 0);
    RIG.eyes.forEach(([ex, ey, rx, ry], i) => {
      const b = i ? P.br : P.bl, tilt = (P.bt || 0) * 6; // внутренний конец брови: у левого глаза справа, у правого — слева
      if (Math.abs(b) > .2 || Math.abs(tilt) > .3) {
        const yL = (i ? 190 - tilt : 190) - b, yR = (i ? 191 : 191 - tilt) - b;
        g.strokeStyle = "rgba(55,30,24,.95)"; g.lineWidth = 5; g.lineCap = "round"; g.beginPath(); g.moveTo(ex - rx * .65, yL); g.quadraticCurveTo(ex, 180 - b - tilt * .3, ex + rx * .65, yR); g.stroke();
      }
      const close = clamp(Math.max(P.blink || 0, P.sq, i ? P.wr : P.wl), 0, 1);
      if (close > .03) { const h = ry * (.18 + .82 * close); g.fillStyle = skin[i]; g.beginPath(); g.ellipse(ex, ey, rx * 1.05, h, 0, 0, Math.PI * 2); g.fill(); }
    });
    const [mx, my, mw] = RIG.mouth;
    const open = clamp(P.open, 0, 1.2) * RIG.jawDrop, smile = (P.ml + P.mr) / 2, w = clamp(P.lw || 0, -1, 1);
    const half = mw * (1 + .2 * w), side = (P.mr - P.ml) * 2; // ширина: «и» растягивает, «о/у» собирает губы
    if (open > .25) {
      const oy = my + open * .55, oh = Math.max(3, open * (.9 + (w < 0 ? -w * .35 : 0)));
      g.fillStyle = "rgb(91,26,34)"; g.beginPath(); g.ellipse(mx + side, oy, half, oh, 0, 0, Math.PI * 2); g.fill();
      if (w > .2 && open > 3) { g.save(); g.clip(); g.fillStyle = "rgba(246,240,234,.92)"; g.fillRect(mx - half, oy - oh, half * 2, Math.max(1.5, oh * .32)); g.restore(); } // верхние зубы на «и/э»
      if (open > 7) { g.fillStyle = "rgb(180,84,94)"; g.fillRect(mx - 20 * (1 + .2 * w), my + 3 + open * .65, 40 * (1 + .2 * w), Math.max(2, open * .22)); }
      if (w < -.3) { g.strokeStyle = "rgba(150,62,66,.75)"; g.lineWidth = 3.5; g.beginPath(); g.ellipse(mx + side, oy, half + 1.5, oh + 1.5, 0, 0, Math.PI * 2); g.stroke(); } // округлённые губы
    } else if (P.talk) { // сомкнутые губы на «м/б/п»: плотная линия
      g.strokeStyle = "rgba(139,61,59,.95)"; g.lineWidth = 3.6; g.lineCap = "round"; g.beginPath(); g.moveTo(mx - half * .92, my - smile * 5); g.quadraticCurveTo(mx, my + 3 - smile * 5, mx + half * .92, my - smile * 4); g.stroke();
    } else if (Math.abs(smile) > .03) {
      g.strokeStyle = "rgba(139,61,59,.95)"; g.lineWidth = 3; g.lineCap = "round"; g.beginPath(); g.moveTo(216, 319 - P.ml * 5); g.quadraticCurveTo(258, 327 - smile * 5, 303, 319 - P.mr * 4); g.stroke();
    }
    if (P.blush > .02) for (const [x, y, r] of RIG.cheeks) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(236,92,112,${.42 * P.blush})`); gr.addColorStop(1, "rgba(236,92,112,0)"); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    if (P.tear > .3) { const ty = 256 + (now % 2600) / 2600 * 46; g.fillStyle = "rgba(150,200,240,.8)"; g.beginPath(); g.ellipse(176, ty, 5, 5, 0, 0, Math.PI * 2); g.fill(); }
    if (P.sweat > .3) { const sy = 150 + Math.sin(now / 300) * 2; g.fillStyle = "rgba(150,200,240,.8)"; g.beginPath(); g.ellipse(356, sy, 6, 6, 0, 0, Math.PI * 2); g.fill(); }
    g.restore();
  }

  const faces = []; let speech = null;
  /** Живое лицо в canvas поверх img: mount(img) — подменяет картинку, если портрет с оснасткой загрузился. */
  function mount(imgEl, size) {
    const img = new Image(); img.src = "/svetlana-face.jpg";
    const st = { state: "idle", speechExpr: null, speechUntil: 0, anim: new Animator(), canvas: null, sp: null, ph: -1 };
    img.onload = () => {
      if (img.naturalWidth < 450 || img.naturalHeight < 450) return; // не тот портрет — оснастка не совпадёт
      const skin = skinAt(img); const dpr = Math.min(2, window.devicePixelRatio || 1); const pad = Math.round(size * .12);
      const c = document.createElement("canvas"); const side = size + pad * 2;
      c.width = side * dpr; c.height = side * dpr; c.style.width = c.style.height = side + "px"; c.className = imgEl.className + " live"; c.id = imgEl.id; c.title = imgEl.title || "";
      imgEl.replaceWith(c); st.canvas = c;
      const face = document.createElement("canvas"); face.width = face.height = Math.round(size * dpr * 1.5); const fg = face.getContext("2d");
      const g = c.getContext("2d"); const t0 = performance.now();
      const tick = (now) => {
        if (!document.hidden && c.isConnected) {
          const t = (now - t0) / 1000, s = st.state, speaking = s === "speaking";
          let expr = STATE_EXPR[s] || "calm", mouth = null;
          if (speaking && speech) { // губы и эмоция — по текущей фразе
            const f = speech.frame(now); mouth = f; if (f.ph && f.ph.e !== "calm") expr = f.ph.e;
            if (st.sp !== speech) { st.sp = speech; st.ph = -1; }
            if (f.pi >= 0 && f.pi !== st.ph) { st.ph = f.pi; if (f.ph.g && !st.anim.act) st.anim.trigger(f.ph.g); } // жест в начале фразы
          } else if (speaking) mouth = { o: .25 + .45 * Math.abs(Math.sin(t * 11)) * (.6 + .4 * Math.sin(t * 3.7)), w: .1 }; // нет текста — просто «говорит»
          if (!(speaking && speech) && st.speechExpr && Date.now() < st.speechUntil && st.speechExpr !== "calm") expr = st.speechExpr;
          st.anim.set(expr);
          draw(fg, img, skin, face.width, st.anim.frame(now, mouth, speaking), now, s === "offline");
          g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, side, side); g.drawImage(face, pad, pad, size, size);
          let grow = 0, w = 3, arc = null; const r0 = size / 2 + 3, ctr = side / 2;
          const lv = speaking && speech ? speech.frame(now).o : null;
          if (s === "idle") grow = 1.5 + 1.5 * Math.sin(t * 1.6); else if (s === "listening") { grow = 3 + 4 * Math.abs(Math.sin(t * 4)); w = 4; } else if (speaking) { grow = lv === null ? 2 + 3 * Math.abs(Math.sin(t * 9)) : 1.5 + 5 * lv; w = 4; } else if (s === "thinking") arc = (t * 4.2) % (Math.PI * 2);
          g.lineWidth = w; g.strokeStyle = arc === null ? STATES[s] || STATES.idle : "#d0d8d2"; g.beginPath(); g.arc(ctr, ctr, Math.min(side / 2 - w, r0 + grow), 0, Math.PI * 2); g.stroke();
          if (arc !== null) { g.strokeStyle = STATES.thinking; g.lineWidth = 4; g.beginPath(); g.arc(ctr, ctr, r0 + 2, arc, arc + 1.9); g.stroke(); }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick); st.anim.trigger("nod");
    };
    return st;
  }
  // взгляд: голова слегка поворачивается к пальцу/курсору
  if (typeof addEventListener === "function") addEventListener("pointermove", (e) => {
    const now = performance.now();
    for (const f of faces) { const r = f.canvas?.getBoundingClientRect?.(); if (!r || !r.width) continue; const dx = (e.clientX - (r.left + r.width / 2)) / Math.max(innerWidth, 1), dy = (e.clientY - (r.top + r.height / 2)) / Math.max(innerHeight, 1); f.anim.look = { x: clamp(dx * 2, -1, 1), y: clamp(dy * 2, -1, 1), t: now }; }
  }, { passive: true });

  // Голос телефона: мост Android сообщает старт речи и позицию звучащего слова (с id фразы — чужие отбрасываем)
  const mine = (id) => speech && (!id || !speech.id || String(id) === speech.id);
  window.__svSpeechStart = (id) => { if (mine(id)) speech.start(); };
  window.__svRange = (id, i) => { if (mine(id)) speech.at(Number(i) || 0); };
  // контекст звука создаём только по касанию (жест пользователя) — тогда он работает, и губы следуют и за громкостью
  if (METER_OK && typeof addEventListener === "function") addEventListener("pointerdown", () => { const ac = audioCtx(); if (ac && ac.state !== "running") Promise.resolve(ac.resume?.()).catch(() => {}); }, { once: true, passive: true });

  window.SvAvatar = {
    mount(el, size) { if (el) faces.push(mount(el, size)); },
    /** idle | listening | thinking | speaking | offline */
    setState(s) { for (const f of faces) f.state = STATES[s] ? s : "idle"; if (s !== "speaking" && speech) { speech.ended = true; speech = null; } },
    say(text) {
      const e = emotion(text); for (const f of faces) { f.speechExpr = e; f.speechUntil = Date.now() + 2000 + String(text || "").length / 14 * 1000; }
      speech = new Speech(text); // губы стартуют, когда реально зазвучит голос
    },
    /** Голос звучит из <audio> (озвучка сервера): время берём из плеера */
    voice(audio) { if (speech && audio && !speech.audio) speech.attach(audio); },
    /** id фразы голоса телефона (из моста Android) */
    tag(id) { if (speech) speech.id = String(id || ""); },
    /** голос браузера/телефона начал говорить */
    started() { speech?.start(); },
    /** сейчас звучит слово с символа i (событие boundary) */
    word(i) { speech?.at(Number(i) || 0); },
    /** Начать речь: губы по тексту. Вернёт пульт: attach(audio) | start() | at(charIndex) | end() */
    speech(text) { speech = new Speech(text); const sp = speech; return { attach: (a) => sp.attach(a), start: () => sp.start(), at: (i) => sp.at(i), end: () => { sp.ended = true; if (speech === sp) speech = null; } }; },
    hush() { if (speech) speech.ended = true; speech = null; },
    react(a) { for (const f of faces) f.anim.trigger(a); },
    /** показать эмоцию на несколько секунд (calm, joy, laugh, surprise, question, thinking, sad, fear, shy, wink, angry, tender, tired, proud, sorry) */
    feel(e, ms = 3000) { for (const f of faces) { f.speechExpr = EXPR[e] ? e : "calm"; f.speechUntil = Date.now() + ms; } },
    _test: { emotion, timeline, phrases, visemeAt, unitsAtChar, Speech, EXPR, ACTION_MS, current: () => speech },
  };
})();
