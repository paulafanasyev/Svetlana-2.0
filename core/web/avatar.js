"use strict";
// Живой аватар Светланы для веба и Android — порт desktop-agent/avatar.py (а тот — svetlanaFace.js из Svetlana-self-employed):
// моргание, брови, улыбка, румянец, наклоны головы, смех/кивок/подмигивание, губы во время речи и кольцо состояния.
// Портрет /svetlana-face.jpg (оснастка в его координатах). Нет портрета — остаётся обычная картинка.
(() => {
  const RIG = { view: [90, 95, 360], blinkMs: 130, blinkGap: [2200, 5700], eyes: [[195, 233, 36, 22], [316, 215, 36, 25]], cheeks: [[178, 282, 34], [338, 262, 32]], jawDrop: 13 };
  const ZERO = { bl: 0, br: 0, sq: 0, ml: 0, mr: 0, jaw: 0, round: 0, blush: 0, tear: 0, sweat: 0, wl: 0, wr: 0, rot: 0, hx: 0, hy: 0, hs: 1 };
  const EXPR = {
    calm: {}, joy: { bl: 3, br: 3, sq: .22, ml: .9, mr: .9, blush: .25 },
    laugh: { bl: 4, br: 4, sq: .95, ml: 1.2, mr: 1.2, jaw: .55, blush: .45, action: "laugh" },
    surprise: { bl: 10, br: 10, jaw: .75, round: .8 }, question: { bl: 1, br: 9, ml: -.2, mr: .35, rot: .12, hx: 4 },
    thinking: { bl: -2, br: 6, sq: .18, ml: -.3, mr: .5, rot: -.08, hy: -3 },
    sad: { bl: -1, br: -1, sq: .25, ml: -1.8, mr: -1.8, rot: .04, hy: 4, tear: 1 }, fear: { bl: 6, br: 6, sq: .3, jaw: .3, round: .3, hy: -4, sweat: 1 },
    shy: { bl: 1, br: 1, sq: .35, ml: .5, mr: .5, blush: .9, rot: .1, hy: 5 }, wink: { bl: 2, br: 4, ml: .4, mr: 1.1, action: "wink" },
  };
  const ACTION_MS = { laugh: 2200, nod: 1000, shake: 1100, wink: 900 };
  const STATES = { offline: "#9aa0a6", idle: "#2f7d55", listening: "#22a6c8", thinking: "#e08a1e", speaking: "#2f7d55" };
  const STATE_EXPR = { listening: "question", thinking: "thinking" };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function emotion(text) {
    const t = String(text || "").toLowerCase();
    if (/ха-?ха|хах|смешно/.test(t)) return "laugh";
    if (/ого|вау|ничего себе/.test(t)) return "surprise";
    if (/не удалось|не смогла|не получилось|failed|не выполнено/.test(t)) return "sad";
    if (/опасно|срочно|внимание/.test(t)) return "fear";
    if (t.includes("?")) return "question";
    if (/готово|отлично|супер|подтверждено|!/.test(t)) return "joy";
    return "calm";
  }

  class Animator {
    constructor() { this.cur = { ...ZERO }; this.expr = "calm"; this.act = null; this.start = 0; this.last = 0; this.next = 0; this.blink = -1; }
    set(name) { name = EXPR[name] ? name : "calm"; if (name !== this.expr) { this.expr = name; if (EXPR[name].action) this.trigger(EXPR[name].action); } }
    trigger(name) { if (ACTION_MS[name]) { this.act = name; this.start = performance.now(); } }
    frame(now, open = 0) {
      const dt = this.last ? Math.min(now - this.last, 100) : 16; this.last = now; if (!this.next) this.next = now + 1200;
      const T = { ...ZERO }; for (const [k, v] of Object.entries(EXPR[this.expr])) if (k !== "action") T[k] = v;
      const A = { rot: 0, hx: 0, hy: 0 }; let extra = 0;
      if (this.act) {
        const e = now - this.start, p = e / ACTION_MS[this.act];
        if (p >= 1) this.act = null;
        else if (this.act === "laugh") { const env = Math.sin(Math.PI * Math.min(1, p * 1.15)); extra = (.35 + .55 * Math.abs(Math.sin(e / 75))) * env; A.rot = .05 * Math.sin(e / 95) * env; A.hy = -4 * Math.abs(Math.sin(e / 75)) * env; Object.assign(T, { sq: Math.max(T.sq, .95 * env), ml: 1.2, mr: 1.2, blush: .5, bl: 4, br: 4 }); }
        else if (this.act === "nod") { A.hy = 9 * Math.sin(Math.PI * 4 * p) * (1 - p); A.rot = .02 * Math.sin(Math.PI * 4 * p) * (1 - p); }
        else if (this.act === "shake") { A.hx = 10 * Math.sin(Math.PI * 5 * p) * (1 - p); A.rot = .05 * Math.sin(Math.PI * 5 * p) * (1 - p); }
        else if (this.act === "wink") T.wr = p < .65 ? 1 : 0;
      }
      const kf = 1 - Math.exp(-dt / 95); for (const k in ZERO) this.cur[k] += (T[k] - this.cur[k]) * kf;
      let b = 0;
      if (this.blink < 0 && now >= this.next) this.blink = now;
      if (this.blink >= 0) { const q = (now - this.blink) / RIG.blinkMs; if (q >= 1) { this.blink = -1; this.next = now + RIG.blinkGap[0] + Math.random() * (RIG.blinkGap[1] - RIG.blinkGap[0]); } else b = Math.sin(Math.PI * q); }
      const c = this.cur;
      return { ...c, rot: c.rot + A.rot, hx: c.hx + A.hx, hy: c.hy + A.hy, open: Math.max(open, c.jaw * (open > .05 ? .4 : 1), extra), blink: b };
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
      const b = i ? P.br : P.bl;
      if (Math.abs(b) > .2) { g.strokeStyle = "rgba(55,30,24,.95)"; g.lineWidth = 5; g.lineCap = "round"; g.beginPath(); g.moveTo(ex - rx * .65, 190 - b); g.quadraticCurveTo(ex, 180 - b, ex + rx * .65, 191 - b); g.stroke(); }
      const close = clamp(Math.max(P.blink || 0, P.sq, i ? P.wr : P.wl), 0, 1);
      if (close > .03) { const h = ry * (.18 + .82 * close); g.fillStyle = skin[i]; g.beginPath(); g.ellipse(ex, ey, rx * 1.05, h, 0, 0, Math.PI * 2); g.fill(); }
    });
    const open = clamp(P.open, 0, 1.2) * RIG.jawDrop, smile = (P.ml + P.mr) / 2;
    if (open > .25) {
      const oy = 319 + open * .55, oh = Math.max(3, open * .9);
      g.fillStyle = "rgb(91,26,34)"; g.beginPath(); g.ellipse(259, oy, 46, oh, 0, 0, Math.PI * 2); g.fill();
      if (open > 7) { g.fillStyle = "rgb(180,84,94)"; g.fillRect(239, 322 + open * .65, 40, Math.max(2, open * .22)); }
    } else if (Math.abs(smile) > .03) {
      g.strokeStyle = "rgba(139,61,59,.95)"; g.lineWidth = 3; g.lineCap = "round"; g.beginPath(); g.moveTo(216, 319 - smile * 5); g.quadraticCurveTo(258, 327 - smile * 5, 303, 319 - smile * 4); g.stroke();
    }
    if (P.blush > .02) for (const [x, y, r] of RIG.cheeks) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(236,92,112,${.42 * P.blush})`); gr.addColorStop(1, "rgba(236,92,112,0)"); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    if (P.tear > .3) { const ty = 256 + (now % 2600) / 2600 * 46; g.fillStyle = "rgba(150,200,240,.8)"; g.beginPath(); g.ellipse(176, ty, 5, 5, 0, 0, Math.PI * 2); g.fill(); }
    if (P.sweat > .3) { const sy = 150 + Math.sin(now / 300) * 2; g.fillStyle = "rgba(150,200,240,.8)"; g.beginPath(); g.ellipse(356, sy, 6, 6, 0, 0, Math.PI * 2); g.fill(); }
    g.restore();
  }

  /** Живое лицо в canvas поверх img: mount(img) — подменяет картинку, если портрет с оснасткой загрузился. */
  function mount(imgEl, size) {
    const img = new Image(); img.src = "/svetlana-face.jpg";
    const st = { state: "idle", speechExpr: null, speechUntil: 0, anim: new Animator(), canvas: null };
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
          let expr = STATE_EXPR[s] || "calm"; if (st.speechExpr && Date.now() < st.speechUntil && st.speechExpr !== "calm") expr = st.speechExpr;
          st.anim.set(expr);
          const mouth = speaking ? .25 + .45 * Math.abs(Math.sin(t * 11)) * (.6 + .4 * Math.sin(t * 3.7)) : 0;
          draw(fg, img, skin, face.width, st.anim.frame(now, mouth), now, s === "offline");
          g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, side, side); g.drawImage(face, pad, pad, size, size);
          let grow = 0, w = 3, arc = null; const r0 = size / 2 + 3, ctr = side / 2;
          if (s === "idle") grow = 1.5 + 1.5 * Math.sin(t * 1.6); else if (s === "listening") { grow = 3 + 4 * Math.abs(Math.sin(t * 4)); w = 4; } else if (speaking) { grow = 2 + 3 * Math.abs(Math.sin(t * 9)); w = 4; } else if (s === "thinking") arc = (t * 4.2) % (Math.PI * 2);
          g.lineWidth = w; g.strokeStyle = arc === null ? STATES[s] || STATES.idle : "#d0d8d2"; g.beginPath(); g.arc(ctr, ctr, Math.min(side / 2 - w, r0 + grow), 0, Math.PI * 2); g.stroke();
          if (arc !== null) { g.strokeStyle = STATES.thinking; g.lineWidth = 4; g.beginPath(); g.arc(ctr, ctr, r0 + 2, arc, arc + 1.9); g.stroke(); }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick); st.anim.trigger("nod");
    };
    return st;
  }

  const faces = [];
  window.SvAvatar = {
    mount(el, size) { if (el) faces.push(mount(el, size)); },
    /** idle | listening | thinking | speaking | offline */
    setState(s) { for (const f of faces) f.state = STATES[s] ? s : "idle"; },
    say(text) { const e = emotion(text); for (const f of faces) { f.speechExpr = e; f.speechUntil = Date.now() + 2000 + String(text || "").length / 14 * 1000; } },
    react(a) { for (const f of faces) f.anim.trigger(a); },
  };
})();
